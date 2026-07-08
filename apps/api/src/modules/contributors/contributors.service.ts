import type {
  ContributorIdentity,
  EmployeeGitMapping,
  User
} from "@prisma/client";

import { prisma } from "../../config/database.js";
import { AppError } from "../../common/errors/app-error.js";
import {
  MANAGER_ROLES,
  requireOrganizationMember,
  requireOrganizationRole
} from "../../common/access/organization-access.js";
import { decryptToken } from "../../common/crypto/token-cipher.js";
import { getGitProvider } from "../git-providers/provider-registry.js";

type IdentityWithMapping = ContributorIdentity & {
  mapping: (EmployeeGitMapping & { user: User }) | null;
};

const mappingInclude = {
  mapping: { include: { user: true } }
} as const;

function toContributor(identity: IdentityWithMapping) {
  return {
    id: identity.id,
    externalId: identity.externalId,
    username: identity.username,
    avatarUrl: identity.avatarUrl,
    contributions: identity.contributions,
    ignored: identity.ignored,
    mapping: identity.mapping
      ? {
          userId: identity.mapping.userId,
          name: identity.mapping.user.name,
          email: identity.mapping.user.email,
          isPrimary: identity.mapping.isPrimary
        }
      : null
  };
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

async function loadIdentity(identityId: string) {
  const identity = await prisma.contributorIdentity.findUnique({
    where: { id: identityId }
  });

  if (!identity) {
    throw new AppError(404, "Contributor was not found", "CONTRIBUTOR_NOT_FOUND");
  }

  return identity;
}

/** Reloads an identity with its mapping and returns the public DTO. */
async function getContributorDto(identityId: string) {
  const identity = await prisma.contributorIdentity.findUniqueOrThrow({
    where: { id: identityId },
    include: mappingInclude
  });

  return toContributor(identity);
}

export async function listContributors(actorId: string, repositoryId: string) {
  const repository = await loadRepository(repositoryId);
  await requireOrganizationMember(actorId, repository.organizationId);

  const identities = await prisma.contributorIdentity.findMany({
    where: { repositoryId },
    include: mappingInclude,
    orderBy: { contributions: "desc" }
  });

  return identities.map(toContributor);
}

export async function listUnmappedContributors(actorId: string, repositoryId: string) {
  const repository = await loadRepository(repositoryId);
  await requireOrganizationMember(actorId, repository.organizationId);

  const identities = await prisma.contributorIdentity.findMany({
    where: { repositoryId, ignored: false, mapping: null },
    include: mappingInclude,
    orderBy: { contributions: "desc" }
  });

  return identities.map(toContributor);
}

/** Fetches contributors from the provider and upserts them for the repo. */
export async function discoverContributors(actorId: string, repositoryId: string) {
  const repository = await loadRepository(repositoryId);
  await requireOrganizationRole(actorId, repository.organizationId, MANAGER_ROLES);

  const credential = await prisma.gitCredential.findUnique({
    where: { id: repository.credentialId }
  });

  if (!credential) {
    throw new AppError(400, "Connect a GitHub credential first", "NO_CREDENTIAL");
  }

  const token = decryptToken(credential.encryptedToken);
  const discovered = await getGitProvider(credential.provider).listContributors(
    token,
    repository.owner,
    repository.name
  );

  await prisma.$transaction(async (tx) => {
    for (const contributor of discovered) {
      await tx.contributorIdentity.upsert({
        where: {
          repositoryId_externalId: {
            repositoryId,
            externalId: contributor.externalId
          }
        },
        create: {
          organizationId: repository.organizationId,
          repositoryId,
          provider: credential.provider,
          externalId: contributor.externalId,
          username: contributor.username,
          avatarUrl: contributor.avatarUrl,
          contributions: contributor.contributions
        },
        // Preserve the ignored flag and any existing mapping on refresh.
        update: {
          username: contributor.username,
          avatarUrl: contributor.avatarUrl,
          contributions: contributor.contributions
        }
      });
    }

    await tx.auditLog.create({
      data: {
        organizationId: repository.organizationId,
        actorId,
        action: "contributor.discover",
        entityType: "Repository",
        entityId: repositoryId,
        metadataJson: { count: discovered.length }
      }
    });
  });

  return listContributors(actorId, repositoryId);
}

export async function mapContributor(
  actorId: string,
  identityId: string,
  userId: string,
  isPrimary: boolean
) {
  const identity = await loadIdentity(identityId);
  await requireOrganizationRole(actorId, identity.organizationId, MANAGER_ROLES);

  const targetMembership = await prisma.organizationMember.findFirst({
    where: { organizationId: identity.organizationId, userId, status: "ACTIVE" }
  });

  if (!targetMembership) {
    throw new AppError(
      400,
      "That person is not an active member of this organization",
      "USER_NOT_IN_ORGANIZATION"
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.employeeGitMapping.upsert({
      where: { contributorIdentityId: identityId },
      create: {
        organizationId: identity.organizationId,
        userId,
        contributorIdentityId: identityId,
        isPrimary
      },
      update: { userId, isPrimary }
    });

    await tx.auditLog.create({
      data: {
        organizationId: identity.organizationId,
        actorId,
        action: "contributor.map",
        entityType: "ContributorIdentity",
        entityId: identityId,
        metadataJson: { userId, isPrimary }
      }
    });
  });

  return getContributorDto(identityId);
}

export async function unmapContributor(actorId: string, identityId: string) {
  const identity = await loadIdentity(identityId);
  await requireOrganizationRole(actorId, identity.organizationId, MANAGER_ROLES);

  await prisma.$transaction(async (tx) => {
    await tx.employeeGitMapping.deleteMany({
      where: { contributorIdentityId: identityId }
    });

    await tx.auditLog.create({
      data: {
        organizationId: identity.organizationId,
        actorId,
        action: "contributor.unmap",
        entityType: "ContributorIdentity",
        entityId: identityId
      }
    });
  });

  return getContributorDto(identityId);
}

export async function setContributorIgnored(
  actorId: string,
  identityId: string,
  ignored: boolean
) {
  const identity = await loadIdentity(identityId);
  await requireOrganizationRole(actorId, identity.organizationId, MANAGER_ROLES);

  await prisma.contributorIdentity.update({
    where: { id: identityId },
    data: { ignored }
  });

  await prisma.auditLog.create({
    data: {
      organizationId: identity.organizationId,
      actorId,
      action: "contributor.ignore",
      entityType: "ContributorIdentity",
      entityId: identityId,
      metadataJson: { ignored }
    }
  });

  return getContributorDto(identityId);
}
