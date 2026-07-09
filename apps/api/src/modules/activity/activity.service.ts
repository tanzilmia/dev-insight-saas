import type { Prisma } from "@prisma/client";

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

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 90;
// Detail (stats + files) is one API call per commit — bound it per collection.
const MAX_DETAIL_COMMITS = 150;
const MAX_FILES_PER_COMMIT = 300;

type Range = { since?: string; until?: string };

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
 * Fetches commits (and per-commit stats/files) from the provider for a date
 * range and stores any that are new. Existing commits are skipped so repeated
 * collection is cheap.
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

  const commits = await provider.listCommits(token, repository.owner, repository.name, {
    since: since.toISOString(),
    until: until.toISOString(),
    branch: repository.defaultBranch ?? undefined
  });

  const existing = await prisma.commit.findMany({
    where: { repositoryId, sha: { in: commits.map((commit) => commit.sha) } },
    select: { sha: true }
  });
  const existingShas = new Set(existing.map((commit) => commit.sha));
  const newCommits = commits.filter((commit) => !existingShas.has(commit.sha));
  const toCollect = newCommits.slice(0, MAX_DETAIL_COMMITS);

  let collected = 0;
  for (const commit of toCollect) {
    const detail = await provider.getCommitDetail(
      token,
      repository.owner,
      repository.name,
      commit.sha
    );

    await prisma.$transaction(async (tx) => {
      const created = await tx.commit.create({
        data: {
          repositoryId,
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
    });

    collected += 1;
  }

  await prisma.auditLog.create({
    data: {
      organizationId: repository.organizationId,
      actorId,
      action: "activity.collect",
      entityType: "Repository",
      entityId: repositoryId,
      metadataJson: { collected, totalInRange: commits.length }
    }
  });

  return {
    range: { since, until },
    totalInRange: commits.length,
    newCollected: collected,
    detailCapped: Math.max(0, newCommits.length - MAX_DETAIL_COMMITS)
  };
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
