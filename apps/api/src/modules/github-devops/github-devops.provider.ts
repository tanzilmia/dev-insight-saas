import _sodium from "libsodium-wrappers";

import { AppError } from "../../common/errors/app-error.js";
import { env } from "../../config/env.js";
import { GitRateLimitError } from "../git-providers/git-provider.js";
import type {
  CommitFileInput,
  CreatePullRequestInput,
  DevOpsProvider,
  PullRequestRef,
  RepositoryFile,
  RepositoryRef,
  WorkflowJobDto,
  WorkflowRunDto
} from "../devops-providers/devops-provider.js";

/**
 * GitHub implementation of {@link DevOpsProvider}. Authenticates with a GitHub
 * App installation token (passed in per call — never minted or stored here) and
 * only performs the operations the CI-management flow needs. Reuses the same
 * REST host + rate-limit handling as the read-only provider.
 */

type GitHubRunResponse = {
  id: number;
  workflow_id?: number;
  name?: string | null;
  head_branch?: string | null;
  head_sha?: string | null;
  event?: string | null;
  status?: string | null;
  conclusion?: string | null;
  actor?: { login?: string } | null;
  html_url?: string | null;
  run_started_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type GitHubJobResponse = {
  id: number;
  run_id: number;
  name?: string | null;
  status?: string | null;
  conclusion?: string | null;
  steps?: Array<{
    name?: string | null;
    status?: string | null;
    conclusion?: string | null;
  }>;
};

class GitHubDevOpsProvider implements DevOpsProvider {
  private headers(token: string) {
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "DevInsight-AI",
      "X-GitHub-Api-Version": "2022-11-28"
    };
  }

  private async request(
    path: string,
    token: string,
    options: { method?: string; body?: unknown } = {}
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${env.GITHUB_API_BASE_URL}${path}`, {
        method: options.method ?? "GET",
        headers: {
          ...this.headers(token),
          ...(options.body !== undefined ? { "Content-Type": "application/json" } : {})
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
      });
    } catch {
      throw new AppError(502, "Could not reach GitHub", "GIT_PROVIDER_UNREACHABLE");
    }

    if (
      (response.status === 403 || response.status === 429) &&
      (response.headers.get("x-ratelimit-remaining") === "0" ||
        response.headers.get("retry-after") !== null)
    ) {
      const retryAfter = response.headers.get("retry-after");
      const reset = response.headers.get("x-ratelimit-reset");
      throw new GitRateLimitError(
        retryAfter
          ? new Date(Date.now() + Number(retryAfter) * 1000)
          : reset
            ? new Date(Number(reset) * 1000)
            : null
      );
    }

    return response;
  }

  private encode(ref: RepositoryRef) {
    return `${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
  }

  async getDefaultBranch(token: string, ref: RepositoryRef): Promise<string> {
    const response = await this.request(`/repos/${this.encode(ref)}`, token);
    if (!response.ok) {
      throw new AppError(502, "GitHub API request failed", "GIT_PROVIDER_ERROR");
    }
    const data = (await response.json()) as { default_branch?: string };
    return data.default_branch ?? "main";
  }

  async getFile(
    token: string,
    ref: RepositoryRef,
    path: string,
    branch?: string
  ): Promise<RepositoryFile | null> {
    const query = branch ? `?ref=${encodeURIComponent(branch)}` : "";
    const response = await this.request(
      `/repos/${this.encode(ref)}/contents/${path}${query}`,
      token
    );
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new AppError(502, "GitHub API request failed", "GIT_PROVIDER_ERROR");
    }
    const data = (await response.json()) as {
      content?: string;
      encoding?: string;
      sha?: string;
      path?: string;
    };
    // Directories return an array (no `content`); treat as "not a file".
    if (typeof data.content !== "string") {
      return null;
    }
    const content =
      data.encoding === "base64"
        ? Buffer.from(data.content, "base64").toString("utf8")
        : data.content;
    return { path: data.path ?? path, content, sha: data.sha ?? "" };
  }

  async getBranchHeadSha(
    token: string,
    ref: RepositoryRef,
    branch: string
  ): Promise<string | null> {
    const response = await this.request(
      `/repos/${this.encode(ref)}/git/ref/heads/${encodeURIComponent(branch)}`,
      token
    );
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new AppError(502, "GitHub API request failed", "GIT_PROVIDER_ERROR");
    }
    const data = (await response.json()) as { object?: { sha?: string } };
    return data.object?.sha ?? null;
  }

  async createBranch(
    token: string,
    ref: RepositoryRef,
    newBranch: string,
    fromSha: string
  ): Promise<void> {
    const response = await this.request(`/repos/${this.encode(ref)}/git/refs`, token, {
      method: "POST",
      body: { ref: `refs/heads/${newBranch}`, sha: fromSha }
    });
    // 422 = the ref already exists → idempotent success (we reuse the branch).
    if (response.status === 422) {
      return;
    }
    this.assertWritable(response);
    if (!response.ok) {
      throw new AppError(502, "GitHub API request failed", "GIT_PROVIDER_ERROR");
    }
  }

  async putFile(
    token: string,
    ref: RepositoryRef,
    input: CommitFileInput
  ): Promise<{ commitSha: string }> {
    const response = await this.request(
      `/repos/${this.encode(ref)}/contents/${input.path}`,
      token,
      {
        method: "PUT",
        body: {
          message: input.message,
          content: Buffer.from(input.content, "utf8").toString("base64"),
          branch: input.branch,
          ...(input.sha ? { sha: input.sha } : {})
        }
      }
    );
    this.assertWritable(response);
    if (!response.ok) {
      throw new AppError(502, "GitHub API request failed", "GIT_PROVIDER_ERROR");
    }
    const data = (await response.json()) as { commit?: { sha?: string } };
    return { commitSha: data.commit?.sha ?? "" };
  }

  async findOpenPullRequestByHead(
    token: string,
    ref: RepositoryRef,
    headBranch: string
  ): Promise<PullRequestRef | null> {
    const head = `${ref.owner}:${headBranch}`;
    const response = await this.request(
      `/repos/${this.encode(ref)}/pulls?state=open&head=${encodeURIComponent(head)}`,
      token
    );
    if (!response.ok) {
      throw new AppError(502, "GitHub API request failed", "GIT_PROVIDER_ERROR");
    }
    const items = (await response.json()) as {
      number: number;
      html_url: string;
      state: string;
      head?: { ref?: string };
      merged?: boolean;
    }[];
    const first = items[0];
    return first
      ? {
          number: first.number,
          url: first.html_url,
          state: first.state,
          headBranch: first.head?.ref ?? headBranch,
          merged: first.merged ?? false
        }
      : null;
  }

  async getPullRequest(
    token: string,
    ref: RepositoryRef,
    prNumber: number
  ): Promise<PullRequestRef | null> {
    const response = await this.request(`/repos/${this.encode(ref)}/pulls/${prNumber}`, token);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new AppError(502, "GitHub API request failed", "GIT_PROVIDER_ERROR");
    }
    const data = (await response.json()) as {
      number: number;
      html_url: string;
      state: string;
      head?: { ref?: string };
      merged?: boolean;
    };
    return {
      number: data.number,
      url: data.html_url,
      state: data.state,
      headBranch: data.head?.ref ?? "",
      merged: data.merged ?? false
    };
  }

  async createPullRequest(
    token: string,
    ref: RepositoryRef,
    input: CreatePullRequestInput
  ): Promise<PullRequestRef> {
    const response = await this.request(`/repos/${this.encode(ref)}/pulls`, token, {
      method: "POST",
      body: { title: input.title, head: input.head, base: input.base, body: input.body }
    });
    this.assertWritable(response);
    if (!response.ok) {
      throw new AppError(502, "GitHub API request failed", "GIT_PROVIDER_ERROR");
    }
    const data = (await response.json()) as {
      number: number;
      html_url: string;
      state: string;
      head?: { ref?: string };
    };
    return {
      number: data.number,
      url: data.html_url,
      state: data.state,
      headBranch: data.head?.ref ?? input.head,
      merged: false
    };
  }

  async mergePullRequest(
    token: string,
    ref: RepositoryRef,
    prNumber: number,
    options: { method?: "merge" | "squash" | "rebase" } = {}
  ): Promise<{ merged: boolean; sha: string | null }> {
    const response = await this.request(
      `/repos/${this.encode(ref)}/pulls/${prNumber}/merge`,
      token,
      { method: "PUT", body: { merge_method: options.method ?? "squash" } }
    );
    // 405 = not mergeable / method disabled; 409 = merge conflict or head moved.
    if (response.status === 405 || response.status === 409) {
      throw new AppError(
        409,
        "GitHub couldn't merge the pull request automatically (conflicts, required checks, or the merge method is disabled). Merge it on GitHub, then Sync.",
        "PR_NOT_MERGEABLE"
      );
    }
    this.assertWritable(response);
    if (!response.ok) {
      throw new AppError(502, "GitHub API request failed", "GIT_PROVIDER_ERROR");
    }
    const data = (await response.json()) as { merged?: boolean; sha?: string };
    return { merged: data.merged ?? false, sha: data.sha ?? null };
  }

  async listWorkflowRuns(
    token: string,
    ref: RepositoryRef,
    options: { perPage?: number; branch?: string } = {}
  ): Promise<WorkflowRunDto[]> {
    const params = new URLSearchParams({ per_page: String(options.perPage ?? 20) });
    if (options.branch) {
      params.set("branch", options.branch);
    }
    const response = await this.request(
      `/repos/${this.encode(ref)}/actions/runs?${params.toString()}`,
      token
    );
    if (!response.ok) {
      throw new AppError(502, "GitHub API request failed", "GIT_PROVIDER_ERROR");
    }
    const data = (await response.json()) as { workflow_runs?: GitHubRunResponse[] };
    return (data.workflow_runs ?? []).map((run) => ({
      runId: String(run.id),
      workflowId: run.workflow_id !== undefined ? String(run.workflow_id) : null,
      name: run.name ?? null,
      branch: run.head_branch ?? null,
      headSha: run.head_sha ?? null,
      event: run.event ?? null,
      status: run.status ?? null,
      conclusion: run.conclusion ?? null,
      actor: run.actor?.login ?? null,
      url: run.html_url ?? null,
      startedAt: run.run_started_at ?? run.created_at ?? null,
      completedAt: run.status === "completed" ? (run.updated_at ?? null) : null
    }));
  }

  async listWorkflowJobs(
    token: string,
    ref: RepositoryRef,
    runId: string
  ): Promise<WorkflowJobDto[]> {
    const response = await this.request(
      `/repos/${this.encode(ref)}/actions/runs/${encodeURIComponent(runId)}/jobs?per_page=100`,
      token
    );
    if (!response.ok) {
      throw new AppError(502, "GitHub workflow jobs request failed", "GIT_PROVIDER_ERROR");
    }
    const data = (await response.json()) as { jobs?: GitHubJobResponse[] };
    return (data.jobs ?? []).map((job) => ({
      jobId: String(job.id),
      runId: String(job.run_id),
      name: job.name ?? null,
      status: job.status ?? null,
      conclusion: job.conclusion ?? null,
      steps: (job.steps ?? []).map((step) => ({
        name: step.name ?? "",
        status: step.status ?? null,
        conclusion: step.conclusion ?? null
      }))
    }));
  }

  async getWorkflowJobLog(token: string, ref: RepositoryRef, jobId: string): Promise<string> {
    const response = await this.request(
      `/repos/${this.encode(ref)}/actions/jobs/${encodeURIComponent(jobId)}/logs`,
      token
    );
    if (response.status === 404) return "";
    if (!response.ok) {
      throw new AppError(502, "GitHub workflow log request failed", "GIT_PROVIDER_ERROR");
    }
    return (await response.text()).slice(-12000);
  }

  async rerunFailedJobs(token: string, ref: RepositoryRef, runId: string): Promise<void> {
    const response = await this.request(
      `/repos/${this.encode(ref)}/actions/runs/${encodeURIComponent(runId)}/rerun-failed-jobs`,
      token,
      { method: "POST" }
    );
    if (response.status === 403) {
      throw new AppError(
        403,
        "GitHub refused the retry. The DevInsight App needs Actions write permission on this repository.",
        "DEVOPS_ACTIONS_PERMISSION_DENIED"
      );
    }
    this.assertWritable(response);
    if (!response.ok) {
      throw new AppError(502, "GitHub failed to rerun workflow jobs", "GIT_PROVIDER_ERROR");
    }
  }

  /**
   * Creates/updates a repository Actions secret. GitHub requires the value to be
   * encrypted client-side with the repo's public key using a libsodium sealed
   * box before upload. Needs the App's `secrets: write` permission.
   */
  async putRepoSecret(
    token: string,
    ref: RepositoryRef,
    name: string,
    value: string
  ): Promise<void> {
    // 1. Fetch the repository's public key for Actions secrets.
    const keyResponse = await this.request(
      `/repos/${this.encode(ref)}/actions/secrets/public-key`,
      token
    );
    this.assertSecretsWritable(keyResponse);
    if (!keyResponse.ok) {
      throw new AppError(502, "GitHub API request failed", "GIT_PROVIDER_ERROR");
    }
    const publicKey = (await keyResponse.json()) as { key_id?: string; key?: string };
    if (!publicKey.key || !publicKey.key_id) {
      throw new AppError(502, "GitHub returned no Actions public key", "GIT_PROVIDER_ERROR");
    }

    // 2. Encrypt with a libsodium sealed box (GitHub's required scheme).
    await _sodium.ready;
    const sodium = _sodium;
    const keyBytes = sodium.from_base64(publicKey.key, sodium.base64_variants.ORIGINAL);
    const messageBytes = sodium.from_string(value);
    const sealed = sodium.crypto_box_seal(messageBytes, keyBytes);
    const encryptedValue = sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);

    // 3. Upload. 201 = created, 204 = updated.
    const putResponse = await this.request(
      `/repos/${this.encode(ref)}/actions/secrets/${encodeURIComponent(name)}`,
      token,
      { method: "PUT", body: { encrypted_value: encryptedValue, key_id: publicKey.key_id } }
    );
    this.assertSecretsWritable(putResponse);
    if (!putResponse.ok) {
      throw new AppError(502, "GitHub API request failed", "GIT_PROVIDER_ERROR");
    }
  }

  /** A 403 on the secrets API means the App lacks the `secrets: write` scope. */
  private assertSecretsWritable(response: Response): void {
    if (response.status === 403) {
      throw new AppError(
        403,
        "GitHub refused to set the Actions secret. The DevInside App needs Secrets (read & write) permission on this repository — update the App permissions and re-accept the installation.",
        "DEVOPS_SECRETS_PERMISSION_DENIED"
      );
    }
    if (response.status === 404) {
      throw new AppError(404, "Repository not found on GitHub", "REPO_NOT_ON_PROVIDER");
    }
  }

  /**
   * GitHub refuses to let an App write under `.github/workflows/` unless it has
   * the dedicated `workflows` permission — surface that as an actionable error.
   */
  private assertWritable(response: Response): void {
    if (response.status === 403) {
      throw new AppError(
        403,
        "GitHub refused the change. The DevInside App needs Contents + Pull requests + Workflows write permission on this repository — update the App permissions and re-accept the installation.",
        "DEVOPS_PERMISSION_DENIED"
      );
    }
    if (response.status === 404) {
      throw new AppError(404, "Repository not found on GitHub", "REPO_NOT_ON_PROVIDER");
    }
  }
}

export const githubDevOpsProvider = new GitHubDevOpsProvider();
