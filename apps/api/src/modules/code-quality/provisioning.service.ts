import type { Repository } from "@prisma/client";

import {
  MANAGER_ROLES,
  requireOrganizationRole
} from "../../common/access/organization-access.js";
import { AppError } from "../../common/errors/app-error.js";
import { encryptToken } from "../../common/crypto/token-cipher.js";
import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import { enableCi } from "../ci/ci.service.js";
import { getDevOpsProvider } from "../devops-providers/devops-provider-registry.js";
import { resolveRepositoryToken } from "../github-app/repository-token.js";

import { getCodeQualityProvider } from "./code-quality-registry.js";

/**
 * Multi-tenant code-quality provisioning: wire a client repository for automated
 * SonarQube scanning end-to-end.
 *
 *   1. ensure a SonarQube project exists for the repo (admin API)
 *   2. mint a fresh per-project analysis token
 *   3. inject SONAR_TOKEN + SONAR_HOST_URL as the repo's GitHub Actions secrets
 *      (the App's `secrets: write` permission is required)
 *   4. persist the mapping + (encrypted) token, then open/refresh the managed-
 *      workflow PR so its code-quality job lands on merge
 *
 * Reading results is already handled elsewhere (the code-quality overview /
 * appraisal resolve the project key). Everything here is manager-gated and
 * audit-logged. Best-effort philosophy does NOT apply — provisioning is an
 * explicit action, so failures surface as clear errors.
 */

/** Sonar project keys allow [a-zA-Z0-9_.-]; the prefix guarantees a non-numeric key. */
function makeProjectKey(repository: Repository): string {
  if (repository.sonarProjectKey?.trim()) return repository.sonarProjectKey.trim();
  const slug = `${repository.owner}-${repository.name}`.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 380);
  return `devinside-${slug}`;
}

export async function provisionRepositoryCodeQuality(actorId: string, repositoryId: string) {
  const repository = await prisma.repository.findUnique({ where: { id: repositoryId } });
  if (!repository) {
    throw new AppError(404, "Repository was not found", "REPOSITORY_NOT_FOUND");
  }
  await requireOrganizationRole(actorId, repository.organizationId, MANAGER_ROLES);

  // The public URL a GitHub-hosted runner uses to reach SonarQube (distinct from
  // SONAR_BASE_URL, which is how THIS API reaches it inside Docker). Without it we
  // cannot inject a working host URL, so refuse rather than provision a broken scan.
  const hostUrl = env.SONAR_PUBLIC_URL;
  if (!hostUrl) {
    throw new AppError(
      400,
      "Automated code-quality scanning is not configured. Set SONAR_PUBLIC_URL (the externally reachable SonarQube URL) on the API.",
      "CODE_QUALITY_PUBLIC_URL_UNSET"
    );
  }

  const provider = await getCodeQualityProvider(repository.organizationId);
  if (!provider.available) {
    throw new AppError(
      400,
      "Connect SonarQube first (Code Quality → Connection), then enable scanning for this repository.",
      "CODE_QUALITY_NOT_CONFIGURED"
    );
  }
  if (!provider.ensureProject || !provider.generateProjectToken) {
    throw new AppError(
      400,
      "The configured code-quality provider does not support automated provisioning.",
      "CODE_QUALITY_PROVISION_UNSUPPORTED"
    );
  }

  // Resolve GitHub access up front (App installation token) — a repo with no
  // access can't receive secrets, so fail before touching SonarQube.
  const { token: ghToken } = await resolveRepositoryToken(repository);
  const devops = getDevOpsProvider(repository.provider);
  const ref = { owner: repository.owner, repo: repository.name };

  const projectKey = makeProjectKey(repository);
  const tokenName = `devinside-${projectKey}`.slice(0, 100);

  // 1 + 2: SonarQube project + fresh analysis token.
  await provider.ensureProject(projectKey, repository.fullName);
  const analysisToken = await provider.generateProjectToken(projectKey, tokenName);

  // 3: inject the repo secrets the scan job reads.
  await devops.putRepoSecret(ghToken, ref, "SONAR_TOKEN", analysisToken);
  await devops.putRepoSecret(ghToken, ref, "SONAR_HOST_URL", hostUrl);

  // 4a: persist the mapping + encrypted token + provisioned marker.
  await prisma.$transaction(async (tx) => {
    await tx.repository.update({
      where: { id: repository.id },
      data: {
        sonarProjectKey: projectKey,
        sonarTokenCipher: encryptToken(analysisToken),
        sonarProvisionedAt: new Date()
      }
    });
    await tx.auditLog.create({
      data: {
        organizationId: repository.organizationId,
        actorId,
        action: "code_quality.provision",
        entityType: "Repository",
        entityId: repository.id,
        metadataJson: { fullName: repository.fullName, projectKey }
      }
    });
  });

  // 4b: open/refresh the managed-workflow PR so the code-quality job lands. The
  // repo now reads as provisioned, so enableCi bakes the Sonar scan job in.
  const ci = await enableCi(actorId, repository.id);

  return {
    provisioned: true,
    projectKey,
    provisionedAt: new Date().toISOString(),
    sonarHostUrl: hostUrl,
    ci
  };
}

/**
 * Turns off automated scanning for a repo: clears the provisioning marker so the
 * managed workflow drops its Sonar job on the next update. Leaves the SonarQube
 * project + its historical results intact (they stay readable). Manager-gated.
 */
export async function deprovisionRepositoryCodeQuality(actorId: string, repositoryId: string) {
  const repository = await prisma.repository.findUnique({ where: { id: repositoryId } });
  if (!repository) {
    throw new AppError(404, "Repository was not found", "REPOSITORY_NOT_FOUND");
  }
  await requireOrganizationRole(actorId, repository.organizationId, MANAGER_ROLES);

  await prisma.$transaction(async (tx) => {
    await tx.repository.update({
      where: { id: repository.id },
      data: { sonarTokenCipher: null, sonarProvisionedAt: null }
    });
    await tx.auditLog.create({
      data: {
        organizationId: repository.organizationId,
        actorId,
        action: "code_quality.deprovision",
        entityType: "Repository",
        entityId: repository.id,
        metadataJson: { fullName: repository.fullName }
      }
    });
  });

  return { provisioned: false };
}
