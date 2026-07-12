import { Prisma, type CollectionJob } from "@prisma/client";

import { prisma } from "../../config/database.js";
import { AppError } from "../../common/errors/app-error.js";
import {
  MANAGER_ROLES,
  requireOrganizationMember,
  requireOrganizationRole
} from "../../common/access/organization-access.js";
import { decryptToken } from "../../common/crypto/token-cipher.js";
import { getGitProvider } from "../git-providers/provider-registry.js";
import { GitRateLimitError } from "../git-providers/git-provider.js";
import type { Interval } from "./coverage.js";
import { getMissingRanges, ingestBranchRange, syncBranches } from "./activity.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;
// Throttle detail fetches in deep jobs (~6 req/s) so a long-running job leaves
// headroom in the org's rate-limit budget for reports and manual collects.
const DETAIL_DELAY_MS = 150;
// How many recent jobs to scan when reducing to latest-per-repository.
const JOB_LIST_SCAN = 200;

/** Errors that retrying cannot fix — the job fails immediately with a clear message. */
const PERMANENT_ERROR_CODES = new Set([
  "INVALID_CREDENTIAL",
  "NO_CREDENTIAL",
  "REPO_NOT_ON_PROVIDER",
  "PROVIDER_UNSUPPORTED"
]);

/**
 * Chunk size for deep ingestion. Smaller chunks give finer progress and
 * cheaper resumes; on decade-scale ranges larger chunks keep the per-empty-
 * window listing overhead low (bisection still splits dense windows).
 */
function chunkMsFor(rangeStart: Date, rangeEnd: Date) {
  const rangeDays = (rangeEnd.getTime() - rangeStart.getTime()) / DAY_MS;
  return (rangeDays <= 730 ? 30 : 120) * DAY_MS;
}

/** Splits a gap into consecutive windows, newest first. */
function splitIntoWindows(gap: Interval, chunkMs: number): Interval[] {
  const windows: Interval[] = [];
  let end = gap.end;
  while (end > gap.start) {
    const start = new Date(Math.max(gap.start.getTime(), end.getTime() - chunkMs));
    windows.push({ start, end });
    end = start;
  }
  return windows;
}

export function serializeCollectionJob(job: CollectionJob) {
  return {
    id: job.id,
    repositoryId: job.repositoryId,
    status: job.status,
    rangeStart: job.rangeStart,
    rangeEnd: job.rangeEnd,
    branchesTotal: job.branchesTotal,
    branchesDone: job.branchesDone,
    chunksTotal: job.chunksTotal,
    chunksDone: job.chunksDone,
    commitsCollected: job.commitsCollected,
    currentBranch: job.currentBranch,
    currentPhase: job.currentPhase,
    cancelRequested: Boolean(job.cancelRequestedAt),
    error: job.error,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt
  };
}

export type SerializedCollectionJob = ReturnType<typeof serializeCollectionJob>;

async function loadRepository(repositoryId: string) {
  const repository = await prisma.repository.findUnique({ where: { id: repositoryId } });
  if (!repository) {
    throw new AppError(404, "Repository was not found", "REPOSITORY_NOT_FOUND");
  }
  return repository;
}

/**
 * Queues a background deep-history collection job for a repository. The worker
 * (collection-worker.ts) picks it up within one tick. At most one QUEUED or
 * RUNNING job may exist per repository — enforced here and by a partial unique
 * index in the database (the P2002 catch covers the race between the two).
 */
export async function startDeepCollection(
  actorId: string,
  repositoryId: string,
  input: { lookbackDays: number }
): Promise<SerializedCollectionJob> {
  const repository = await loadRepository(repositoryId);
  await requireOrganizationRole(actorId, repository.organizationId, MANAGER_ROLES);

  const credential = await prisma.gitCredential.findUnique({
    where: { id: repository.credentialId }
  });
  if (!credential) {
    throw new AppError(400, "Connect a GitHub credential first", "NO_CREDENTIAL");
  }

  const active = await prisma.collectionJob.findFirst({
    where: { repositoryId, status: { in: ["QUEUED", "RUNNING"] } }
  });
  if (active) {
    throw new AppError(
      409,
      "A collection job is already running for this repository",
      "JOB_ALREADY_ACTIVE"
    );
  }

  const now = new Date();
  let job: CollectionJob;
  try {
    job = await prisma.collectionJob.create({
      data: {
        organizationId: repository.organizationId,
        repositoryId,
        requestedById: actorId,
        rangeStart: new Date(now.getTime() - input.lookbackDays * DAY_MS),
        rangeEnd: now,
        currentPhase: "queued"
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(
        409,
        "A collection job is already running for this repository",
        "JOB_ALREADY_ACTIVE"
      );
    }
    throw error;
  }

  await prisma.auditLog.create({
    data: {
      organizationId: repository.organizationId,
      actorId,
      action: "activity.deep_collect.start",
      entityType: "CollectionJob",
      entityId: job.id,
      metadataJson: { repositoryId, lookbackDays: input.lookbackDays }
    }
  });

  return serializeCollectionJob(job);
}

/**
 * The latest job per repository for an organization — what the repositories
 * page polls to drive progress bars and to resume display after a reload.
 */
export async function listCollectionJobs(
  actorId: string,
  organizationId: string
): Promise<SerializedCollectionJob[]> {
  await requireOrganizationMember(actorId, organizationId);

  const recent = await prisma.collectionJob.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: JOB_LIST_SCAN
  });

  const latestByRepository = new Map<string, CollectionJob>();
  for (const job of recent) {
    if (!latestByRepository.has(job.repositoryId)) {
      latestByRepository.set(job.repositoryId, job);
    }
  }

  return [...latestByRepository.values()].map(serializeCollectionJob);
}

/**
 * Cancels the repository's active job. A QUEUED job is finalized immediately
 * (atomically, so a worker that just claimed it wins instead); a RUNNING job
 * gets `cancelRequestedAt` and the worker finalizes it at the next progress
 * check (every ~25 commits or at each chunk boundary).
 */
export async function cancelDeepCollection(
  actorId: string,
  repositoryId: string
): Promise<SerializedCollectionJob> {
  const repository = await loadRepository(repositoryId);
  await requireOrganizationRole(actorId, repository.organizationId, MANAGER_ROLES);

  const active = await prisma.collectionJob.findFirst({
    where: { repositoryId, status: { in: ["QUEUED", "RUNNING"] } },
    orderBy: { createdAt: "desc" }
  });
  if (!active) {
    throw new AppError(404, "No active collection job for this repository", "NO_ACTIVE_JOB");
  }

  const now = new Date();
  if (active.status === "QUEUED") {
    const cancelled = await prisma.collectionJob.updateMany({
      where: { id: active.id, status: "QUEUED" },
      data: { status: "CANCELLED", finishedAt: now, currentPhase: null }
    });
    if (cancelled.count === 0) {
      // The worker claimed it between our read and the update — ask it to stop.
      await prisma.collectionJob.update({
        where: { id: active.id },
        data: { cancelRequestedAt: now }
      });
    }
  } else {
    await prisma.collectionJob.update({
      where: { id: active.id },
      data: { cancelRequestedAt: now }
    });
  }

  await prisma.auditLog.create({
    data: {
      organizationId: repository.organizationId,
      actorId,
      action: "activity.deep_collect.cancel",
      entityType: "CollectionJob",
      entityId: active.id,
      metadataJson: { repositoryId }
    }
  });

  const fresh = await prisma.collectionJob.findUnique({ where: { id: active.id } });
  return serializeCollectionJob(fresh ?? active);
}

async function setJob(jobId: string, data: Prisma.CollectionJobUpdateInput) {
  return prisma.collectionJob.update({ where: { id: jobId }, data });
}

async function finalizeJob(
  jobId: string,
  status: "COMPLETED" | "FAILED" | "CANCELLED",
  error: string | null = null
) {
  await setJob(jobId, {
    status,
    finishedAt: new Date(),
    currentBranch: null,
    currentPhase: null,
    error
  });
}

/**
 * Executes a claimed job to completion. No access checks — only the worker
 * calls this, after atomically claiming the row. The org's stored credential is
 * decrypted here and never logged. Throws GitRateLimitError / transient errors
 * upward for the worker to requeue; permanent errors finalize the job FAILED.
 *
 * Work is planned from the coverage ledger at every (re)run, so a resumed job
 * only re-plans what is still missing — completed chunks simply don't appear.
 */
export async function runCollectionJob(jobId: string): Promise<void> {
  const job = await prisma.collectionJob.findUnique({
    where: { id: jobId },
    include: { repository: true }
  });
  if (!job) {
    return;
  }
  if (job.cancelRequestedAt) {
    await finalizeJob(jobId, "CANCELLED");
    return;
  }

  const repository = job.repository;
  const credential = await prisma.gitCredential.findUnique({
    where: { id: repository.credentialId }
  });
  if (!credential) {
    await finalizeJob(jobId, "FAILED", "The organization's Git credential was removed");
    return;
  }

  try {
    const token = decryptToken(credential.encryptedToken);
    const provider = getGitProvider(credential.provider);

    await setJob(jobId, { currentPhase: "syncing-branches", heartbeatAt: new Date() });
    const branches = await syncBranches(repository, token, provider);

    const chunkMs = chunkMsFor(job.rangeStart, job.rangeEnd);
    const planned = new Map<string, Interval[]>();
    let plannedChunks = 0;
    for (const branch of branches) {
      const gaps = await getMissingRanges(
        repository.id,
        branch.name,
        job.rangeStart,
        job.rangeEnd
      );
      const chunks = gaps.flatMap((gap) => splitIntoWindows(gap, chunkMs));
      // Newest-first across gaps too, so progress starts with recent history.
      chunks.sort((a, b) => b.end.getTime() - a.end.getTime());
      planned.set(branch.id, chunks);
      plannedChunks += chunks.length;
    }

    await setJob(jobId, {
      branchesTotal: branches.length,
      branchesDone: 0,
      chunksTotal: job.chunksDone + plannedChunks,
      currentPhase: "collecting",
      heartbeatAt: new Date()
    });

    if (plannedChunks === 0) {
      await finalizeJob(jobId, "COMPLETED");
      return;
    }

    // One query per progress beat: heartbeat + counters + cancellation check.
    const onProgress = async ({ newCommits }: { newCommits: number }) => {
      const fresh = await prisma.collectionJob.update({
        where: { id: jobId },
        data: { heartbeatAt: new Date(), commitsCollected: { increment: newCommits } }
      });
      return fresh.cancelRequestedAt ? ("cancel" as const) : ("continue" as const);
    };

    let branchesDone = 0;
    for (const branch of branches) {
      const chunks = planned.get(branch.id) ?? [];
      if (chunks.length) {
        await setJob(jobId, { currentBranch: branch.name });
        for (const chunk of chunks) {
          const result = await ingestBranchRange(
            repository,
            branch,
            token,
            provider,
            chunk.start,
            chunk.end,
            {
              maxDetailCommits: Number.POSITIVE_INFINITY,
              detailDelayMs: DETAIL_DELAY_MS,
              bisectOnTruncation: true,
              onProgress
            }
          );
          const fresh = await setJob(jobId, {
            chunksDone: { increment: 1 },
            heartbeatAt: new Date()
          });
          if (result.cancelled || fresh.cancelRequestedAt) {
            await finalizeJob(jobId, "CANCELLED");
            return;
          }
        }
      }
      branchesDone += 1;
      await setJob(jobId, { branchesDone, heartbeatAt: new Date() });
    }

    await finalizeJob(jobId, "COMPLETED");
  } catch (error) {
    if (error instanceof GitRateLimitError) {
      throw error; // the worker requeues with resumeAt = rate-limit reset
    }
    if (error instanceof AppError && PERMANENT_ERROR_CODES.has(error.code)) {
      await finalizeJob(jobId, "FAILED", error.message);
      return;
    }
    throw error; // transient — the worker requeues with backoff
  }
}
