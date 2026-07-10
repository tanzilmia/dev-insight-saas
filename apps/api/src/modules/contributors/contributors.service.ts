import type {
  ContributorIdentity,
  EmployeeGitMapping,
  Repository,
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
import type { GitContributor } from "../git-providers/git-provider.js";
import { getGitProvider } from "../git-providers/provider-registry.js";
import { autoLinkRepositoryContributors, normalizeHandle } from "./auto-link.js";

type IdentityWithMapping = ContributorIdentity & {
  mapping: (EmployeeGitMapping & { user: User }) | null;
};

// Automated accounts that are noise in a "who did what" report. GitHub App bots
// use a "[bot]" login suffix; a few common service accounts don't, so they are
// listed explicitly. Matched identities are ignored on first discovery so they
// never clutter the mapping list or get auto-linked.
const KNOWN_BOT_LOGINS = new Set([
  "web-flow",
  "dependabot",
  "dependabot-preview",
  "github-actions",
  "renovate",
  "renovate-bot",
  "greenkeeper",
  "snyk-bot",
  "imgbot",
  "mergify",
  "codecov"
]);

function isBotUsername(username?: string | null): boolean {
  if (!username) {
    return false;
  }
  const login = username.toLowerCase();
  return login.endsWith("[bot]") || KNOWN_BOT_LOGINS.has(login);
}

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

/**
 * Core discovery for a single repository: fetches contributors + collaborators,
 * upserts them as identities (auto-ignoring bot accounts on first insert), and
 * auto-links any that match a declared employee alias. Assumes the caller has
 * already authorized the actor. Returns the number of identities discovered.
 *
 * Exported so repository connection can auto-discover without a separate step.
 */
export async function discoverContributorsForRepository(
  repository: Repository,
  actorId: string | null
): Promise<number> {
  const credential = await prisma.gitCredential.findUnique({
    where: { id: repository.credentialId }
  });

  if (!credential) {
    throw new AppError(400, "Connect a GitHub credential first", "NO_CREDENTIAL");
  }

  const token = decryptToken(credential.encryptedToken);
  const provider = getGitProvider(credential.provider);

  const contributors = await provider.listContributors(
    token,
    repository.owner,
    repository.name
  );

  // Collaborators (people granted repo access, possibly with no commits) are
  // best-effort — listing them can require permissions the token lacks.
  let collaborators: GitContributor[] = [];
  try {
    collaborators = await provider.listCollaborators(
      token,
      repository.owner,
      repository.name
    );
  } catch (error) {
    console.warn(
      `Could not list collaborators for ${repository.fullName}; using commit contributors only.`,
      error
    );
  }

  // Merge: commit contributors keep their counts; collaborators who have not
  // committed are added with 0 contributions so they can still be mapped.
  const byExternalId = new Map<string, GitContributor>();
  for (const contributor of contributors) {
    byExternalId.set(contributor.externalId, contributor);
  }
  for (const collaborator of collaborators) {
    if (!byExternalId.has(collaborator.externalId)) {
      byExternalId.set(collaborator.externalId, collaborator);
    }
  }
  const discovered = [...byExternalId.values()];

  await prisma.$transaction(async (tx) => {
    for (const contributor of discovered) {
      await tx.contributorIdentity.upsert({
        where: {
          repositoryId_externalId: {
            repositoryId: repository.id,
            externalId: contributor.externalId
          }
        },
        create: {
          organizationId: repository.organizationId,
          repositoryId: repository.id,
          provider: credential.provider,
          externalId: contributor.externalId,
          username: contributor.username,
          avatarUrl: contributor.avatarUrl,
          contributions: contributor.contributions,
          // Keep bots out of the mapping list from the start.
          ignored: isBotUsername(contributor.username)
        },
        // Preserve the ignored flag and any existing mapping on refresh.
        update: {
          username: contributor.username,
          avatarUrl: contributor.avatarUrl,
          contributions: contributor.contributions
        }
      });
    }

    // Automatically map any discovered identity to the employee who declared
    // its username as a git alias (high-confidence, exact match only).
    const autoLinked = await autoLinkRepositoryContributors(
      tx,
      repository.organizationId,
      repository.id
    );

    await tx.auditLog.create({
      data: {
        organizationId: repository.organizationId,
        actorId,
        action: "contributor.discover",
        entityType: "Repository",
        entityId: repository.id,
        metadataJson: { count: discovered.length, autoLinked }
      }
    });
  });

  return discovered.length;
}

/** Fetches contributors from the provider and upserts them for the repo. */
export async function discoverContributors(actorId: string, repositoryId: string) {
  const repository = await loadRepository(repositoryId);
  await requireOrganizationRole(actorId, repository.organizationId, MANAGER_ROLES);

  await discoverContributorsForRepository(repository, actorId);

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

    // Remember this username as a declared alias so the same person is mapped
    // automatically in every other repo (present and future), not just here.
    if (identity.username) {
      const username = normalizeHandle(identity.username);
      await tx.employeeGitAlias.upsert({
        where: {
          organizationId_provider_username: {
            organizationId: identity.organizationId,
            provider: identity.provider,
            username
          }
        },
        create: {
          organizationId: identity.organizationId,
          userId,
          provider: identity.provider,
          username,
          isPrimary
        },
        update: { userId, isPrimary }
      });
    }

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
