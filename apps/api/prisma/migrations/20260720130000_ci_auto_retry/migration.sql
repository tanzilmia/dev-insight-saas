-- Durable retry state for transient GitHub Actions failures.

CREATE TABLE "CiRetryJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "sourceRunId" TEXT NOT NULL,
    "latestRunId" TEXT,
    "workflowId" TEXT,
    "workflowName" TEXT,
    "headSha" TEXT,
    "branch" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 2,
    "reason" TEXT NOT NULL,
    "diagnostic" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CiRetryJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CiRetryJob_repositoryId_sourceRunId_key"
  ON "CiRetryJob"("repositoryId", "sourceRunId");
CREATE INDEX "CiRetryJob_status_nextAttemptAt_idx"
  ON "CiRetryJob"("status", "nextAttemptAt");
CREATE INDEX "CiRetryJob_repositoryId_updatedAt_idx"
  ON "CiRetryJob"("repositoryId", "updatedAt");

ALTER TABLE "CiRetryJob"
  ADD CONSTRAINT "CiRetryJob_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CiRetryJob"
  ADD CONSTRAINT "CiRetryJob_repositoryId_fkey"
  FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
