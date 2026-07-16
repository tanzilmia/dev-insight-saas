/**
 * DevOps provider abstraction — repository *mutation* + CI/Actions operations,
 * kept separate from the read-only `GitProvider` (activity collection) because
 * it needs write scopes, different auth (GitHub App installation tokens), and a
 * different risk model (manager-gated, audit-logged, PR-based). GitHub is the
 * only implementation today; GitLab/Bitbucket slot in behind this interface
 * without touching the CI business logic.
 *
 * Every method takes a short-lived token (an App installation token, resolved
 * per call) — the provider never mints or stores credentials itself.
 */

export type RepositoryRef = { owner: string; repo: string };

export type RepositoryFile = { path: string; content: string; sha: string };

export type PullRequestRef = {
  number: number;
  url: string;
  state: string; // "open" | "closed"
  headBranch: string;
  merged: boolean;
};

export type CommitFileInput = {
  path: string;
  /** Raw UTF-8 file content (the provider base64-encodes it). */
  content: string;
  message: string;
  branch: string;
  /** Existing blob sha when updating a file in place. */
  sha?: string;
};

export type CreatePullRequestInput = {
  head: string;
  base: string;
  title: string;
  body: string;
};

export type WorkflowRunDto = {
  runId: string;
  workflowId: string | null;
  name: string | null;
  branch: string | null;
  headSha: string | null;
  event: string | null;
  status: string | null; // queued | in_progress | completed
  conclusion: string | null; // success | failure | cancelled | null (running)
  actor: string | null;
  url: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export interface DevOpsProvider {
  getDefaultBranch(token: string, ref: RepositoryRef): Promise<string>;
  getFile(
    token: string,
    ref: RepositoryRef,
    path: string,
    branch?: string
  ): Promise<RepositoryFile | null>;
  getBranchHeadSha(token: string, ref: RepositoryRef, branch: string): Promise<string | null>;
  /** Idempotent: an already-existing branch is treated as success. */
  createBranch(token: string, ref: RepositoryRef, newBranch: string, fromSha: string): Promise<void>;
  putFile(token: string, ref: RepositoryRef, input: CommitFileInput): Promise<{ commitSha: string }>;
  findOpenPullRequestByHead(
    token: string,
    ref: RepositoryRef,
    headBranch: string
  ): Promise<PullRequestRef | null>;
  getPullRequest(
    token: string,
    ref: RepositoryRef,
    prNumber: number
  ): Promise<PullRequestRef | null>;
  createPullRequest(
    token: string,
    ref: RepositoryRef,
    input: CreatePullRequestInput
  ): Promise<PullRequestRef>;
  /** Merges a pull request (used for the "merge from DevInside" convenience). */
  mergePullRequest(
    token: string,
    ref: RepositoryRef,
    prNumber: number,
    options?: { method?: "merge" | "squash" | "rebase" }
  ): Promise<{ merged: boolean; sha: string | null }>;
  listWorkflowRuns(
    token: string,
    ref: RepositoryRef,
    options?: { perPage?: number; branch?: string }
  ): Promise<WorkflowRunDto[]>;
  /**
   * Creates or updates a repository Actions secret. The value is encrypted in
   * transit with the repository's public key per the provider's own scheme
   * (GitHub: libsodium sealed box), so callers pass plaintext. Used to inject the
   * SonarQube analysis token + host URL for automated code-quality scanning.
   * Requires the App's `secrets: write` permission on the repository.
   */
  putRepoSecret(
    token: string,
    ref: RepositoryRef,
    name: string,
    value: string
  ): Promise<void>;

  // --- Extension points (wired later for SonarQube / manual control). ---
  dispatchWorkflow?(
    token: string,
    ref: RepositoryRef,
    workflowFileName: string,
    gitRef: string
  ): Promise<void>;
  cancelWorkflowRun?(token: string, ref: RepositoryRef, runId: string): Promise<void>;
  rerunWorkflowRun?(token: string, ref: RepositoryRef, runId: string): Promise<void>;
}
