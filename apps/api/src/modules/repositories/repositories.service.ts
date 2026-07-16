import type { Prisma, Repository } from "@prisma/client";

import {
  MANAGER_ROLES,
  requireOrganizationMember,
  requireOrganizationRole
} from "../../common/access/organization-access.js";
import { AppError } from "../../common/errors/app-error.js";
import { prisma } from "../../config/database.js";
import { resolveRepositoryToken } from "../github-app/repository-token.js";

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
    sonarProjectKey: repository.sonarProjectKey,
    codeQualityScan: {
      provisioned: Boolean(repository.sonarProvisionedAt),
      provisionedAt: repository.sonarProvisionedAt
    },
    project: repository.project,
    commitCount: repository._count.commits,
    lastSyncedAt: repository.lastSyncedAt,
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

async function loadRepository(repositoryId: string) {
  const repository = await prisma.repository.findUnique({ where: { id: repositoryId } });
  if (!repository) {
    throw new AppError(404, "Repository was not found", "REPOSITORY_NOT_FOUND");
  }
  return repository;
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

export async function setRepositorySonarProjectKey(
  actorId: string,
  repositoryId: string,
  sonarProjectKey: string | null
) {
  const repository = await loadRepository(repositoryId);
  await requireOrganizationRole(actorId, repository.organizationId, MANAGER_ROLES);

  const value = sonarProjectKey?.trim() || null;
  const updated = await prisma.repository.update({
    where: { id: repositoryId },
    data: { sonarProjectKey: value },
    include: projectSelect
  });

  await prisma.auditLog.create({
    data: {
      organizationId: repository.organizationId,
      actorId,
      action: "repository.set_sonar_project",
      entityType: "Repository",
      entityId: repositoryId,
      metadataJson: { sonarProjectKey: value }
    }
  });

  return toRepository(updated);
}

/** Refreshes repository metadata using only its linked GitHub App grant. */
export async function resyncRepository(actorId: string, repositoryId: string) {
  const repository = await loadRepository(repositoryId);
  await requireOrganizationRole(actorId, repository.organizationId, MANAGER_ROLES);

  const { token, provider } = await resolveRepositoryToken(repository);
  const available = await provider.listRepositories(token);
  const match = available.find((repo) => repo.externalId === repository.externalId);

  if (!match) {
    throw new AppError(
      404,
      "This repository is no longer selected for the connected GitHub App.",
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
