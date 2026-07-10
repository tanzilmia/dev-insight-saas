import type { Prisma, Repository } from "@prisma/client";

import { prisma } from "../../config/database.js";
import { AppError } from "../../common/errors/app-error.js";
import {
  MANAGER_ROLES,
  requireOrganizationMember,
  requireOrganizationRole
} from "../../common/access/organization-access.js";
import { decryptToken } from "../../common/crypto/token-cipher.js";
import { getGitProvider } from "../git-providers/provider-registry.js";
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
    createdAt: repository.createdAt,
    updatedAt: repository.updatedAt
  };
}

const projectSelect = {
  project: { select: { id: true, name: true } },
  _count: { select: { commits: true } }
} satisfies Prisma.RepositoryInclude;

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
  const available = await getGitProvider(credential.provider).listRepositories(token);

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

export async function untrackRepository(actorId: string, repositoryId: string) {
  const repository = await loadRepository(repositoryId);
  await requireOrganizationRole(actorId, repository.organizationId, MANAGER_ROLES);

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
