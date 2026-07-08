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
  validateCredential(token: string): Promise<CredentialValidationResult>;
  listRepositories(token: string): Promise<GitRepository[]>;
  listContributors(token: string, owner: string, repo: string): Promise<GitContributor[]>;
  /**
   * Repository collaborators (people granted access), regardless of whether
   * they have committed. Returned in the same shape with contributions = 0.
   */
  listCollaborators(token: string, owner: string, repo: string): Promise<GitContributor[]>;
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
