-- CreateEnum
CREATE TYPE "CollectionJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "CollectionJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "requestedById" TEXT,
    "status" "CollectionJobStatus" NOT NULL DEFAULT 'QUEUED',
    "rangeStart" TIMESTAMP(3) NOT NULL,
    "rangeEnd" TIMESTAMP(3) NOT NULL,
    "branchesTotal" INTEGER NOT NULL DEFAULT 0,
    "branchesDone" INTEGER NOT NULL DEFAULT 0,
    "chunksTotal" INTEGER NOT NULL DEFAULT 0,
    "chunksDone" INTEGER NOT NULL DEFAULT 0,
    "commitsCollected" INTEGER NOT NULL DEFAULT 0,
    "currentBranch" TEXT,
    "currentPhase" TEXT,
    "claimedBy" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "resumeAt" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CollectionJob_status_resumeAt_idx" ON "CollectionJob"("status", "resumeAt");

-- CreateIndex
CREATE INDEX "CollectionJob_repositoryId_createdAt_idx" ON "CollectionJob"("repositoryId", "createdAt");

-- CreateIndex
CREATE INDEX "CollectionJob_organizationId_createdAt_idx" ON "CollectionJob"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "CollectionJob" ADD CONSTRAINT "CollectionJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionJob" ADD CONSTRAINT "CollectionJob_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionJob" ADD CONSTRAINT "CollectionJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One active (queued or running) job per repository, enforced at the DB level.
-- Prisma cannot express partial unique indexes, hence the raw SQL.
CREATE UNIQUE INDEX "CollectionJob_one_active_per_repo"
  ON "CollectionJob" ("repositoryId")
  WHERE "status" IN ('QUEUED', 'RUNNING');
