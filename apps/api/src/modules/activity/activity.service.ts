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
  isNoisePath,
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
// Deep collection: report progress (and check for cancellation) every N stored
// commits, stop bisecting below a 1-hour window or 12 levels deep.
const PROGRESS_EVERY = 25;
const MIN_BISECT_WINDOW_MS = 60 * 60 * 1000;
const MAX_BISECT_DEPTH = 12;
// Auto-collect trailing overlap: near-now report windows re-list the last 48h
// regardless of coverage, catching commit-first-push-later batches.
const NEAR_NOW_MS = 6 * 60 * 60 * 1000;
const AUTO_RELIST_TAIL_MS = 48 * 60 * 60 * 1000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Range = { since?: string; until?: string };

export type IngestOptions = {
  /** Per-window detail-fetch cap. Defaults to {@link MAX_DETAIL_COMMITS}; deep jobs pass Infinity. */
  maxDetailCommits?: number;
  /** Sleep between getCommitDetail calls (ms) so deep jobs stay rate-limit friendly. */
  detailDelayMs?: number;
  /** Recursively split the window when listCommits hits the provider's pagination ceiling. */
  bisectOnTruncation?: boolean;
  /** Called every {@link PROGRESS_EVERY} stored commits. Return "cancel" to stop cleanly. */
  onProgress?: (delta: { newCommits: number }) => Promise<"continue" | "cancel">;
};

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

  // Manual Collect means "make the DB match GitHub for this window": re-list
  // everything (dedup keeps it cheap) so commits pushed after an earlier
  // collection — whose committer dates sit inside "covered" ranges — appear.
  const result = await ingestRepository(repository, token, provider, since, until, {
    forceRelist: true
  });

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
        rangesCollected: result.rangesCollected,
        capped: result.capped
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
export async function syncBranches(
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
 * A capped/cancelled/interrupted run checkpoints the fully-stored newest suffix
 * of the window, so every pass shrinks the missing range and later passes
 * resume instead of restarting. Does NO access checks — callers gate access.
 */
export async function ingestBranchRange(
  repository: Repository,
  branch: Branch,
  token: string,
  provider: ReturnType<typeof getGitProvider>,
  since: Date,
  until: Date,
  options: IngestOptions = {},
  depth = 0
): Promise<{ newCollected: number; detailCapped: boolean; cancelled: boolean }> {
  const commits = await provider.listCommits(token, repository.owner, repository.name, {
    since: since.toISOString(),
    until: until.toISOString(),
    branch: branch.name
  });

  // The provider's pagination ceiling means commits may be silently missing
  // from this listing (it returns the newest ones first).
  const listingTruncated = Boolean(
    provider.maxCommitsPerList && commits.length >= provider.maxCommitsPerList
  );

  if (listingTruncated && options.bisectOnTruncation) {
    if (until.getTime() - since.getTime() > MIN_BISECT_WINDOW_MS && depth < MAX_BISECT_DEPTH) {
      // Split the window and recurse, newest half first (matches collection
      // order elsewhere and keeps partial checkpoints contiguous with `until`).
      const mid = new Date(Math.floor((since.getTime() + until.getTime()) / 2));
      const newer = await ingestBranchRange(
        repository, branch, token, provider, mid, until, options, depth + 1
      );
      if (newer.cancelled) {
        return { ...newer, cancelled: true };
      }
      const older = await ingestBranchRange(
        repository, branch, token, provider, since, mid, options, depth + 1
      );
      return {
        newCollected: newer.newCollected + older.newCollected,
        detailCapped: newer.detailCapped || older.detailCapped,
        cancelled: older.cancelled
      };
    }
    console.warn(
      `[activity] ${repository.fullName}#${branch.name}: window ${since.toISOString()}..${until.toISOString()} still exceeds the listing ceiling at the bisection floor; collecting the newest ${commits.length} commits only.`
    );
  }

  if (!commits.length) {
    await recordCoverage(repository.id, branch.name, since, until);
    return { newCollected: 0, detailCapped: false, cancelled: false };
  }

  const existing = await prisma.commit.findMany({
    where: { repositoryId: repository.id, sha: { in: commits.map((commit) => commit.sha) } },
    select: { id: true, sha: true }
  });
  const idBySha = new Map(existing.map((commit) => [commit.sha, commit.id]));
  const newCommits = commits.filter((commit) => !idBySha.has(commit.sha));
  const cap = options.maxDetailCommits ?? MAX_DETAIL_COMMITS;
  const toCollect = newCommits.slice(0, cap);

  let collected = 0;
  let cancelled = false;
  let pendingProgress = 0;
  let loopError: unknown = null;

  const reportProgress = async () => {
    if (!options.onProgress || pendingProgress === 0) {
      return;
    }
    const verdict = await options.onProgress({ newCommits: pendingProgress });
    pendingProgress = 0;
    if (verdict === "cancel") {
      cancelled = true;
    }
  };

  // Errors (e.g. a rate limit mid-window) must not lose the commits already
  // stored: catch, checkpoint coverage below, then rethrow.
  try {
    for (const commit of toCollect) {
      if (options.detailDelayMs) {
        await sleep(options.detailDelayMs);
      }
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
      pendingProgress += 1;
      if (pendingProgress >= PROGRESS_EVERY) {
        await reportProgress();
        if (cancelled) {
          break;
        }
      }
    }
    await reportProgress();
  } catch (error) {
    loopError = error;
  }

  // Link every stored commit in this window to the branch (idempotent).
  const links = commits
    .map((commit) => idBySha.get(commit.sha))
    .filter((commitId): commitId is string => Boolean(commitId))
    .map((commitId) => ({ commitId, branchId: branch.id }));
  if (links.length) {
    await prisma.commitBranch.createMany({ data: links, skipDuplicates: true });
  }

  const complete = !listingTruncated && loopError === null && collected === newCommits.length;
  if (complete) {
    await recordCoverage(repository.id, branch.name, since, until);
  } else if (collected > 0) {
    // Partial checkpoint: listings are newest-first, so everything from just
    // AFTER the oldest commit we stored up to `until` is now fully collected
    // (older listed commits either pre-existed or were never fetched). The
    // +1ms keeps an unfetched commit sharing that exact timestamp out of the
    // claimed interval — under-covering is safe, over-covering loses data.
    const oldest = toCollect[collected - 1]!;
    const boundary = new Date(new Date(oldest.committedAt).getTime() + 1);
    if (boundary < until) {
      await recordCoverage(repository.id, branch.name, boundary, until);
    }
  }

  if (loopError) {
    throw loopError;
  }

  const detailCapped = listingTruncated || newCommits.length > cap;
  return { newCollected: collected, detailCapped, cancelled };
}

/**
 * Collects a repository across all (capped) branches for a window. Fast-paths to
 * zero Git calls when every already-known branch fully covers the window (so a
 * repeat request for a fixed past range does nothing); otherwise refreshes the
 * branch list (catching new branches) and fetches only each branch's missing
 * sub-ranges.
 */
export type IngestRepositoryOptions = {
  /**
   * Re-list the WHOLE window even where the ledger says it is covered.
   * Needed because coverage means "listed at collection time" — commits made
   * earlier but PUSHED later have committer dates inside covered ranges and
   * would otherwise never be seen again. Sha-dedup keeps re-listing cheap.
   */
  forceRelist?: boolean;
  /** Re-list at least [relistTailFrom, until] regardless of coverage (the
   *  auto-collect trailing overlap for near-now windows). */
  relistTailFrom?: Date;
};

export async function ingestRepository(
  repository: Repository,
  token: string,
  provider: ReturnType<typeof getGitProvider>,
  since: Date,
  until: Date,
  options: IngestRepositoryOptions = {}
) {
  const gapsFor = async (branchName: string): Promise<Interval[]> => {
    if (options.forceRelist) {
      return since < until ? [{ start: since, end: until }] : [];
    }
    const missing = await getMissingRanges(repository.id, branchName, since, until);
    if (options.relistTailFrom && options.relistTailFrom < until) {
      const tailStart = options.relistTailFrom > since ? options.relistTailFrom : since;
      return mergeIntervals([...missing, { start: tailStart, end: until }]);
    }
    return missing;
  };

  const known = await prisma.branch.findMany({
    where: { repositoryId: repository.id },
    select: { name: true }
  });

  if (known.length) {
    let allCovered = true;
    for (const branch of known) {
      const gaps = await gapsFor(branch.name);
      if (gaps.length) {
        allCovered = false;
        break;
      }
    }
    if (allCovered) {
      return {
        branchesChecked: known.length,
        branchesCollected: 0,
        rangesCollected: 0,
        newCollected: 0,
        capped: false
      };
    }
  }

  const branches = await syncBranches(repository, token, provider);
  let branchesCollected = 0;
  let rangesCollected = 0;
  let newCollected = 0;
  let capped = false;

  for (const branch of branches) {
    const gaps = await gapsFor(branch.name);
    if (!gaps.length) {
      continue;
    }
    for (const gap of gaps) {
      const result = await ingestBranchRange(repository, branch, token, provider, gap.start, gap.end);
      rangesCollected += 1;
      newCollected += result.newCollected;
      capped = capped || result.detailCapped;
    }
    branchesCollected += 1;
  }

  return { branchesChecked: branches.length, branchesCollected, rangesCollected, newCollected, capped };
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

  // Near-now windows re-list a trailing overlap so commits pushed AFTER an
  // earlier collection (committer dates inside covered ranges) self-heal on
  // any report/schedule. Fixed past ranges keep the 0-Git-call fast path.
  const now = Date.now();
  const relistTailFrom =
    until.getTime() > now - NEAR_NOW_MS ? new Date(now - AUTO_RELIST_TAIL_MS) : undefined;

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
      const result = await ingestRepository(repository, token, provider, from, until, {
        relistTailFrom
      });
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
  /** Restrict to commits reachable from this branch (via CommitBranch). */
  branch?: string;
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
    ...(input.usernames?.length ? { username: { in: input.usernames } } : {}),
    ...(input.branch ? { branches: { some: { branch: { name: input.branch } } } } : {})
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
    _sum: { additions: true, deletions: true, changedFilesCount: true },
    _max: { committedAt: true, sha: true }
  });

  return {
    commits: totals._count._all,
    additions: totals._sum.additions ?? 0,
    deletions: totals._sum.deletions ?? 0,
    filesChanged: totals._sum.changedFilesCount ?? 0,
    lastCommitAt: totals._max.committedAt ?? null,
    lastSha: totals._max.sha ?? null
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
  /** Raw lines changed (additions + deletions), including dependency/generated files. */
  lines: number;
  /**
   * Lines changed EXCLUDING noise (lockfiles, generated/vendored, minified) — the
   * ranking metric when `excludeNoise` is set, so a dependency bump can't make
   * someone look like the top contributor. Equals `lines` when not excluding noise.
   */
  effectiveLines: number;
  sampleMessages: string[];
};

export type LeaderboardOptions = {
  /**
   * Exclude noise-path line counts (deps/generated/minified) from the ranking
   * metric. Reports set this so the "who did what" order reflects real work; the
   * default (false) keeps the cheap raw path for Statistics/snapshots.
   */
  excludeNoise?: boolean;
};

// Bound the per-report noise scan (one changed-file pass). Generous vs. the
// analysis caps because ranking wants broad coverage; under-scanning only
// *reduces* noise correction (safe — never over-credits).
const LEADERBOARD_NOISE_FILE_CAP = 20000;

/**
 * Per-contributor leaderboard (Phase F) for a scope + range: groups commits by
 * Git username, folds multiple usernames of the same mapped employee together,
 * ranks by lines changed, and attaches a few recent commit messages per person
 * for the "who did what" narrative. Unmapped Git usernames appear under their own
 * name, flagged `mapped: false`.
 *
 * With `excludeNoise`, ranking uses **noise-free** lines (dependency/generated/
 * minified files subtracted) so a `npm install`-style bump can't top the board.
 */
export async function buildEmployeeLeaderboard(
  input: ActivityQuery,
  samplePerEmployee = 5,
  options: LeaderboardOptions = {}
): Promise<EmployeeLeaderboardRow[]> {
  const where = buildCommitWhere(input);

  const grouped = await prisma.commit.groupBy({
    by: ["username", "authorEmail", "authorName"],
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

  // Identity key: a mapped employee folds all their usernames together; an
  // unmapped Git username stands alone; a commit with no username is keyed by its
  // author email (then name) so distinct email-only authors are NOT all merged
  // into a single "Unknown" row.
  type Identity = {
    key: string;
    employee?: { id: string; name: string };
    username: string | null;
    display: string;
  };
  const identityFor = (
    username: string | null,
    authorEmail: string | null,
    authorName: string | null
  ): Identity => {
    if (username) {
      const employee = employeeByUsername.get(username);
      return {
        key: employee ? `emp:${employee.id}` : `user:${username}`,
        employee,
        username,
        display: employee?.name ?? username
      };
    }
    const email = authorEmail?.trim();
    const name = authorName?.trim();
    if (email || name) {
      return {
        key: `author:${(email ?? name)!.toLowerCase()}`,
        username: null,
        display: name || email || "Unknown"
      };
    }
    return { key: "__unknown__", username: null, display: "Unknown" };
  };

  const rows = new Map<string, EmployeeLeaderboardRow>();
  for (const group of grouped) {
    const identity = identityFor(group.username, group.authorEmail, group.authorName);
    const additions = group._sum.additions ?? 0;
    const deletions = group._sum.deletions ?? 0;
    const filesChanged = group._sum.changedFilesCount ?? 0;
    const commits = group._count._all;
    const existing = rows.get(identity.key);

    if (existing) {
      existing.commits += commits;
      existing.additions += additions;
      existing.deletions += deletions;
      existing.filesChanged += filesChanged;
      existing.lines += additions + deletions;
      existing.effectiveLines += additions + deletions;
      if (identity.username && !existing.usernames.includes(identity.username)) {
        existing.usernames.push(identity.username);
      }
    } else {
      rows.set(identity.key, {
        rank: 0,
        employeeId: identity.employee?.id ?? null,
        name: identity.display,
        usernames: identity.username ? [identity.username] : [],
        mapped: Boolean(identity.employee),
        commits,
        additions,
        deletions,
        filesChanged,
        lines: additions + deletions,
        effectiveLines: additions + deletions,
        sampleMessages: []
      });
    }
  }

  // Noise correction (reports only): subtract lines that landed in dependency/
  // generated/minified files from each person's ranking metric, attributing each
  // noise file to its commit's author. We SUBTRACT from the accurate commit-level
  // totals (rather than recomputing from files) so commits whose files weren't
  // collected still keep their real lines — undercorrection is the safe direction.
  if (options.excludeNoise) {
    const noiseFiles = await prisma.changedFile.findMany({
      where: { commit: where },
      select: {
        additions: true,
        deletions: true,
        filePath: true,
        commit: { select: { username: true, authorEmail: true, authorName: true } }
      },
      take: LEADERBOARD_NOISE_FILE_CAP
    });

    const noiseByKey = new Map<string, number>();
    for (const file of noiseFiles) {
      if (!isNoisePath(file.filePath)) {
        continue;
      }
      const { key } = identityFor(
        file.commit.username,
        file.commit.authorEmail,
        file.commit.authorName
      );
      noiseByKey.set(key, (noiseByKey.get(key) ?? 0) + file.additions + file.deletions);
    }

    for (const [key, row] of rows) {
      row.effectiveLines = Math.max(0, row.lines - (noiseByKey.get(key) ?? 0));
    }
  }

  // Recent commit messages per person for the point-by-point narrative. Skipped
  // entirely when the caller wants no samples (e.g. snapshot writes) to save a query.
  if (samplePerEmployee > 0) {
    const recent = await prisma.commit.findMany({
      where,
      orderBy: { committedAt: "desc" },
      take: 400,
      select: { username: true, authorEmail: true, authorName: true, message: true }
    });
    for (const commit of recent) {
      const { key } = identityFor(commit.username, commit.authorEmail, commit.authorName);
      const row = rows.get(key);
      if (row && row.sampleMessages.length < samplePerEmployee) {
        row.sampleMessages.push(commit.message.split("\n")[0]!.slice(0, 120));
      }
    }
  }

  // Rank by effective (noise-free) lines — identical to raw `lines` unless
  // excludeNoise was set, so Statistics/snapshots keep their existing order.
  const sorted = [...rows.values()].sort(
    (a, b) => b.effectiveLines - a.effectiveLines || b.commits - a.commits
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
  /** Commits analyzed (capped) — the denominator for the ratios below. */
  analyzedCommits: number;
  /** Commits authored late-night (before 06:00 / after 22:00) or on a weekend. */
  offHoursCommits: number;
  /** Share (0–1) of changed lines that landed in noise paths (deps/generated). */
  noiseChangeShare: number;
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
    select: { id: true, message: true, additions: true, deletions: true, committedAt: true }
  });

  const categories: Record<string, number> = {};
  let riskyCommits = 0;
  let largeCommits = 0;
  let offHoursCommits = 0;

  for (const commit of commits) {
    const category = classifyCommit(commit.message);
    categories[category] = (categories[category] ?? 0) + 1;
    if (hasRiskKeyword(commit.message)) {
      riskyCommits += 1;
    }
    if (commit.additions + commit.deletions > LARGE_COMMIT_THRESHOLD) {
      largeCommits += 1;
    }
    const hour = commit.committedAt.getHours();
    const day = commit.committedAt.getDay();
    if (hour < 6 || hour >= 22 || day === 0 || day === 6) {
      offHoursCommits += 1;
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
  let totalChanges = 0;
  let noiseChanges = 0;

  for (const file of files) {
    const bucket = moduleFromPath(file.filePath);
    const changes = file.changes || 0;
    moduleChanges[bucket] = (moduleChanges[bucket] ?? 0) + changes;
    totalChanges += changes;
    if (isNoisePath(file.filePath)) {
      noiseChanges += changes;
    }
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

  return {
    categories,
    topModules,
    risks,
    analyzedCommits: commits.length,
    offHoursCommits,
    noiseChangeShare: totalChanges > 0 ? noiseChanges / totalChanges : 0
  };
}

export type PushedCommitInput = {
  sha: string;
  message: string;
  committedAt: string;
  authorName: string | null;
  authorEmail: string | null;
  username: string | null;
};

/**
 * Ingests the EXACT commits a push delivered (webhook path). Immune to the
 * committer-date filtering that makes window listings miss commit-first-
 * push-later batches: we fetch each pushed sha directly. Metadata comes from
 * the push payload; stats/files from one getCommitDetail per new sha. Records
 * NO coverage (point events; under-coverage is the safe direction). Does no
 * access checks — the webhook layer verified the delivery signature.
 */
export async function ingestPushedCommits(
  repository: Repository,
  token: string,
  provider: ReturnType<typeof getGitProvider>,
  branchName: string,
  commits: PushedCommitInput[]
): Promise<{ newCollected: number }> {
  if (!commits.length) {
    return { newCollected: 0 };
  }

  // Push payload lists commits oldest→newest; the last one is the new head.
  const head = commits[commits.length - 1]!;
  const branch = await prisma.branch.upsert({
    where: { repositoryId_name: { repositoryId: repository.id, name: branchName } },
    create: {
      repositoryId: repository.id,
      name: branchName,
      isDefault: branchName === repository.defaultBranch,
      headSha: head.sha,
      isProtected: false
    },
    update: { headSha: head.sha, lastSyncedAt: new Date() }
  });

  const existing = await prisma.commit.findMany({
    where: { repositoryId: repository.id, sha: { in: commits.map((commit) => commit.sha) } },
    select: { id: true, sha: true }
  });
  const idBySha = new Map(existing.map((commit) => [commit.sha, commit.id]));

  let collected = 0;
  for (const commit of commits) {
    if (idBySha.has(commit.sha)) {
      continue;
    }
    try {
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
    } catch (error) {
      // A sha can vanish (force push) — skip it, keep the rest of the batch.
      console.warn(
        `[activity] pushed commit ${commit.sha.slice(0, 7)} could not be fetched for ${repository.fullName}`,
        error
      );
    }
  }

  const links = commits
    .map((commit) => idBySha.get(commit.sha))
    .filter((commitId): commitId is string => Boolean(commitId))
    .map((commitId) => ({ commitId, branchId: branch.id }));
  if (links.length) {
    await prisma.commitBranch.createMany({ data: links, skipDuplicates: true });
  }

  return { newCollected: collected };
}
