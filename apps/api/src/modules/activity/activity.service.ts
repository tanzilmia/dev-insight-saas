import type { Branch, Prisma, Repository } from "@prisma/client";

import { prisma } from "../../config/database.js";
import { AppError } from "../../common/errors/app-error.js";
import {
  MANAGER_ROLES,
  requireOrganizationMember,
  requireOrganizationRole
} from "../../common/access/organization-access.js";
import { decryptToken } from "../../common/crypto/token-cipher.js";
import {
  classifyCommit,
  hasRiskKeyword,
  isSensitivePath,
  moduleFromPath
} from "../report-engine/commit-classifier.js";
import { getGitProvider } from "../git-providers/provider-registry.js";
import { mergeIntervals, subtractCovered, type Interval } from "./coverage.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 90;
// Detail (stats + files) is one API call per commit — bound it per collection.
const MAX_DETAIL_COMMITS = 150;
const MAX_FILES_PER_COMMIT = 300;
// Multi-branch collection is one listCommits call per branch — bound it. The
// default branch is always collected first.
const MAX_BRANCHES = 25;

type Range = { since?: string; until?: string };

/**
 * Records a fully-collected [since, until] window into the coverage ledger,
 * merging it with any existing intervals for the same (repository, branch) so
 * the ledger stays compact and non-overlapping. Only call this once the range
 * is fully collected (not detail-capped), or the ledger would claim coverage
 * for commits that were never fetched.
 */
export async function recordCoverage(
  repositoryId: string,
  branch: string,
  since: Date,
  until: Date
) {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.repositoryCoverage.findMany({
      where: { repositoryId, branch },
      select: { rangeStart: true, rangeEnd: true }
    });

    const merged = mergeIntervals([
      ...existing.map((row) => ({ start: row.rangeStart, end: row.rangeEnd })),
      { start: since, end: until }
    ]);

    await tx.repositoryCoverage.deleteMany({ where: { repositoryId, branch } });

    for (const interval of merged) {
      const commitCount = await tx.commit.count({
        where: { repositoryId, committedAt: { gte: interval.start, lte: interval.end } }
      });
      await tx.repositoryCoverage.create({
        data: {
          repositoryId,
          branch,
          rangeStart: interval.start,
          rangeEnd: interval.end,
          commitCount
        }
      });
    }
  });
}

/**
 * Returns the sub-ranges of [from, until] that are NOT yet in the coverage
 * ledger for a (repository, branch) — i.e. what still has to be fetched from
 * Git. An empty array means the whole window is already collected. Used by the
 * smart report engine (Phase C).
 */
export async function getMissingRanges(
  repositoryId: string,
  branch: string,
  from: Date,
  until: Date
): Promise<Interval[]> {
  const covered = await prisma.repositoryCoverage.findMany({
    where: { repositoryId, branch },
    select: { rangeStart: true, rangeEnd: true }
  });

  return subtractCovered(
    from,
    until,
    covered.map((row) => ({ start: row.rangeStart, end: row.rangeEnd }))
  );
}

async function loadRepository(repositoryId: string) {
  const repository = await prisma.repository.findUnique({ where: { id: repositoryId } });

  if (!repository) {
    throw new AppError(404, "Repository was not found", "REPOSITORY_NOT_FOUND");
  }

  return repository;
}

function resolveRange(range: Range) {
  const until = range.until ? new Date(range.until) : new Date();
  const since = range.since
    ? new Date(range.since)
    : new Date(until.getTime() - DEFAULT_LOOKBACK_DAYS * DAY_MS);
  return { since, until };
}

/**
 * Manual collection endpoint: fetches commits across all branches of a
 * repository for a date range and stores any that are new. Existing commits are
 * skipped so repeated collection is cheap.
 */
export async function collectActivity(actorId: string, repositoryId: string, range: Range) {
  const repository = await loadRepository(repositoryId);
  await requireOrganizationRole(actorId, repository.organizationId, MANAGER_ROLES);

  const credential = await prisma.gitCredential.findUnique({
    where: { id: repository.credentialId }
  });

  if (!credential) {
    throw new AppError(400, "Connect a GitHub credential first", "NO_CREDENTIAL");
  }

  const { since, until } = resolveRange(range);
  const token = decryptToken(credential.encryptedToken);
  const provider = getGitProvider(credential.provider);

  const result = await ingestRepository(repository, token, provider, since, until);

  await prisma.auditLog.create({
    data: {
      organizationId: repository.organizationId,
      actorId,
      action: "activity.collect",
      entityType: "Repository",
      entityId: repositoryId,
      metadataJson: {
        collected: result.newCollected,
        branchesChecked: result.branchesChecked,
        rangesCollected: result.rangesCollected
      }
    }
  });

  return { range: { since, until }, ...result };
}

/**
 * Lists the repository's branches from the provider and upserts a {@link Branch}
 * row for each (default branch first, capped at {@link MAX_BRANCHES}). Returns
 * the stored rows so collection can key coverage + commit links by branch.
 */
async function syncBranches(
  repository: Repository,
  token: string,
  provider: ReturnType<typeof getGitProvider>
): Promise<Branch[]> {
  const remote = await provider.listBranches(token, repository.owner, repository.name);

  // Default branch first so it is always within the cap.
  const ordered = [...remote]
    .sort((a, b) => {
      const aDefault = a.name === repository.defaultBranch ? 0 : 1;
      const bDefault = b.name === repository.defaultBranch ? 0 : 1;
      return aDefault - bDefault;
    })
    .slice(0, MAX_BRANCHES);

  const rows: Branch[] = [];
  for (const branch of ordered) {
    const isDefault = branch.name === repository.defaultBranch;
    const row = await prisma.branch.upsert({
      where: { repositoryId_name: { repositoryId: repository.id, name: branch.name } },
      create: {
        repositoryId: repository.id,
        name: branch.name,
        isDefault,
        headSha: branch.headSha,
        isProtected: branch.isProtected
      },
      update: {
        isDefault,
        headSha: branch.headSha,
        isProtected: branch.isProtected,
        lastSyncedAt: new Date()
      }
    });
    rows.push(row);
  }

  return rows;
}

/**
 * Core ingestion for a single branch + window: lists the branch's commits,
 * stores new ones (with per-commit stats/files), links every stored commit to
 * the branch via CommitBranch (a shared commit is deduped but linked to each
 * branch), and records per-branch coverage when the window was fully collected.
 * Does NO access checks — callers gate access.
 */
async function ingestBranchRange(
  repository: Repository,
  branch: Branch,
  token: string,
  provider: ReturnType<typeof getGitProvider>,
  since: Date,
  until: Date
) {
  const commits = await provider.listCommits(token, repository.owner, repository.name, {
    since: since.toISOString(),
    until: until.toISOString(),
    branch: branch.name
  });

  if (!commits.length) {
    await recordCoverage(repository.id, branch.name, since, until);
    return { newCollected: 0, detailCapped: false };
  }

  const existing = await prisma.commit.findMany({
    where: { repositoryId: repository.id, sha: { in: commits.map((commit) => commit.sha) } },
    select: { id: true, sha: true }
  });
  const idBySha = new Map(existing.map((commit) => [commit.sha, commit.id]));
  const newCommits = commits.filter((commit) => !idBySha.has(commit.sha));
  const toCollect = newCommits.slice(0, MAX_DETAIL_COMMITS);

  let collected = 0;
  for (const commit of toCollect) {
    const detail = await provider.getCommitDetail(
      token,
      repository.owner,
      repository.name,
      commit.sha
    );

    const createdId = await prisma.$transaction(async (tx) => {
      const created = await tx.commit.create({
        data: {
          repositoryId: repository.id,
          sha: commit.sha,
          message: commit.message,
          authorName: commit.authorName,
          authorEmail: commit.authorEmail,
          username: commit.username,
          committedAt: new Date(commit.committedAt),
          additions: detail.additions,
          deletions: detail.deletions,
          changedFilesCount: detail.changedFilesCount
        }
      });

      if (detail.files.length) {
        await tx.changedFile.createMany({
          data: detail.files.slice(0, MAX_FILES_PER_COMMIT).map((file) => ({
            commitId: created.id,
            filePath: file.filePath,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
            changes: file.changes
          }))
        });
      }

      return created.id;
    });

    idBySha.set(commit.sha, createdId);
    collected += 1;
  }

  // Link every stored commit in this window to the branch (idempotent).
  const links = commits
    .map((commit) => idBySha.get(commit.sha))
    .filter((commitId): commitId is string => Boolean(commitId))
    .map((commitId) => ({ commitId, branchId: branch.id }));
  if (links.length) {
    await prisma.commitBranch.createMany({ data: links, skipDuplicates: true });
  }

  const detailCapped = newCommits.length > MAX_DETAIL_COMMITS;
  // Only mark the window covered when it was fully collected — a capped run left
  // commits unfetched, so the range must stay "missing" for a later pass.
  if (!detailCapped) {
    await recordCoverage(repository.id, branch.name, since, until);
  }

  return { newCollected: collected, detailCapped };
}

/**
 * Collects a repository across all (capped) branches for a window. Fast-paths to
 * zero Git calls when every already-known branch fully covers the window (so a
 * repeat request for a fixed past range does nothing); otherwise refreshes the
 * branch list (catching new branches) and fetches only each branch's missing
 * sub-ranges.
 */
async function ingestRepository(
  repository: Repository,
  token: string,
  provider: ReturnType<typeof getGitProvider>,
  since: Date,
  until: Date
) {
  const known = await prisma.branch.findMany({
    where: { repositoryId: repository.id },
    select: { name: true }
  });

  if (known.length) {
    let allCovered = true;
    for (const branch of known) {
      const missing = await getMissingRanges(repository.id, branch.name, since, until);
      if (missing.length) {
        allCovered = false;
        break;
      }
    }
    if (allCovered) {
      return { branchesChecked: known.length, branchesCollected: 0, rangesCollected: 0, newCollected: 0 };
    }
  }

  const branches = await syncBranches(repository, token, provider);
  let branchesCollected = 0;
  let rangesCollected = 0;
  let newCollected = 0;

  for (const branch of branches) {
    const missing = await getMissingRanges(repository.id, branch.name, since, until);
    if (!missing.length) {
      continue;
    }
    for (const gap of missing) {
      const result = await ingestBranchRange(repository, branch, token, provider, gap.start, gap.end);
      rangesCollected += 1;
      newCollected += result.newCollected;
    }
    branchesCollected += 1;
  }

  return { branchesChecked: branches.length, branchesCollected, rangesCollected, newCollected };
}

export type CollectScope = {
  organizationId: string;
  repositoryId?: string;
  projectId?: string;
  employeeIds?: string[];
};

/** Resolves the repositories a report scope touches, so we know what to collect. */
async function resolveScopeRepositories(scope: CollectScope): Promise<Repository[]> {
  if (scope.repositoryId) {
    const repository = await prisma.repository.findFirst({
      where: { id: scope.repositoryId, organizationId: scope.organizationId }
    });
    return repository ? [repository] : [];
  }

  if (scope.projectId) {
    return prisma.repository.findMany({
      where: { organizationId: scope.organizationId, projectId: scope.projectId }
    });
  }

  if (scope.employeeIds?.length) {
    // Employee/team scope → only the repos those employees are mapped into.
    const mappings = await prisma.employeeGitMapping.findMany({
      where: { organizationId: scope.organizationId, userId: { in: scope.employeeIds } },
      include: { contributorIdentity: { select: { repositoryId: true } } }
    });
    const repositoryIds = [
      ...new Set(mappings.map((mapping) => mapping.contributorIdentity.repositoryId))
    ];
    if (!repositoryIds.length) {
      return [];
    }
    return prisma.repository.findMany({
      where: { id: { in: repositoryIds }, organizationId: scope.organizationId }
    });
  }

  // No specific target → every repo in the org (bounded fallback).
  return prisma.repository.findMany({ where: { organizationId: scope.organizationId } });
}

/**
 * Smart-engine entry point (Phase C): before a report is built, make sure the
 * [from, until] window is in the DB for every repository the report touches.
 * For each repo it consults the coverage ledger and fetches ONLY the missing
 * sub-ranges from Git (using the org's stored credential — never a personal
 * PAT). Resilient: a repo that has no credential or errors is skipped with a
 * warning so the report is still produced from whatever is already stored.
 */
export async function ensureActivityCollected(
  scope: CollectScope,
  from: Date,
  until: Date
): Promise<{ repositoriesChecked: number; rangesCollected: number; warnings: string[] }> {
  const repositories = await resolveScopeRepositories(scope);
  const warnings: string[] = [];
  let rangesCollected = 0;

  for (const repository of repositories) {
    try {
      const credential = await prisma.gitCredential.findUnique({
        where: { id: repository.credentialId }
      });
      if (!credential) {
        warnings.push(`${repository.fullName}: no Git credential, skipped`);
        continue;
      }

      const token = decryptToken(credential.encryptedToken);
      const provider = getGitProvider(credential.provider);
      const result = await ingestRepository(repository, token, provider, from, until);
      rangesCollected += result.rangesCollected;
    } catch (error) {
      warnings.push(
        `${repository.fullName}: collection failed (${(error as Error).message})`
      );
    }
  }

  return { repositoriesChecked: repositories.length, rangesCollected, warnings };
}

export async function getActivitySummary(actorId: string, repositoryId: string, range: Range) {
  const repository = await loadRepository(repositoryId);
  await requireOrganizationMember(actorId, repository.organizationId);

  const { since, until } = resolveRange(range);
  const where: Prisma.CommitWhereInput = {
    repositoryId,
    committedAt: { gte: since, lte: until }
  };

  const [totals, recent] = await Promise.all([
    prisma.commit.aggregate({
      where,
      _count: { _all: true },
      _sum: { additions: true, deletions: true, changedFilesCount: true }
    }),
    prisma.commit.findMany({
      where,
      orderBy: { committedAt: "desc" },
      take: 10,
      select: {
        sha: true,
        message: true,
        authorName: true,
        username: true,
        committedAt: true,
        additions: true,
        deletions: true,
        changedFilesCount: true
      }
    })
  ]);

  return {
    range: { since, until },
    stats: {
      commits: totals._count._all,
      additions: totals._sum.additions ?? 0,
      deletions: totals._sum.deletions ?? 0,
      filesChanged: totals._sum.changedFilesCount ?? 0
    },
    recent: recent.map((commit) => ({
      sha: commit.sha.slice(0, 7),
      message: commit.message.split("\n")[0]!.slice(0, 120),
      author: commit.username ?? commit.authorName,
      committedAt: commit.committedAt,
      additions: commit.additions,
      deletions: commit.deletions,
      changedFilesCount: commit.changedFilesCount
    }))
  };
}

/** Lists a repository's tracked branches with per-branch commit counts (Phase D). */
export async function getRepositoryBranches(actorId: string, repositoryId: string) {
  const repository = await loadRepository(repositoryId);
  await requireOrganizationMember(actorId, repository.organizationId);

  const branches = await prisma.branch.findMany({
    where: { repositoryId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    include: { _count: { select: { commits: true } } }
  });

  return branches.map((branch) => ({
    id: branch.id,
    name: branch.name,
    isDefault: branch.isDefault,
    isProtected: branch.isProtected,
    headSha: branch.headSha,
    commitCount: branch._count.commits,
    lastSyncedAt: branch.lastSyncedAt
  }));
}

export type ActivityQuery = {
  organizationId: string;
  repositoryId?: string;
  projectId?: string;
  usernames?: string[];
  since: Date;
  until: Date;
};

function buildCommitWhere(input: ActivityQuery): Prisma.CommitWhereInput {
  return {
    repository: {
      organizationId: input.organizationId,
      ...(input.projectId ? { projectId: input.projectId } : {})
    },
    committedAt: { gte: input.since, lte: input.until },
    ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}),
    ...(input.usernames?.length ? { username: { in: input.usernames } } : {})
  };
}

/**
 * Aggregates stored commit activity for a target (repo/project) and optional
 * set of Git usernames within a date range. Used by OpenClaw's
 * fetch_git_activity tool to power reports.
 */
export async function aggregateActivity(input: ActivityQuery) {
  const totals = await prisma.commit.aggregate({
    where: buildCommitWhere(input),
    _count: { _all: true },
    _sum: { additions: true, deletions: true, changedFilesCount: true }
  });

  return {
    commits: totals._count._all,
    additions: totals._sum.additions ?? 0,
    deletions: totals._sum.deletions ?? 0,
    filesChanged: totals._sum.changedFilesCount ?? 0
  };
}

/** Recent commits for the same query, used to give the LLM real material. */
export async function sampleCommits(input: ActivityQuery, limit = 30) {
  const commits = await prisma.commit.findMany({
    where: buildCommitWhere(input),
    orderBy: { committedAt: "desc" },
    take: limit,
    select: {
      sha: true,
      message: true,
      authorName: true,
      username: true,
      committedAt: true,
      additions: true,
      deletions: true
    }
  });

  return commits.map((commit) => ({
    sha: commit.sha.slice(0, 7),
    message: commit.message.split("\n")[0]!.slice(0, 140),
    author: commit.username ?? commit.authorName,
    additions: commit.additions,
    deletions: commit.deletions
  }));
}

export type EmployeeLeaderboardRow = {
  rank: number;
  employeeId: string | null;
  name: string;
  usernames: string[];
  mapped: boolean;
  commits: number;
  additions: number;
  deletions: number;
  filesChanged: number;
  lines: number;
  sampleMessages: string[];
};

/**
 * Per-contributor leaderboard (Phase F) for a scope + range: groups commits by
 * Git username, folds multiple usernames of the same mapped employee together,
 * ranks by lines changed (additions + deletions), and attaches a few recent
 * commit messages per person for the "who did what" narrative. Unmapped Git
 * usernames appear under their own name, flagged `mapped: false`.
 */
export async function buildEmployeeLeaderboard(
  input: ActivityQuery,
  samplePerEmployee = 5
): Promise<EmployeeLeaderboardRow[]> {
  const where = buildCommitWhere(input);

  const grouped = await prisma.commit.groupBy({
    by: ["username"],
    where,
    _count: { _all: true },
    _sum: { additions: true, deletions: true, changedFilesCount: true }
  });

  if (!grouped.length) {
    return [];
  }

  const mappings = await prisma.employeeGitMapping.findMany({
    where: { organizationId: input.organizationId },
    include: {
      user: { select: { id: true, name: true } },
      contributorIdentity: { select: { username: true } }
    }
  });
  const employeeByUsername = new Map<string, { id: string; name: string }>();
  for (const mapping of mappings) {
    const username = mapping.contributorIdentity.username;
    if (username) {
      employeeByUsername.set(username, { id: mapping.user.id, name: mapping.user.name });
    }
  }

  const keyFor = (username: string | null) => {
    const employee = username ? employeeByUsername.get(username) : undefined;
    return { key: employee?.id ?? username ?? "__unknown__", employee };
  };

  const rows = new Map<string, EmployeeLeaderboardRow>();
  for (const group of grouped) {
    const { key, employee } = keyFor(group.username);
    const additions = group._sum.additions ?? 0;
    const deletions = group._sum.deletions ?? 0;
    const filesChanged = group._sum.changedFilesCount ?? 0;
    const commits = group._count._all;
    const existing = rows.get(key);

    if (existing) {
      existing.commits += commits;
      existing.additions += additions;
      existing.deletions += deletions;
      existing.filesChanged += filesChanged;
      existing.lines += additions + deletions;
      if (group.username && !existing.usernames.includes(group.username)) {
        existing.usernames.push(group.username);
      }
    } else {
      rows.set(key, {
        rank: 0,
        employeeId: employee?.id ?? null,
        name: employee?.name ?? group.username ?? "Unknown",
        usernames: group.username ? [group.username] : [],
        mapped: Boolean(employee),
        commits,
        additions,
        deletions,
        filesChanged,
        lines: additions + deletions,
        sampleMessages: []
      });
    }
  }

  // Recent commit messages per person for the point-by-point narrative.
  const recent = await prisma.commit.findMany({
    where,
    orderBy: { committedAt: "desc" },
    take: 400,
    select: { username: true, message: true }
  });
  for (const commit of recent) {
    const { key } = keyFor(commit.username);
    const row = rows.get(key);
    if (row && row.sampleMessages.length < samplePerEmployee) {
      row.sampleMessages.push(commit.message.split("\n")[0]!.slice(0, 120));
    }
  }

  const sorted = [...rows.values()].sort(
    (a, b) => b.lines - a.lines || b.commits - a.commits
  );
  sorted.forEach((row, index) => {
    row.rank = index + 1;
  });

  return sorted;
}

const LARGE_COMMIT_THRESHOLD = 400;
const ANALYSIS_COMMIT_CAP = 500;
const ANALYSIS_FILE_CAP = 3000;

export type ActivityAnalysis = {
  categories: Record<string, number>;
  topModules: { module: string; changes: number }[];
  risks: string[];
};

/**
 * Report-engine layer (Phase 9): classifies commits (feature/fix/chore…),
 * buckets changed files into modules, and surfaces risk signals. Feeds the LLM
 * prompt so narratives are grounded in the shape of the work, not just counts.
 */
export async function analyzeActivity(input: ActivityQuery): Promise<ActivityAnalysis> {
  const where = buildCommitWhere(input);

  const commits = await prisma.commit.findMany({
    where,
    orderBy: { committedAt: "desc" },
    take: ANALYSIS_COMMIT_CAP,
    select: { id: true, message: true, additions: true, deletions: true }
  });

  const categories: Record<string, number> = {};
  let riskyCommits = 0;
  let largeCommits = 0;

  for (const commit of commits) {
    const category = classifyCommit(commit.message);
    categories[category] = (categories[category] ?? 0) + 1;
    if (hasRiskKeyword(commit.message)) {
      riskyCommits += 1;
    }
    if (commit.additions + commit.deletions > LARGE_COMMIT_THRESHOLD) {
      largeCommits += 1;
    }
  }

  const files = commits.length
    ? await prisma.changedFile.findMany({
        where: { commitId: { in: commits.map((commit) => commit.id) } },
        select: { filePath: true, changes: true },
        take: ANALYSIS_FILE_CAP
      })
    : [];

  const moduleChanges: Record<string, number> = {};
  let sensitiveHits = 0;

  for (const file of files) {
    const bucket = moduleFromPath(file.filePath);
    moduleChanges[bucket] = (moduleChanges[bucket] ?? 0) + (file.changes || 0);
    if (isSensitivePath(file.filePath)) {
      sensitiveHits += 1;
    }
  }

  const topModules = Object.entries(moduleChanges)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([module, changes]) => ({ module, changes }));

  const risks: string[] = [];
  if (riskyCommits) {
    risks.push(`${riskyCommits} commit(s) flagged by keyword (revert/hotfix/security)`);
  }
  if (largeCommits) {
    risks.push(`${largeCommits} unusually large commit(s)`);
  }
  if (sensitiveHits) {
    risks.push(
      `${sensitiveHits} change(s) to sensitive paths (auth/security/migrations/.env)`
    );
  }

  return { categories, topModules, risks };
}
