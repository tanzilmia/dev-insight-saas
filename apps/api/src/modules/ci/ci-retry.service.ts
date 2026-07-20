import type { CiRetryJob, Repository } from "@prisma/client";

import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import { resolveRepositoryToken } from "../github-app/repository-token.js";
import { getDevOpsProvider } from "../devops-providers/devops-provider-registry.js";
import type {
  DevOpsProvider,
  RepositoryRef,
  WorkflowRunDto
} from "../devops-providers/devops-provider.js";
import { classifyWorkflowFailure } from "./ci-retry-classifier.js";

const RETRY_PENDING = "PENDING";
const RETRY_PROCESSING = "PROCESSING";
const RETRY_TRIGGERED = "TRIGGERED";
const RETRY_EXHAUSTED = "EXHAUSTED";
const RETRY_SKIPPED = "SKIPPED";
const MAX_ATTEMPTS = 2;
const WORKER_LEASE_MS = 90_000;
const INITIAL_RETRY_DELAY_MS = 60_000;

function refOf(repository: Repository): RepositoryRef {
  return { owner: repository.owner, repo: repository.name };
}

function backoffMs(attempt: number): number {
  const base = INITIAL_RETRY_DELAY_MS * 5 ** Math.max(0, attempt - 1);
  const jitter = Math.floor(Math.random() * 10_000);
  return base + jitter;
}

function runData(repository: Repository, run: WorkflowRunDto) {
  const startedAt = run.startedAt ? new Date(run.startedAt) : null;
  const completedAt = run.completedAt ? new Date(run.completedAt) : null;
  return {
    organizationId: repository.organizationId,
    workflowId: run.workflowId,
    name: run.name,
    branch: run.branch,
    headSha: run.headSha,
    event: run.event,
    status: run.status,
    conclusion: run.conclusion,
    actor: run.actor,
    url: run.url,
    startedAt,
    completedAt,
    durationMs:
      startedAt && completedAt ? completedAt.getTime() - startedAt.getTime() : null
  };
}

async function mirrorRun(repository: Repository, run: WorkflowRunDto): Promise<void> {
  await prisma.workflowRun.upsert({
    where: { repositoryId_runId: { repositoryId: repository.id, runId: run.runId } },
    create: { repositoryId: repository.id, runId: run.runId, ...runData(repository, run) },
    update: runData(repository, run)
  });
}

async function classifyRun(
  repository: Repository,
  token: string,
  devops: DevOpsProvider,
  run: WorkflowRunDto
) {
  const jobs = await devops.listWorkflowJobs(token, refOf(repository), run.runId);
  const logs = new Map<string, string>();
  for (const job of jobs.filter((candidate) => candidate.conclusion !== "success")) {
    try {
      logs.set(job.jobId, await devops.getWorkflowJobLog(token, refOf(repository), job.jobId));
    } catch (error) {
      console.warn(`[ci-retry] workflow log fetch failed for job ${job.jobId}`, error);
    }
  }
  return classifyWorkflowFailure(jobs, logs);
}

async function activeRetryForRun(repositoryId: string, run: WorkflowRunDto): Promise<CiRetryJob | null> {
  const bySource = await prisma.ciRetryJob.findUnique({
    where: { repositoryId_sourceRunId: { repositoryId, sourceRunId: run.runId } }
  });
  if (bySource) return bySource;
  if (!run.workflowId || !run.headSha) return null;
  return prisma.ciRetryJob.findFirst({
    where: {
      repositoryId,
      workflowId: run.workflowId,
      headSha: run.headSha,
      status: RETRY_TRIGGERED
    },
    orderBy: { updatedAt: "desc" }
  });
}

async function scheduleInitialRetry(
  repository: Repository,
  run: WorkflowRunDto,
  classification: ReturnType<typeof classifyWorkflowFailure>
): Promise<void> {
  try {
    await prisma.ciRetryJob.create({
      data: {
        organizationId: repository.organizationId,
        repositoryId: repository.id,
        sourceRunId: run.runId,
        latestRunId: run.runId,
        workflowId: run.workflowId,
        workflowName: run.name,
        headSha: run.headSha,
        branch: run.branch,
        status: classification.retryable ? RETRY_PENDING : RETRY_SKIPPED,
        attempts: 0,
        maxAttempts: MAX_ATTEMPTS,
        reason: classification.reason,
        diagnostic: classification.diagnostic,
        nextAttemptAt: new Date()
      }
    });
  } catch (error) {
    // GitHub may redeliver the same event while the first background handler is
    // still classifying it. The unique repository/run key makes this harmless.
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") return;
    throw error;
  }
}

async function updateRetryFromRerun(
  job: CiRetryJob,
  run: WorkflowRunDto,
  retryable: boolean,
  reason: string,
  diagnostic: string
): Promise<void> {
  if (!retryable) {
    await prisma.ciRetryJob.update({
      where: { id: job.id },
      data: {
        latestRunId: run.runId,
        status: RETRY_SKIPPED,
        reason,
        diagnostic,
        lockedUntil: null
      }
    });
    return;
  }

  if (job.attempts >= job.maxAttempts) {
    await prisma.ciRetryJob.update({
      where: { id: job.id },
      data: {
        latestRunId: run.runId,
        status: RETRY_EXHAUSTED,
        reason,
        diagnostic,
        lockedUntil: null
      }
    });
    return;
  }

  await prisma.ciRetryJob.update({
    where: { id: job.id },
    data: {
      latestRunId: run.runId,
      status: RETRY_PENDING,
      reason,
      diagnostic,
      nextAttemptAt: new Date(Date.now() + backoffMs(job.attempts)),
      lockedUntil: null,
      lastError: null
    }
  });
}

/** Mirrors a completed push run and queues/reconciles automatic retry state. */
export async function handleCompletedWorkflowRun(
  repository: Repository,
  token: string,
  devops: DevOpsProvider,
  run: WorkflowRunDto
): Promise<void> {
  await mirrorRun(repository, run);
  if (
    !env.CI_AUTO_RETRY_ENABLED ||
    run.status !== "completed" ||
    run.event !== "push" ||
    run.branch !== (repository.defaultBranch ?? "main")
  ) {
    return;
  }

  const existing = await activeRetryForRun(repository.id, run);
  if (run.conclusion === "success") {
    if (existing?.status === RETRY_TRIGGERED) {
      await prisma.ciRetryJob.update({
        where: { id: existing.id },
        data: { latestRunId: run.runId, status: "SUCCEEDED", lockedUntil: null }
      });
    }
    return;
  }
  if (!run.conclusion || ["cancelled", "skipped"].includes(run.conclusion)) return;

  // The original failed run may appear repeatedly during fallback polling. It
  // must not be mistaken for the new run created by GitHub's rerun endpoint.
  if (existing && (existing.status !== RETRY_TRIGGERED || existing.sourceRunId === run.runId)) {
    return;
  }

  const classification = await classifyRun(repository, token, devops, run);
  if (!existing) {
    await scheduleInitialRetry(repository, run, classification);
    return;
  }
  await updateRetryFromRerun(
    existing,
    run,
    classification.retryable,
    classification.reason,
    classification.diagnostic
  );
}

async function claimNextJob(): Promise<CiRetryJob | null> {
  const now = new Date();
  await prisma.ciRetryJob.updateMany({
    where: { status: RETRY_PROCESSING, lockedUntil: { lt: now } },
    data: { status: RETRY_PENDING, lockedUntil: null }
  });

  const candidate = await prisma.ciRetryJob.findFirst({
    where: {
      status: RETRY_PENDING,
      nextAttemptAt: { lte: now },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }]
    },
    orderBy: { nextAttemptAt: "asc" }
  });
  if (!candidate) return null;

  const claimed = await prisma.ciRetryJob.updateMany({
    where: {
      id: candidate.id,
      status: RETRY_PENDING,
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }]
    },
    data: {
      status: RETRY_PROCESSING,
      lockedUntil: new Date(now.getTime() + WORKER_LEASE_MS)
    }
  });
  return claimed.count
    ? prisma.ciRetryJob.findUnique({ where: { id: candidate.id } })
    : null;
}

async function processJob(job: CiRetryJob): Promise<void> {
  const repository = await prisma.repository.findUnique({ where: { id: job.repositoryId } });
  if (!repository) return;
  const config = await prisma.ciConfiguration.findUnique({ where: { repositoryId: repository.id } });
  if (config?.status !== "ENABLED") {
    await prisma.ciRetryJob.update({
      where: { id: job.id },
      data: { status: RETRY_SKIPPED, lockedUntil: null, diagnostic: "CI is not enabled" }
    });
    return;
  }

  const attempt = job.attempts + 1;
  await prisma.ciRetryJob.update({ where: { id: job.id }, data: { attempts: attempt } });

  try {
    const { token } = await resolveRepositoryToken(repository);
    const devops = getDevOpsProvider(repository.provider);
    await devops.rerunFailedJobs(token, refOf(repository), job.latestRunId ?? job.sourceRunId);
    await prisma.ciRetryJob.update({
      where: { id: job.id },
      data: {
        status: RETRY_TRIGGERED,
        lockedUntil: null,
        lastError: null,
        diagnostic: `Triggered automatic retry ${attempt}/${job.maxAttempts}`
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub retry request failed";
    await prisma.ciRetryJob.update({
      where: { id: job.id },
      data:
        attempt >= job.maxAttempts
          ? { status: RETRY_EXHAUSTED, lockedUntil: null, lastError: message }
          : {
              status: RETRY_PENDING,
              lockedUntil: null,
              nextAttemptAt: new Date(Date.now() + backoffMs(attempt)),
              lastError: message
            }
    });
    console.warn(`[ci-retry] retry request failed for ${job.repositoryId}/${job.sourceRunId}`, error);
  }
}

export async function processNextRetryJob(): Promise<boolean> {
  const job = await claimNextJob();
  if (!job) return false;
  await processJob(job);
  return true;
}

/** Reconciles a bounded set of recent runs when a webhook was missed. */
export async function reconcileRecentWorkflowRuns(): Promise<void> {
  if (!env.CI_AUTO_RETRY_ENABLED) return;
  const repositories = await prisma.repository.findMany({
    where: { ciConfiguration: { is: { status: "ENABLED" } } },
    take: env.CI_AUTO_RETRY_MAX_REPOSITORIES_PER_POLL,
    orderBy: { updatedAt: "asc" }
  });
  for (const repository of repositories) {
    try {
      const { token } = await resolveRepositoryToken(repository);
      const devops = getDevOpsProvider(repository.provider);
      const runs = await devops.listWorkflowRuns(token, refOf(repository), {
        perPage: 5,
        branch: repository.defaultBranch ?? "main"
      });
      for (const run of runs) {
        if (run.status === "completed" && run.conclusion && run.event === "push") {
          await handleCompletedWorkflowRun(repository, token, devops, run);
        }
      }
    } catch (error) {
      console.warn(`[ci-retry] reconciliation failed for repository ${repository.id}`, error);
    }
  }
}

let workerRunning = false;

/** Starts the durable retry worker loop; safe to call once from a process. */
export function startCiRetryWorker(): void {
  if (!env.CI_AUTO_RETRY_ENABLED || workerRunning) return;
  workerRunning = true;
  const queueTick = async () => {
    try {
      for (let i = 0; i < 10; i += 1) {
        if (!(await processNextRetryJob())) break;
      }
    } catch (error) {
      console.warn("[ci-retry] queue tick failed", error);
    } finally {
      setTimeout(() => void queueTick(), env.CI_AUTO_RETRY_QUEUE_INTERVAL_MS);
    }
  };
  const pollTick = async () => {
    try {
      await reconcileRecentWorkflowRuns();
    } catch (error) {
      console.warn("[ci-retry] reconciliation tick failed", error);
    } finally {
      setTimeout(() => void pollTick(), env.CI_AUTO_RETRY_POLL_INTERVAL_MS);
    }
  };
  void queueTick();
  void pollTick();
  console.log(
    `[ci-retry] worker enabled; queue every ${env.CI_AUTO_RETRY_QUEUE_INTERVAL_MS}ms, reconciliation every ${env.CI_AUTO_RETRY_POLL_INTERVAL_MS}ms`
  );
}
