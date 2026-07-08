export type CredentialValidationResult = {
  valid: boolean;
  accountLogin?: string;
  scopes?: string[];
};

/**
 * Common abstraction over Git hosting providers. GitHub is the only
 * implementation for the MVP; GitLab/Bitbucket can be added behind the same
 * interface without touching callers. Phase 5 will extend this with repository
 * and commit methods.
 */
export interface GitProvider {
  validateCredential(token: string): Promise<CredentialValidationResult>;
}
