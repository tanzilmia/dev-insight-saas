import type { Repository } from "@prisma/client";

import { prisma } from "../../config/database.js";
import { AppError } from "../../common/errors/app-error.js";
import { decryptToken } from "../../common/crypto/token-cipher.js";
import { getGitProvider } from "../git-providers/provider-registry.js";
import { githubAppClient } from "./github-app.auth.js";

/**
 * Resolves how to authenticate to Git for a repository. A repository is sourced
 * from EITHER a stored PAT credential OR a GitHub App installation, so the whole
 * collection stack (manual collect, report auto-collect, deep-collection,
 * contributor discovery) goes through this one resolver instead of assuming a
 * PAT. App tokens are short-lived installation access tokens minted on demand —
 * never persisted (same guarantee as the App auth layer).
 */

export type RepositoryGitAccess = {
  token: string;
  provider: ReturnType<typeof getGitProvider>;
};

type RepositoryAccessInput = Pick<Repository, "credentialId" | "appInstallationId" | "provider">;

/** True when a repository can authenticate to Git (a PAT credential or the App). */
export function hasGitAccess(
  repository: Pick<Repository, "credentialId" | "appInstallationId">
): boolean {
  return Boolean(repository.credentialId || repository.appInstallationId);
}

/** Throws NO_CREDENTIAL when the repository has neither a PAT nor an App source. */
export async function resolveRepositoryToken(
  repository: RepositoryAccessInput
): Promise<RepositoryGitAccess> {
  if (repository.credentialId) {
    const credential = await prisma.gitCredential.findUnique({
      where: { id: repository.credentialId }
    });
    if (credential) {
      return {
        token: decryptToken(credential.encryptedToken),
        provider: getGitProvider(credential.provider)
      };
    }
  }

  if (repository.appInstallationId) {
    const installation = await prisma.gitHubAppInstallation.findUnique({
      where: { id: repository.appInstallationId }
    });
    if (installation) {
      // Short-lived installation token, minted per collection run, never stored.
      const access = await githubAppClient.createInstallationAccessToken(
        installation.installationId
      );
      return { token: access.token, provider: getGitProvider(repository.provider) };
    }
  }

  throw new AppError(
    400,
    "This repository has no GitHub access. Connect the GitHub App or a credential.",
    "NO_CREDENTIAL"
  );
}

/**
 * Org-level equivalent for GitHub calls not scoped to one repository (e.g.
 * resolving a username). Uses the org's PAT credential if present, otherwise its
 * GitHub App installation (short-lived token). Throws NO_CREDENTIAL when neither
 * exists.
 */
export async function resolveOrganizationToken(
  organizationId: string
): Promise<RepositoryGitAccess> {
  const credential = await prisma.gitCredential.findFirst({
    where: { organizationId, provider: "GITHUB" }
  });
  if (credential) {
    return {
      token: decryptToken(credential.encryptedToken),
      provider: getGitProvider(credential.provider)
    };
  }

  const installation = await prisma.gitHubAppInstallation.findFirst({
    where: { organizationId },
    orderBy: { createdAt: "asc" }
  });
  if (installation) {
    const access = await githubAppClient.createInstallationAccessToken(
      installation.installationId
    );
    return { token: access.token, provider: getGitProvider("GITHUB") };
  }

  throw new AppError(
    400,
    "Connect the GitHub App or a credential first.",
    "NO_CREDENTIAL"
  );
}
