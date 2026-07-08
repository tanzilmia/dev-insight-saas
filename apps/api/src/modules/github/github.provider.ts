import { AppError } from "../../common/errors/app-error.js";
import { env } from "../../config/env.js";
import type {
  CredentialValidationResult,
  GitProvider
} from "../git-providers/git-provider.js";

/** GitHub implementation of {@link GitProvider} using the REST API. */
export class GitHubProvider implements GitProvider {
  async validateCredential(token: string): Promise<CredentialValidationResult> {
    let response: Response;

    try {
      response = await fetch(`${env.GITHUB_API_BASE_URL}/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "DevInsight-AI",
          "X-GitHub-Api-Version": "2022-11-28"
        }
      });
    } catch {
      throw new AppError(502, "Could not reach GitHub", "GIT_PROVIDER_UNREACHABLE");
    }

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
}
