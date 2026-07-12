import { AppError } from "../../common/errors/app-error.js";
import { env } from "../../config/env.js";
import { GitRateLimitError } from "../git-providers/git-provider.js";
import type {
  CredentialValidationResult,
  GitBranch,
  GitCommit,
  GitCommitDetail,
  GitContributor,
  GitProvider,
  GitRepository,
  GitUser,
  ListCommitsOptions
} from "../git-providers/git-provider.js";

const PER_PAGE = 100;
const MAX_PAGES = 10; // hard cap: up to 1000 items, avoids runaway pagination

type GitHubRepo = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  default_branch?: string;
  owner: { login: string };
};

type GitHubContributor = {
  id: number;
  login: string;
  avatar_url?: string;
  contributions: number;
};

type GitHubCollaborator = {
  id: number;
  login: string;
  avatar_url?: string;
};

type GitHubBranch = {
  name: string;
  commit: { sha: string };
  protected?: boolean;
};

type GitHubCommit = {
  sha: string;
  commit: { message: string; author?: { name?: string; email?: string; date?: string } };
  author: { login?: string } | null;
};

type GitHubCommitDetail = {
  stats?: { additions?: number; deletions?: number };
  files?: {
    filename: string;
    status?: string;
    additions?: number;
    deletions?: number;
    changes?: number;
  }[];
};

/** GitHub implementation of {@link GitProvider} using the REST API. */
export class GitHubProvider implements GitProvider {
  readonly maxCommitsPerList = PER_PAGE * MAX_PAGES;

  private authHeaders(token: string) {
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "DevInsight-AI",
      "X-GitHub-Api-Version": "2022-11-28"
    };
  }

  private async request(path: string, token: string): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${env.GITHUB_API_BASE_URL}${path}`, {
        headers: this.authHeaders(token)
      });
    } catch {
      throw new AppError(502, "Could not reach GitHub", "GIT_PROVIDER_UNREACHABLE");
    }

    // Primary limit: 403/429 + x-ratelimit-remaining: 0. Secondary limit:
    // 403/429 + retry-after. Must be detected here, before the per-method
    // 403 → INVALID_CREDENTIAL branches, so a rate-limited call is never
    // misread as a bad token. A genuine auth 403 has remaining > 0.
    if (
      (response.status === 403 || response.status === 429) &&
      (response.headers.get("x-ratelimit-remaining") === "0" ||
        response.headers.get("retry-after") !== null)
    ) {
      throw new GitRateLimitError(this.rateLimitResetAt(response));
    }

    return response;
  }

  private rateLimitResetAt(response: Response): Date | null {
    const retryAfter = response.headers.get("retry-after"); // seconds
    if (retryAfter && Number.isFinite(Number(retryAfter))) {
      return new Date(Date.now() + Number(retryAfter) * 1000);
    }
    const reset = response.headers.get("x-ratelimit-reset"); // unix epoch seconds
    if (reset && Number.isFinite(Number(reset))) {
      return new Date(Number(reset) * 1000);
    }
    return null;
  }

  async validateCredential(token: string): Promise<CredentialValidationResult> {
    const response = await this.request("/user", token);

    // A bad or expired token is an expected outcome, not a server error.
    if (response.status === 401 || response.status === 403) {
      return { valid: false };
    }

    if (!response.ok) {
      throw new AppError(502, "GitHub API request failed", "GIT_PROVIDER_ERROR");
    }

    const scopesHeader = response.headers.get("x-oauth-scopes");
    const data = (await response.json()) as { login?: string };

    return {
      valid: true,
      accountLogin: data.login,
      scopes: scopesHeader
        ? scopesHeader
            .split(",")
            .map((scope) => scope.trim())
            .filter(Boolean)
        : []
    };
  }

  async getUser(token: string, username: string): Promise<GitUser | null> {
    const response = await this.request(`/users/${encodeURIComponent(username)}`, token);

    // A non-existent account is an expected outcome (typo), not an error.
    if (response.status === 404) {
      return null;
    }

    if (response.status === 401 || response.status === 403) {
      throw new AppError(
        400,
        "GitHub rejected the stored token. Reconnect the credential.",
        "INVALID_CREDENTIAL"
      );
    }

    if (!response.ok) {
      throw new AppError(502, "GitHub API request failed", "GIT_PROVIDER_ERROR");
    }

    const data = (await response.json()) as {
      login: string;
      name?: string | null;
      avatar_url?: string | null;
      html_url: string;
      company?: string | null;
      location?: string | null;
      bio?: string | null;
      type?: string;
    };

    return {
      login: data.login,
      name: data.name ?? null,
      avatarUrl: data.avatar_url ?? null,
      htmlUrl: data.html_url,
      company: data.company ?? null,
      location: data.location ?? null,
      bio: data.bio ?? null,
      type: data.type ?? "User"
    };
  }

  async listRepositories(token: string): Promise<GitRepository[]> {
    const repositories: GitRepository[] = [];

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      // affiliation=owner → only repositories the authenticated user owns
      // (excludes collaborator/organization-member repos).
      const response = await this.request(
        `/user/repos?per_page=${PER_PAGE}&page=${page}&sort=full_name&affiliation=owner`,
        token
      );

      if (response.status === 401 || response.status === 403) {
        throw new AppError(
          400,
          "GitHub rejected the stored token. Reconnect the credential.",
          "INVALID_CREDENTIAL"
        );
      }

      if (!response.ok) {
        throw new AppError(502, "GitHub API request failed", "GIT_PROVIDER_ERROR");
      }

      const page_items = (await response.json()) as GitHubRepo[];

      for (const repo of page_items) {
        repositories.push({
          externalId: String(repo.id),
          owner: repo.owner.login,
          name: repo.name,
          fullName: repo.full_name,
          remoteUrl: repo.html_url,
          isPrivate: repo.private,
          defaultBranch: repo.default_branch ?? null
        });
      }

      if (page_items.length < PER_PAGE) {
        return repositories;
      }

      if (page === MAX_PAGES) {
        console.warn(
          `GitHubProvider.listRepositories hit the ${MAX_PAGES}-page cap; some repositories may be omitted.`
        );
      }
    }

    return repositories;
  }

  async listContributors(
    token: string,
    owner: string,
    repo: string
  ): Promise<GitContributor[]> {
    const contributors: GitContributor[] = [];

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const response = await this.request(
        `/repos/${owner}/${repo}/contributors?per_page=${PER_PAGE}&page=${page}`,
        token
      );

      // An empty repository responds with 204 No Content.
      if (response.status === 204) {
        return contributors;
      }

      if (response.status === 401 || response.status === 403) {
        throw new AppError(
          400,
          "GitHub rejected the stored token. Reconnect the credential.",
          "INVALID_CREDENTIAL"
        );
      }

      if (response.status === 404) {
        throw new AppError(404, "Repository not found on GitHub", "REPO_NOT_ON_PROVIDER");
      }

      if (!response.ok) {
        throw new AppError(502, "GitHub API request failed", "GIT_PROVIDER_ERROR");
      }

      const items = (await response.json()) as GitHubContributor[];

      for (const item of items) {
        // Anonymous contributors have no login; skip them.
        if (!item.login) {
          continue;
        }

        contributors.push({
          externalId: String(item.id),
          username: item.login,
          avatarUrl: item.avatar_url ?? null,
          contributions: item.contributions ?? 0
        });
      }

      if (items.length < PER_PAGE) {
        return contributors;
      }

      if (page === MAX_PAGES) {
        console.warn(
          `GitHubProvider.listContributors hit the ${MAX_PAGES}-page cap; some contributors may be omitted.`
        );
      }
    }

    return contributors;
  }

  async listCollaborators(
    token: string,
    owner: string,
    repo: string
  ): Promise<GitContributor[]> {
    const collaborators: GitContributor[] = [];

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const response = await this.request(
        `/repos/${owner}/${repo}/collaborators?per_page=${PER_PAGE}&page=${page}&affiliation=all`,
        token
      );

      if (response.status === 401) {
        throw new AppError(
          400,
          "GitHub rejected the stored token. Reconnect the credential.",
          "INVALID_CREDENTIAL"
        );
      }

      // 403/404 → the token cannot list collaborators for this repo. This is
      // non-fatal for discovery, so return what we have (usually empty).
      if (response.status === 403 || response.status === 404) {
        return collaborators;
      }

      if (!response.ok) {
        throw new AppError(502, "GitHub API request failed", "GIT_PROVIDER_ERROR");
      }

      const items = (await response.json()) as GitHubCollaborator[];

      for (const item of items) {
        if (!item.login) {
          continue;
        }

        collaborators.push({
          externalId: String(item.id),
          username: item.login,
          avatarUrl: item.avatar_url ?? null,
          contributions: 0
        });
      }

      if (items.length < PER_PAGE) {
        return collaborators;
      }

      if (page === MAX_PAGES) {
        console.warn(
          `GitHubProvider.listCollaborators hit the ${MAX_PAGES}-page cap; some collaborators may be omitted.`
        );
      }
    }

    return collaborators;
  }

  async listBranches(token: string, owner: string, repo: string): Promise<GitBranch[]> {
    const branches: GitBranch[] = [];

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const response = await this.request(
        `/repos/${owner}/${repo}/branches?per_page=${PER_PAGE}&page=${page}`,
        token
      );

      if (response.status === 401 || response.status === 403) {
        throw new AppError(
          400,
          "GitHub rejected the stored token. Reconnect the credential.",
          "INVALID_CREDENTIAL"
        );
      }

      if (response.status === 404) {
        throw new AppError(404, "Repository not found on GitHub", "REPO_NOT_ON_PROVIDER");
      }

      if (!response.ok) {
        throw new AppError(502, "GitHub API request failed", "GIT_PROVIDER_ERROR");
      }

      const items = (await response.json()) as GitHubBranch[];

      for (const item of items) {
        branches.push({
          name: item.name,
          headSha: item.commit.sha,
          isProtected: item.protected ?? false
        });
      }

      if (items.length < PER_PAGE) {
        return branches;
      }

      if (page === MAX_PAGES) {
        console.warn(
          `GitHubProvider.listBranches hit the ${MAX_PAGES}-page cap; some branches may be omitted.`
        );
      }
    }

    return branches;
  }

  async listCommits(
    token: string,
    owner: string,
    repo: string,
    options: ListCommitsOptions
  ): Promise<GitCommit[]> {
    const commits: GitCommit[] = [];
    const params = new URLSearchParams({ per_page: String(PER_PAGE) });
    if (options.since) params.set("since", options.since);
    if (options.until) params.set("until", options.until);
    if (options.branch) params.set("sha", options.branch);

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      params.set("page", String(page));
      const response = await this.request(
        `/repos/${owner}/${repo}/commits?${params.toString()}`,
        token
      );

      // An empty repository (no commits yet) responds with 409.
      if (response.status === 409) {
        return commits;
      }

      if (response.status === 401 || response.status === 403) {
        throw new AppError(
          400,
          "GitHub rejected the stored token. Reconnect the credential.",
          "INVALID_CREDENTIAL"
        );
      }

      if (response.status === 404) {
        throw new AppError(404, "Repository not found on GitHub", "REPO_NOT_ON_PROVIDER");
      }

      if (!response.ok) {
        throw new AppError(502, "GitHub API request failed", "GIT_PROVIDER_ERROR");
      }

      const items = (await response.json()) as GitHubCommit[];

      for (const item of items) {
        commits.push({
          sha: item.sha,
          message: item.commit.message,
          authorName: item.commit.author?.name ?? null,
          authorEmail: item.commit.author?.email ?? null,
          username: item.author?.login ?? null,
          committedAt: item.commit.author?.date ?? new Date(0).toISOString()
        });
      }

      if (items.length < PER_PAGE) {
        return commits;
      }

      if (page === MAX_PAGES) {
        console.warn(
          `GitHubProvider.listCommits hit the ${MAX_PAGES}-page cap; older commits may be omitted.`
        );
      }
    }

    return commits;
  }

  async getCommitDetail(
    token: string,
    owner: string,
    repo: string,
    sha: string
  ): Promise<GitCommitDetail> {
    const response = await this.request(`/repos/${owner}/${repo}/commits/${sha}`, token);

    if (!response.ok) {
      throw new AppError(502, "GitHub API request failed", "GIT_PROVIDER_ERROR");
    }

    const detail = (await response.json()) as GitHubCommitDetail;
    const files = detail.files ?? [];

    return {
      additions: detail.stats?.additions ?? 0,
      deletions: detail.stats?.deletions ?? 0,
      changedFilesCount: files.length,
      files: files.map((file) => ({
        filePath: file.filename,
        status: file.status ?? null,
        additions: file.additions ?? 0,
        deletions: file.deletions ?? 0,
        changes: file.changes ?? 0
      }))
    };
  }
}
