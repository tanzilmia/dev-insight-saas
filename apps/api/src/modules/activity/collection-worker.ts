import { randomUUID } from "node:crypto";

import { prisma } from "../../config/database.js";
import { GitRateLimitError } from "../git-providers/git-provider.js";
import { runCollectionJob } from "./deep-collection.js";

// In-process worker for deep-history collection jobs (Phase E). Same shape as
// the report scheduler: setInterval + re-entrancy guard + atomic DB claims, so
// multiple API instances can run it without double-executing a job. One job at
// a time per instance keeps the org's rate-limit budget predictable.
const TICK_MS = 5_000;
// Heartbeats land every ~25 detail fetches and at every chunk boundary; three
// minutes of silence means the claiming instance died — reclaim the job.
const STALE_MS = 180_000;
// Rate-limit resume: small buffer over the reset (clock skew), hard clamp so a
// bogus reset header can't park a job for hours.
const MIN_RESUME_DELAY_MS = 5_000;
const MAX_RESUME_DELAY_MS = 90 * 60_000;
// Transient-error backoff, scaled by consecutive no-progress attempts.
const RETRY_BACKOFF_MS = 60_000;
// Give up only after this many claims that made zero chunk progress. Runs that
// DO make progress reset the counter, so a huge repo pausing on rate limits
// for days keeps going while a genuinely broken job stops retrying.
const MAX_ATTEMPTS_WITHOUT_PROGRESS = 5;

const INSTANCE_ID = randomUUID();

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

function clampResume(resetAt: Date | null, now: Date): Date {
  const requested = resetAt ? resetAt.getTime() + MIN_RESUME_DELAY_MS : now.getTime() + 60_000;
  const min = now.getTime() + MIN_RESUME_DELAY_MS;
  const max = now.getTime() + MAX_RESUME_DELAY_MS;
  return new Date(Math.min(Math.max(requested, min), max));
}

async function tick() {
  if (running) {
    return;
  }
  running = true;
  try {
    const now = new Date();
    const staleCutoff = new Date(now.getTime() - STALE_MS);

    const candidate = await prisma.collectionJob.findFirst({
      where: {
        OR: [
          { status: "QUEUED", OR: [{ resumeAt: null }, { resumeAt: { lte: now } }] },
          // A RUNNING job whose heartbeat went silent: its instance died.
          { status: "RUNNING", heartbeatAt: { lt: staleCutoff } }
        ]
      },
      orderBy: { createdAt: "asc" }
    });
    if (!candidate) {
      return;
    }

    // Atomic claim (schedules pattern): condition on exactly what we read so
    // only one instance wins. Stale RUNNING rows are conditioned on the stale
    // heartbeat — if the "dead" instance beats again, we lose the race safely.
    const claim = await prisma.collectionJob.updateMany({
      where:
        candidate.status === "QUEUED"
          ? { id: candidate.id, status: "QUEUED" }
          : { id: candidate.id, status: "RUNNING", heartbeatAt: candidate.heartbeatAt },
      data: {
        status: "RUNNING",
        claimedBy: INSTANCE_ID,
        heartbeatAt: now,
        startedAt: candidate.startedAt ?? now,
        attempts: { increment: 1 }
      }
    });
    if (claim.count === 0) {
      return;
    }

    if (candidate.attempts + 1 > MAX_ATTEMPTS_WITHOUT_PROGRESS) {
      await prisma.collectionJob.update({
        where: { id: candidate.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          currentBranch: null,
          currentPhase: null,
          error: `Gave up after ${candidate.attempts + 1} attempts without progress${
            candidate.error ? ` (last error: ${candidate.error})` : ""
          }`
        }
      });
      console.error(`[collection-worker] job ${candidate.id} failed permanently (no progress)`);
      return;
    }

    const chunksDoneAtClaim = candidate.chunksDone;
    try {
      await runCollectionJob(candidate.id);
    } catch (error) {
      const fresh = await prisma.collectionJob.findUnique({ where: { id: candidate.id } });
      if (!fresh || fresh.status !== "RUNNING") {
        return; // finalized (or deleted) despite the throw — nothing to requeue
      }
      const madeProgress = fresh.chunksDone > chunksDoneAtClaim;
      const requeueBase = {
        status: "QUEUED" as const,
        claimedBy: null,
        heartbeatAt: null,
        currentBranch: null,
        ...(madeProgress ? { attempts: 0 } : {})
      };
      const requeueNow = new Date();
      if (error instanceof GitRateLimitError) {
        const resumeAt = clampResume(error.resetAt, requeueNow);
        await prisma.collectionJob.update({
          where: { id: candidate.id },
          data: {
            ...requeueBase,
            resumeAt,
            error: `Rate limited by GitHub — resuming after ${resumeAt.toISOString()}`
          }
        });
        console.warn(
          `[collection-worker] job ${candidate.id} rate limited, resumes at ${resumeAt.toISOString()}`
        );
      } else {
        const message = error instanceof Error ? error.message : String(error);
        await prisma.collectionJob.update({
          where: { id: candidate.id },
          data: {
            ...requeueBase,
            resumeAt: new Date(requeueNow.getTime() + RETRY_BACKOFF_MS * fresh.attempts),
            error: message.slice(0, 500)
          }
        });
        console.error(`[collection-worker] job ${candidate.id} errored, requeued:`, message);
      }
    }
  } catch (error) {
    console.error("[collection-worker] tick failed", error);
  } finally {
    running = false;
  }
}

export function startCollectionWorker() {
  if (timer) {
    return;
  }
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  // Kick once at boot so queued/interrupted jobs don't wait a full tick.
  void tick();
  console.log("[collection-worker] started (tick every 5s)");
}
