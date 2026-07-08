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
}
