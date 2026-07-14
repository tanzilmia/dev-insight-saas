import { createHmac, timingSafeEqual } from "node:crypto";

import jwt from "jsonwebtoken";

import { AppError } from "../../common/errors/app-error.js";
import { env } from "../../config/env.js";
import { GitRateLimitError } from "../git-providers/git-provider.js";
import type { GitRepository } from "../git-providers/git-provider.js";

/**
 * GitHub App authentication + App-scoped REST calls. This is the security core
 * of the customer-repository connection: it holds the App JWT / installation
 * token logic in one place so nothing else in the codebase touches the App
 * private key. Tokens are NEVER persisted — the App JWT is signed on demand
 * (≤10 min lifetime) and installation access tokens are minted per use.
 *
 * The App-level endpoints reuse the same GitHub REST host as the PAT provider
 * (env.GITHUB_API_BASE_URL), so tests can point them at a mock server.
 */

const APP_JWT_LIFETIME_SECONDS = 9 * 60; // GitHub allows up to 10 minutes.
const PER_PAGE = 100;
const MAX_PAGES = 10;

/** True when the App can authenticate (id + private key present). */
export function isGitHubAppConfigured(): boolean {
  return Boolean(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY);
}

/** True when App webhook deliveries can be verified (secret present). */
export function isGitHubAppWebhookConfigured(): boolean {
  return Boolean(env.GITHUB_APP_WEBHOOK_SECRET);
}

function requireConfigured(): { appId: string; privateKey: string } {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    throw new AppError(
      503,
      "The GitHub App is not configured on this server yet.",
      "GITHUB_APP_NOT_CONFIGURED"
    );
  }
  return { appId: env.GITHUB_APP_ID, privateKey: normalizePrivateKey(env.GITHUB_APP_PRIVATE_KEY) };
}

/**
 * Accepts the private key as a raw PEM (with newlines) or, preferably, a
 * base64-encoded PEM (avoids env newline mangling). Detected by the PEM header.
 */
export function normalizePrivateKey(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes("-----BEGIN")) {
    return trimmed.replace(/\\n/g, "\n");
  }
  return Buffer.from(trimmed, "base64").toString("utf8");
}

/**
 * A short-lived RS256 JWT that authenticates AS THE APP (not an installation).
 * Used only to mint installation tokens and read installation metadata.
 */
export function generateAppJwt(): string {
  const { appId, privateKey } = requireConfigured();
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { iat: now - 30, exp: now + APP_JWT_LIFETIME_SECONDS, iss: appId },
    privateKey,
    { algorithm: "RS256" }
  );
}

/** The URL a customer visits to install the App (build once, no secrets). */
export function getAppInstallUrl(state?: string): string {
  if (!env.GITHUB_APP_SLUG) {
    throw new AppError(
      503,
      "The GitHub App slug is not configured on this server yet.",
      "GITHUB_APP_NOT_CONFIGURED"
    );
  }
  const base = `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`;
  return state ? `${base}?state=${encodeURIComponent(state)}` : base;
}

/** Constant-time HMAC check of a GitHub App webhook's X-Hub-Signature-256. */
export function verifyWebhookSignature(rawBody: Buffer, header: string | undefined): boolean {
  const secret = env.GITHUB_APP_WEBHOOK_SECRET;
  if (!secret || !header?.startsWith("sha256=")) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const received = header.slice("sha256=".length);
  if (received.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}

// --- App-scoped REST client (installation metadata + tokens + repos) ---------

export type AppInstallation = {
  installationId: string;
  accountLogin: string;
  accountType: string | null;
  accountId: string | null;
  targetType: string | null;
  repositorySelection: string | null;
  permissions: Record<string, string> | null;
  suspendedAt: string | null;
};

export type InstallationAccessToken = {
  token: string;
  expiresAt: string | null;
  repositorySelection: string | null;
};

type GitHubInstallationResponse = {
  id: number;
  account?: { login?: string; id?: number; type?: string } | null;
  target_type?: string;
  repository_selection?: string;
  permissions?: Record<string, string>;
  suspended_at?: string | null;
};

type GitHubRepo = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  default_branch?: string;
  owner: { login: string };
};

const APP_JSON = "application/vnd.github+json";

async function appRequest(
  path: string,
  bearer: string,
  options: { method?: string } = {}
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${env.GITHUB_API_BASE_URL}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: APP_JSON,
        "User-Agent": "DevInsight-AI",
        "X-GitHub-Api-Version": "2022-11-28"
      }
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
    const resetAt = retryAfter
      ? new Date(Date.now() + Number(retryAfter) * 1000)
      : reset
        ? new Date(Number(reset) * 1000)
        : null;
    throw new GitRateLimitError(resetAt);
  }

  return response;
}

function mapInstallation(data: GitHubInstallationResponse): AppInstallation {
  return {
    installationId: String(data.id),
    accountLogin: data.account?.login ?? "",
    accountType: data.account?.type ?? null,
    accountId: data.account?.id !== undefined ? String(data.account.id) : null,
    targetType: data.target_type ?? null,
    repositorySelection: data.repository_selection ?? null,
    permissions: data.permissions ?? null,
    suspendedAt: data.suspended_at ?? null
  };
}

/** GitHub REST calls that require the App JWT or an installation token. */
export class GitHubAppClient {
  /** Reads installation metadata (account, selection). Uses the App JWT. */
  async getInstallation(installationId: string): Promise<AppInstallation | null> {
    const response = await appRequest(
      `/app/installations/${encodeURIComponent(installationId)}`,
      generateAppJwt()
    );

    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new AppError(502, "GitHub API request failed", "GIT_PROVIDER_ERROR");
    }
    return mapInstallation((await response.json()) as GitHubInstallationResponse);
  }

  /** Mints a short-lived installation access token. NEVER persist the result. */
  async createInstallationAccessToken(
    installationId: string
  ): Promise<InstallationAccessToken> {
    const response = await appRequest(
      `/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
      generateAppJwt(),
      { method: "POST" }
    );

    if (response.status === 404) {
      throw new AppError(404, "GitHub App installation not found", "INSTALLATION_NOT_FOUND");
    }
    if (!response.ok) {
      throw new AppError(502, "GitHub API request failed", "GIT_PROVIDER_ERROR");
    }

    const data = (await response.json()) as {
      token: string;
      expires_at?: string;
      repository_selection?: string;
    };
    return {
      token: data.token,
      expiresAt: data.expires_at ?? null,
      repositorySelection: data.repository_selection ?? null
    };
  }

  /** Lists repositories an installation can access, using an installation token. */
  async listInstallationRepositories(installationToken: string): Promise<GitRepository[]> {
    const repositories: GitRepository[] = [];

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const response = await appRequest(
        `/installation/repositories?per_page=${PER_PAGE}&page=${page}`,
        installationToken
      );

      if (!response.ok) {
        throw new AppError(502, "GitHub API request failed", "GIT_PROVIDER_ERROR");
      }

      const data = (await response.json()) as { repositories?: GitHubRepo[] };
      const items = data.repositories ?? [];

      for (const repo of items) {
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

      if (items.length < PER_PAGE) {
        return repositories;
      }
    }

    console.warn("GitHubAppClient.listInstallationRepositories hit the page cap; some repositories may be omitted.");
    return repositories;
  }
}

export const githubAppClient = new GitHubAppClient();
