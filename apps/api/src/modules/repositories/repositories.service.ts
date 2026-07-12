import { randomBytes } from "node:crypto";

import type { Prisma, Repository } from "@prisma/client";

import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import { AppError } from "../../common/errors/app-error.js";
import {
  MANAGER_ROLES,
  requireOrganizationMember,
  requireOrganizationRole
} from "../../common/access/organization-access.js";
import { decryptToken, encryptToken } from "../../common/crypto/token-cipher.js";
import { getGitProvider } from "../git-providers/provider-registry.js";
import { REPO_AFFILIATIONS, type RepoAffiliation } from "../git-providers/git-provider.js";
import { discoverContributorsForRepository } from "../contributors/contributors.service.js";

type RepositoryInput = {
  externalId: string;
  owner: string;
  name: string;
  fullName: string;
  remoteUrl: string;
  isPrivate: boolean;
  defaultBranch?: string | null;
};

type RepositoryWithProject = Repository & {
  project: { id: string; name: string } | null;
  _count: { commits: number };
};

function toRepository(repository: RepositoryWithProject) {
  return {
    id: repository.id,
    provider: repository.provider,
    externalId: repository.externalId,
    owner: repository.owner,
    name: repository.name,
    fullName: repository.fullName,
    remoteUrl: repository.remoteUrl,
    isPrivate: repository.isPrivate,
    defaultBranch: repository.defaultBranch,
    project: repository.project,
    commitCount: repository._count.commits,
    lastSyncedAt: repository.lastSyncedAt,
    // Live-sync state only — the webhook secret never leaves the backend.
    liveSync: {
      status: (repository.webhookStatus as "ACTIVE" | "ERROR" | null) ?? null,
      lastWebhookAt: repository.lastWebhookAt
    },
    createdAt: repository.createdAt,
    updatedAt: repository.updatedAt
  };
}

const projectSelect = {
  project: { select: { id: true, name: true } },
  _count: { select: { commits: true } }
} satisfies Prisma.RepositoryInclude;

/**
 * Parses the credential's stored repo-access CSV into known affiliation
 * values; falls back to all affiliations when empty or unrecognized.
 */
function credentialAffiliations(credential: { repoAffiliations: string }): RepoAffiliation[] {
  const known = credential.repoAffiliations
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is RepoAffiliation =>
      (REPO_AFFILIATIONS as readonly string[]).includes(value)
    );

  return known.length ? known : [...REPO_AFFILIATIONS];
}

/** Loads the organization's GitHub credential or throws a helpful error. */
async function getOrganizationCredential(organizationId: string) {
  const credential = await prisma.gitCredential.findFirst({
    where: { organizationId, provider: "GITHUB" }
  });

  if (!credential) {
    throw new AppError(400, "Connect a GitHub credential first", "NO_CREDENTIAL");
  }

  return credential;
}

async function loadRepository(repositoryId: string) {
  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId }
  });

  if (!repository) {
    throw new AppError(404, "Repository was not found", "REPOSITORY_NOT_FOUND");
  }

  return repository;
}

/**
 * Fetches the live repository list from the provider using the stored token,
 * annotated with whether each repo is already tracked. Does not persist.
 */
export async function syncRepositories(actorId: string, organizationId: string) {
  await requireOrganizationRole(actorId, organizationId, MANAGER_ROLES);

  const credential = await getOrganizationCredential(organizationId);
  const token = decryptToken(credential.encryptedToken);
  const available = await getGitProvider(credential.provider).listRepositories(token, {
    affiliations: credentialAffiliations(credential)
  });

  const tracked = await prisma.repository.findMany({
    where: { organizationId },
    select: { externalId: true }
  });
  const trackedIds = new Set(tracked.map((repo) => repo.externalId));

  return available.map((repo) => ({
    ...repo,
    tracked: trackedIds.has(repo.externalId)
  }));
}

export async function listRepositories(actorId: string, organizationId: string) {
  await requireOrganizationMember(actorId, organizationId);

  const repositories = await prisma.repository.findMany({
    where: { organizationId },
    include: projectSelect,
    orderBy: { fullName: "asc" }
  });

  return repositories.map(toRepository);
}

/** Persists (upserts) the chosen repositories as tracked for the org. */
export async function selectRepositories(
  actorId: string,
  organizationId: string,
  repositories: RepositoryInput[]
) {
  await requireOrganizationRole(actorId, organizationId, MANAGER_ROLES);

  const credential = await getOrganizationCredential(organizationId);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    for (const repo of repositories) {
      await tx.repository.upsert({
        where: {
          organizationId_provider_externalId: {
            organizationId,
            provider: credential.provider,
            externalId: repo.externalId
          }
        },
        create: {
          organizationId,
          credentialId: credential.id,
          provider: credential.provider,
          externalId: repo.externalId,
          owner: repo.owner,
          name: repo.name,
          fullName: repo.fullName,
          remoteUrl: repo.remoteUrl,
          isPrivate: repo.isPrivate,
          defaultBranch: repo.defaultBranch ?? null,
          lastSyncedAt: now
        },
        update: {
          credentialId: credential.id,
          owner: repo.owner,
          name: repo.name,
          fullName: repo.fullName,
          remoteUrl: repo.remoteUrl,
          isPrivate: repo.isPrivate,
          defaultBranch: repo.defaultBranch ?? null,
          lastSyncedAt: now
        }
      });
    }

    await tx.auditLog.create({
      data: {
        organizationId,
        actorId,
        action: "repository.select",
        entityType: "Repository",
        metadataJson: { count: repositories.length }
      }
    });
  });

  // Auto-discover contributors for the just-connected repos so their commits map
  // to employees immediately — no separate "Discover" step. Best-effort and
  // sequential: a repo whose contributors can't be fetched (permissions, rate
  // limit) is skipped with a warning, never failing the whole selection.
  const trackedRepos = await prisma.repository.findMany({
    where: {
      organizationId,
      provider: credential.provider,
      externalId: { in: repositories.map((repo) => repo.externalId) }
    }
  });

  for (const repo of trackedRepos) {
    try {
      await discoverContributorsForRepository(repo, actorId);
    } catch (error) {
      console.warn(
        `Auto-discovery failed for ${repo.fullName}; contributors can still be discovered manually.`,
        error
      );
    }

    // Zero-friction live sync: auto-register the push webhook the moment a
    // repo is tracked (when the server has a public URL and the hook isn't
    // already set). Best-effort — a PAT without hook permission just logs.
    if (env.PUBLIC_API_URL && !repo.webhookExternalId) {
      try {
        await registerWebhook(repo);
      } catch (error) {
        console.warn(
          `Live-sync auto-enable failed for ${repo.fullName}; it can be enabled from the Repositories page.`,
          error
        );
      }
    }
  }

  return listRepositories(actorId, organizationId);
}

export async function assignRepositoryProject(
  actorId: string,
  repositoryId: string,
  projectId: string | null
) {
  const repository = await loadRepository(repositoryId);
  await requireOrganizationRole(actorId, repository.organizationId, MANAGER_ROLES);

  if (projectId) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: repository.organizationId }
    });

    if (!project) {
      throw new AppError(400, "That project is not in this organization", "PROJECT_NOT_IN_ORG");
    }
  }

  const updated = await prisma.repository.update({
    where: { id: repositoryId },
    data: { projectId },
    include: projectSelect
  });

  await prisma.auditLog.create({
    data: {
      organizationId: repository.organizationId,
      actorId,
      action: "repository.assign_project",
      entityType: "Repository",
      entityId: repositoryId,
      metadataJson: { projectId }
    }
  });

  return toRepository(updated);
}

export async function resyncRepository(actorId: string, repositoryId: string) {
  const repository = await loadRepository(repositoryId);
  await requireOrganizationRole(actorId, repository.organizationId, MANAGER_ROLES);

  const credential = await prisma.gitCredential.findUnique({
    where: { id: repository.credentialId }
  });

  if (!credential) {
    throw new AppError(400, "Connect a GitHub credential first", "NO_CREDENTIAL");
  }

  const token = decryptToken(credential.encryptedToken);
  const available = await getGitProvider(credential.provider).listRepositories(token);
  const match = available.find((repo) => repo.externalId === repository.externalId);

  if (!match) {
    throw new AppError(
      404,
      "This repository is no longer accessible with the stored token",
      "REPO_NOT_ON_PROVIDER"
    );
  }

  const updated = await prisma.repository.update({
    where: { id: repositoryId },
    data: {
      owner: match.owner,
      name: match.name,
      fullName: match.fullName,
      remoteUrl: match.remoteUrl,
      isPrivate: match.isPrivate,
      defaultBranch: match.defaultBranch,
      lastSyncedAt: new Date()
    },
    include: projectSelect
  });

  return toRepository(updated);
}

/**
 * Registers the push webhook for a repository using the org's stored PAT —
 * the user never touches GitHub settings. Core is auth-free so tracking can
 * auto-enable best-effort; the exported wrappers gate access.
 */
async function registerWebhook(repository: Repository) {
  if (!env.PUBLIC_API_URL) {
    throw new AppError(
      400,
      "Live sync needs a public API URL. Set PUBLIC_API_URL on the server first.",
      "LIVE_SYNC_UNAVAILABLE"
    );
  }

  const credential = await prisma.gitCredential.findUnique({
    where: { id: repository.credentialId }
  });
  if (!credential) {
    throw new AppError(400, "Connect a GitHub credential first", "NO_CREDENTIAL");
  }

  const token = decryptToken(credential.encryptedToken);
  const provider = getGitProvider(credential.provider);

  // Rotate: drop a previous hook so re-enabling mints a fresh secret.
  if (repository.webhookExternalId) {
    await provider
      .deleteWebhook(token, repository.owner, repository.name, repository.webhookExternalId)
      .catch(() => {});
  }

  const secret = randomBytes(32).toString("hex");
  const hookUrl = `${env.PUBLIC_API_URL.replace(/\/$/, "")}/api/webhooks/github/${repository.id}`;
  const hook = await provider.createWebhook(
    token,
    repository.owner,
    repository.name,
    hookUrl,
    secret
  );

  return prisma.repository.update({
    where: { id: repository.id },
    data: {
      webhookExternalId: hook.externalId,
      webhookSecret: encryptToken(secret),
      webhookStatus: "ACTIVE"
    },
    include: projectSelect
  });
}

/** Best-effort webhook removal on the provider; local columns cleared by callers. */
async function removeWebhook(repository: Repository) {
  if (!repository.webhookExternalId) {
    return;
  }
  try {
    const credential = await prisma.gitCredential.findUnique({
      where: { id: repository.credentialId }
    });
    if (!credential) {
      return;
    }
    const token = decryptToken(credential.encryptedToken);
    await getGitProvider(credential.provider).deleteWebhook(
      token,
      repository.owner,
      repository.name,
      repository.webhookExternalId
    );
  } catch (error) {
    console.warn(`Webhook cleanup failed for ${repository.fullName} (continuing).`, error);
  }
}

export async function enableLiveSync(actorId: string, repositoryId: string) {
  const repository = await loadRepository(repositoryId);
  await requireOrganizationRole(actorId, repository.organizationId, MANAGER_ROLES);

  const updated = await registerWebhook(repository);

  await prisma.auditLog.create({
    data: {
      organizationId: repository.organizationId,
      actorId,
      action: "repository.live_sync.enable",
      entityType: "Repository",
      entityId: repository.id,
      metadataJson: { fullName: repository.fullName }
    }
  });

  return toRepository(updated);
}

export async function disableLiveSync(actorId: string, repositoryId: string) {
  const repository = await loadRepository(repositoryId);
  await requireOrganizationRole(actorId, repository.organizationId, MANAGER_ROLES);

  await removeWebhook(repository);
  const updated = await prisma.repository.update({
    where: { id: repository.id },
    data: {
      webhookExternalId: null,
      webhookSecret: null,
      webhookStatus: null,
      lastWebhookAt: null
    },
    include: projectSelect
  });

  await prisma.auditLog.create({
    data: {
      organizationId: repository.organizationId,
      actorId,
      action: "repository.live_sync.disable",
      entityType: "Repository",
      entityId: repository.id,
      metadataJson: { fullName: repository.fullName }
    }
  });

  return toRepository(updated);
}

export async function untrackRepository(actorId: string, repositoryId: string) {
  const repository = await loadRepository(repositoryId);
  await requireOrganizationRole(actorId, repository.organizationId, MANAGER_ROLES);

  // Leave no orphan hook behind on GitHub (best-effort).
  await removeWebhook(repository);

  await prisma.$transaction(async (tx) => {
    await tx.repository.delete({ where: { id: repositoryId } });

    await tx.auditLog.create({
      data: {
        organizationId: repository.organizationId,
        actorId,
        action: "repository.untrack",
        entityType: "Repository",
        entityId: repositoryId,
        metadataJson: { fullName: repository.fullName }
      }
    });
  });

  return { id: repositoryId };
}
