import type { Repository } from "@prisma/client";

import { prisma } from "../../config/database.js";
import { AppError } from "../../common/errors/app-error.js";
import { getGitProvider } from "../git-providers/provider-registry.js";
import { githubAppClient } from "./github-app.auth.js";

/**
 * GitHub App-only access resolver. Every operation mints a short-lived
 * installation token on demand; credentials are never supplied by customers,
 * persisted, returned to the browser, or logged.
 */

export type RepositoryGitAccess = {
  token: string;
  provider: ReturnType<typeof getGitProvider>;
};

type RepositoryAccessInput = Pick<
  Repository,
  "id" | "organizationId" | "appInstallationId" | "provider"
>;

/** True when a repository carries the required App-installation link. */
export function hasGitAccess(repository: Pick<Repository, "appInstallationId">): boolean {
  return Boolean(repository.appInstallationId);
}

/** Resolves a repository-scoped installation token after checking active access. */
export async function resolveRepositoryToken(
  repository: RepositoryAccessInput
): Promise<RepositoryGitAccess> {
  const installation = await prisma.gitHubAppInstallation.findFirst({
    where: {
      id: repository.appInstallationId,
      organizationId: repository.organizationId,
      suspendedAt: null,
      access: { some: { repositoryId: repository.id } }
    }
  });
  if (installation) {
    const access = await githubAppClient.createInstallationAccessToken(
      installation.installationId
    );
    return { token: access.token, provider: getGitProvider(repository.provider) };
  }

  throw new AppError(
    400,
    "This repository is not accessible through the connected GitHub App.",
    "GITHUB_APP_ACCESS_REQUIRED"
  );
}

/**
 * Organization-scoped App access for calls not tied to one repository (for
 * example username resolution).
 */
export async function resolveOrganizationToken(
  organizationId: string
): Promise<RepositoryGitAccess> {
  const installation = await prisma.gitHubAppInstallation.findFirst({
    where: { organizationId, suspendedAt: null },
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
    "Connect the GitHub App first.",
    "GITHUB_APP_ACCESS_REQUIRED"
  );
}
