import { AppError } from "../../common/errors/app-error.js";
import { env } from "../../config/env.js";
import type {
  CredentialValidationResult,
  GitContributor,
  GitProvider,
  GitRepository
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

/** GitHub implementation of {@link GitProvider} using the REST API. */
export class GitHubProvider implements GitProvider {
  private authHeaders(token: string) {
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "DevInsight-AI",
      "X-GitHub-Api-Version": "2022-11-28"
    };
  }

  private async request(path: string, token: string): Promise<Response> {
    try {
      return await fetch(`${env.GITHUB_API_BASE_URL}${path}`, {
        headers: this.authHeaders(token)
      });
    } catch {
      throw new AppError(502, "Could not reach GitHub", "GIT_PROVIDER_UNREACHABLE");
    }
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
}
