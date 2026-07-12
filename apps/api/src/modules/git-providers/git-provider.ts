import { AppError } from "../../common/errors/app-error.js";

/**
 * Thrown when the provider reports a rate limit. `resetAt` is when the quota
 * window resets (null when the provider didn't say). Callers decide policy:
 * the background collection worker reschedules the job for after the reset;
 * synchronous paths surface a clean 429 (manual collect) or a per-repo
 * warning (report auto-collect). The provider itself never sleeps.
 */
export class GitRateLimitError extends AppError {
  constructor(public readonly resetAt: Date | null) {
    super(429, "GitHub rate limit exceeded. Try again later.", "GIT_RATE_LIMITED");
  }
}

export type CredentialValidationResult = {
  valid: boolean;
  accountLogin?: string;
  scopes?: string[];
};

/** Normalized repository as returned by any provider. */
export type GitRepository = {
  externalId: string;
  owner: string;
  name: string;
  fullName: string;
  remoteUrl: string;
  isPrivate: boolean;
  defaultBranch: string | null;
};

/** Normalized contributor (a Git identity) as returned by any provider. */
export type GitContributor = {
  externalId: string;
  username: string;
  avatarUrl: string | null;
  contributions: number;
};

/** A resolved provider account, for confirming a username before mapping. */
export type GitUser = {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  htmlUrl: string;
  company: string | null;
  location: string | null;
  bio: string | null;
  /** "User" or "Organization" — lets the UI warn if an org handle was entered. */
  type: string;
};

/** A branch as returned by any provider. */
export type GitBranch = {
  name: string;
  headSha: string;
  isProtected: boolean;
};

/** A commit's metadata (without per-file stats). */
export type GitCommit = {
  sha: string;
  message: string;
  authorName: string | null;
  authorEmail: string | null;
  username: string | null;
  committedAt: string;
};

export type GitCommitFile = {
  filePath: string;
  status: string | null;
  additions: number;
  deletions: number;
  changes: number;
};

/** A commit's line/file statistics. */
export type GitCommitDetail = {
  additions: number;
  deletions: number;
  changedFilesCount: number;
  files: GitCommitFile[];
};

export type ListCommitsOptions = {
  since?: string;
  until?: string;
  branch?: string;
};

/**
 * Common abstraction over Git hosting providers. GitHub is the only
 * implementation for the MVP; GitLab/Bitbucket can be added behind the same
 * interface without touching callers. Later phases will extend this with
 * commit and activity methods.
 */
export interface GitProvider {
  /**
   * Max commits a single listCommits call can return (pagination ceiling),
   * if the provider has one. Deep collection bisects a window when a listing
   * hits this ceiling, so no commits are silently dropped.
   */
  readonly maxCommitsPerList?: number;
  validateCredential(token: string): Promise<CredentialValidationResult>;
  /** Resolves a single account by login/handle. Returns null if it doesn't exist. */
  getUser(token: string, username: string): Promise<GitUser | null>;
  listRepositories(token: string): Promise<GitRepository[]>;
  listContributors(token: string, owner: string, repo: string): Promise<GitContributor[]>;
  /**
   * Repository collaborators (people granted access), regardless of whether
   * they have committed. Returned in the same shape with contributions = 0.
   */
  listCollaborators(token: string, owner: string, repo: string): Promise<GitContributor[]>;
  /** All branches of a repository (name + head sha). */
  listBranches(token: string, owner: string, repo: string): Promise<GitBranch[]>;
  /** Commits in a date range on a branch (metadata only). */
  listCommits(
    token: string,
    owner: string,
    repo: string,
    options: ListCommitsOptions
  ): Promise<GitCommit[]>;
  /** Per-file stats for a single commit. */
  getCommitDetail(
    token: string,
    owner: string,
    repo: string,
    sha: string
  ): Promise<GitCommitDetail>;
}
