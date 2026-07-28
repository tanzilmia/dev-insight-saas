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

export type GitPullRequest = {
  number: number;
  title: string;
  authorLogin: string | null;
  state: string; // "open" | "closed"
  merged: boolean;
  openedAt: string; // ISO
  mergedAt: string | null;
  closedAt: string | null;
};

export type GitPullRequestReview = {
  externalId: string;
  reviewerLogin: string | null;
  state: string; // APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED
  submittedAt: string | null;
};

export type ListPullRequestsOptions = {
  /** Newest-first cap on how many PRs to walk back. */
  max?: number;
};

export type GitIssue = {
  externalId: string;
  number: number;
  title: string;
  body: string | null;
  state: string; // "open" | "closed"
  stateReason: string | null;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  assigneeLogins: string[];
  labels: string[];
  milestoneTitle: string | null;
  openedAt: string;
  updatedAt: string;
  closedAt: string | null;
  htmlUrl: string;
};

export type GitIssueEvent = {
  externalId: string;
  eventType: string;
  actorLogin: string | null;
  assigneeLogin: string | null;
  labelName: string | null;
  milestoneTitle: string | null;
  commitSha: string | null;
  occurredAt: string;
};

export type ListIssuesOptions = {
  /** Newest-updated cap on how many issues to walk back. */
  max?: number;
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
  /** Resolves a single account by login/handle. Returns null if it doesn't exist. */
  getUser(token: string, username: string): Promise<GitUser | null>;
  /** Repositories selected for the GitHub App installation token. */
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
  /** Pull requests (all states), newest first, for collaboration metrics. */
  listPullRequests(
    token: string,
    owner: string,
    repo: string,
    options?: ListPullRequestsOptions
  ): Promise<GitPullRequest[]>;
  /** Reviews left on one pull request (who reviewed, and how). */
  listPullRequestReviews(
    token: string,
    owner: string,
    repo: string,
    number: number
  ): Promise<GitPullRequestReview[]>;
  /** Issues (not pull requests), newest-updated first, for work tracking. */
  listIssues(
    token: string,
    owner: string,
    repo: string,
    options?: ListIssuesOptions
  ): Promise<GitIssue[]>;
  /** Timeline events for one issue, used to preserve workflow history. */
  listIssueEvents(
    token: string,
    owner: string,
    repo: string,
    number: number,
    options?: ListIssuesOptions
  ): Promise<GitIssueEvent[]>;
}
