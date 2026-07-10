import type { GitProvider, Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** Normalizes a git username/email for storage and matching (trim + lowercase). */
export function normalizeHandle(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Links every unmapped, non-ignored contributor identity in a repository to an
 * employee whose declared alias `username` matches (case-insensitive). Only the
 * high-confidence username signal is auto-applied here — email/name are left for
 * manual or suggested mapping. Returns the number of new mappings created.
 *
 * Must run inside a transaction so discovery + linking commit together.
 */
export async function autoLinkRepositoryContributors(
  tx: Tx,
  organizationId: string,
  repositoryId: string
): Promise<number> {
  const identities = await tx.contributorIdentity.findMany({
    where: {
      repositoryId,
      ignored: false,
      mapping: null,
      username: { not: null }
    }
  });

  if (identities.length === 0) {
    return 0;
  }

  let created = 0;

  for (const identity of identities) {
    if (!identity.username) {
      continue;
    }

    const alias = await tx.employeeGitAlias.findFirst({
      where: {
        organizationId,
        provider: identity.provider,
        username: { equals: identity.username, mode: "insensitive" }
      }
    });

    if (!alias) {
      continue;
    }

    await tx.employeeGitMapping.create({
      data: {
        organizationId,
        userId: alias.userId,
        contributorIdentityId: identity.id,
        isPrimary: alias.isPrimary
      }
    });
    created += 1;
  }

  return created;
}

/**
 * Reverse pass: when an alias is declared for an employee, retro-links any
 * already-discovered, unmapped identities across the whole org whose username
 * matches — so repos connected *before* the employee existed link up too.
 * Returns the number of new mappings created.
 */
export async function autoLinkAlias(
  tx: Tx,
  params: {
    organizationId: string;
    userId: string;
    provider: GitProvider;
    username: string | null;
    isPrimary: boolean;
  }
): Promise<number> {
  if (!params.username) {
    return 0;
  }

  const identities = await tx.contributorIdentity.findMany({
    where: {
      organizationId: params.organizationId,
      provider: params.provider,
      ignored: false,
      mapping: null,
      username: { equals: params.username, mode: "insensitive" }
    }
  });

  let created = 0;

  for (const identity of identities) {
    await tx.employeeGitMapping.create({
      data: {
        organizationId: params.organizationId,
        userId: params.userId,
        contributorIdentityId: identity.id,
        isPrimary: params.isPrimary
      }
    });
    created += 1;
  }

  return created;
}
