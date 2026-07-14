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
 * Org-wide count of unmapped, non-ignored contributor identities, deduped by
 * GitHub username (an unmapped person appears once even if they contribute to
 * several repos). Powers the Overview "unlinked contributors" nudge — an
 * unmapped author is exactly the person who would be invisible in reports.
 */
export async function getUnmappedSummary(actorId: string, organizationId: string) {
  await requireOrganizationMember(actorId, organizationId);

  const identities = await prisma.contributorIdentity.findMany({
    where: {
      repository: { organizationId },
      ignored: false,
      mapping: null
    },
    orderBy: { contributions: "desc" },
    select: {
      externalId: true,
      username: true,
      avatarUrl: true,
      contributions: true,
      repositoryId: true
    }
  });

  // Dedupe by username (lowercased); fall back to externalId for null usernames.
  const byKey = new Map<
    string,
    { username: string | null; avatarUrl: string | null; contributions: number; repositories: Set<string> }
  >();
  for (const identity of identities) {
    const key = identity.username ? `u:${identity.username.toLowerCase()}` : `x:${identity.externalId}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.contributions += identity.contributions;
      existing.repositories.add(identity.repositoryId);
    } else {
      byKey.set(key, {
        username: identity.username,
        avatarUrl: identity.avatarUrl,
        contributions: identity.contributions,
        repositories: new Set([identity.repositoryId])
      });
    }
  }

  const people = [...byKey.values()].sort((a, b) => b.contributions - a.contributions);
  return {
    count: people.length,
    sample: people.slice(0, 6).map((person) => ({
      username: person.username,
      avatarUrl: person.avatarUrl,
      contributions: person.contributions,
      repositoryCount: person.repositories.size
    }))
  };
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
  const credential = repository.credentialId
    ? await prisma.gitCredential.findUnique({ where: { id: repository.credentialId } })
    : null;

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

type MatchConfidence = "high" | "medium";

/** GitHub's privacy relay email (`id+login@users.noreply.github.com`) — encodes
 * a login, never a real address, so it must not count as an email match. */
const GITHUB_NOREPLY = /@users\.noreply\.github\.com$/i;

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Fraction of the employee-name tokens (≥2 chars) that appear in a candidate
 * string (a git username or commit author name), compared compactly. E.g.
 * "Rahim Uddin" vs "rahim-uddin" → 1.0; vs "rahim-dev" → 0.5.
 */
function nameSimilarity(employeeName: string, candidate: string): number {
  const tokens = normalizeName(employeeName)
    .split(" ")
    .filter((token) => token.length >= 2);
  const compact = normalizeName(candidate).replace(/\s+/g, "");

  if (tokens.length === 0 || compact.length === 0) {
    return 0;
  }

  const hits = tokens.filter((token) => compact.includes(token)).length;
  return hits / tokens.length;
}

/**
 * Suggests likely employee matches for the repo's still-unmapped contributor
 * identities, using the *lower-confidence* signals that are NOT auto-applied:
 * a git commit email that matches an employee's account/alias email (strong),
 * or a name/username that looks similar (medium). Exact-username matches are
 * already auto-linked, so they never appear here. Manager confirms each.
 */
export async function suggestContributorMatches(actorId: string, repositoryId: string) {
  const repository = await loadRepository(repositoryId);
  await requireOrganizationRole(actorId, repository.organizationId, MANAGER_ROLES);

  const identities = await prisma.contributorIdentity.findMany({
    where: { repositoryId, ignored: false, mapping: null, username: { not: null } }
  });

  if (identities.length === 0) {
    return [];
  }

  // Active employees plus any declared alias emails, for matching.
  const members = await prisma.organizationMember.findMany({
    where: { organizationId: repository.organizationId, status: "ACTIVE" },
    include: {
      user: {
        include: {
          gitAliases: { where: { organizationId: repository.organizationId } }
        }
      }
    }
  });

  const employees = members.map((member) => ({
    id: member.user.id,
    name: member.user.name,
    emails: new Set(
      [member.user.email, ...member.user.gitAliases.map((alias) => alias.email)]
        .filter((email): email is string => Boolean(email))
        .map((email) => email.toLowerCase())
    )
  }));

  const employeeByEmail = new Map<string, (typeof employees)[number]>();
  for (const employee of employees) {
    for (const email of employee.emails) {
      if (!employeeByEmail.has(email)) {
        employeeByEmail.set(email, employee);
      }
    }
  }

  // Distinct git author email/name per username from this repo's commits.
  const commitRows = await prisma.commit.findMany({
    where: { repositoryId, username: { not: null } },
    select: { username: true, authorEmail: true, authorName: true },
    distinct: ["username", "authorEmail", "authorName"]
  });

  const emailsByUsername = new Map<string, Set<string>>();
  const namesByUsername = new Map<string, Set<string>>();
  for (const row of commitRows) {
    if (!row.username) {
      continue;
    }
    const key = row.username.toLowerCase();
    if (row.authorEmail) {
      const set = emailsByUsername.get(key) ?? new Set<string>();
      set.add(row.authorEmail.toLowerCase());
      emailsByUsername.set(key, set);
    }
    if (row.authorName) {
      const set = namesByUsername.get(key) ?? new Set<string>();
      set.add(row.authorName);
      namesByUsername.set(key, set);
    }
  }

  const results: {
    contributorId: string;
    suggestions: {
      userId: string;
      name: string;
      confidence: MatchConfidence;
      reason: string;
      score: number;
    }[];
  }[] = [];

  for (const identity of identities) {
    if (!identity.username) {
      continue;
    }
    const key = identity.username.toLowerCase();
    const byUser = new Map<
      string,
      { userId: string; name: string; score: number; reason: string }
    >();

    const consider = (
      employee: { id: string; name: string },
      score: number,
      reason: string
    ) => {
      const existing = byUser.get(employee.id);
      if (!existing || score > existing.score) {
        byUser.set(employee.id, { userId: employee.id, name: employee.name, score, reason });
      }
    };

    // Email signal (strong): a real commit email matching an employee account.
    for (const email of emailsByUsername.get(key) ?? []) {
      if (GITHUB_NOREPLY.test(email)) {
        continue;
      }
      const employee = employeeByEmail.get(email);
      if (employee) {
        consider(employee, 0.95, "Git commit email matches their account");
      }
    }

    // Name / username similarity (medium).
    const candidateStrings = [identity.username, ...(namesByUsername.get(key) ?? [])];
    for (const employee of employees) {
      let best = 0;
      for (const candidate of candidateStrings) {
        best = Math.max(best, nameSimilarity(employee.name, candidate));
      }
      if (best >= 0.5) {
        consider(
          employee,
          Math.min(0.55 + 0.3 * best, 0.85),
          best >= 0.99 ? "Name matches" : "Name looks similar"
        );
      }
    }

    const suggestions = [...byUser.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((suggestion) => ({
        userId: suggestion.userId,
        name: suggestion.name,
        confidence: (suggestion.score >= 0.9 ? "high" : "medium") as MatchConfidence,
        reason: suggestion.reason,
        score: Number(suggestion.score.toFixed(2))
      }));

    if (suggestions.length > 0) {
      results.push({ contributorId: identity.id, suggestions });
    }
  }

  return results;
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
