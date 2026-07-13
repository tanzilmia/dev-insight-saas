-- CreateEnum
CREATE TYPE "SnapshotGranularity" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "AwardStatus" AS ENUM ('SHORTLISTED', 'CONFIRMED', 'DISMISSED');

-- CreateTable
CREATE TABLE "LeaderboardSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "projectName" TEXT,
    "granularity" "SnapshotGranularity" NOT NULL,
    "periodKey" TEXT NOT NULL,
    "rangeStart" TIMESTAMP(3) NOT NULL,
    "rangeEnd" TIMESTAMP(3) NOT NULL,
    "totalCommits" INTEGER NOT NULL DEFAULT 0,
    "totalLines" INTEGER NOT NULL DEFAULT 0,
    "contributors" INTEGER NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaderboardSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderboardSnapshotRow" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "usernames" TEXT[],
    "rank" INTEGER NOT NULL,
    "commits" INTEGER NOT NULL DEFAULT 0,
    "additions" INTEGER NOT NULL DEFAULT 0,
    "deletions" INTEGER NOT NULL DEFAULT 0,
    "lines" INTEGER NOT NULL DEFAULT 0,
    "filesChanged" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LeaderboardSnapshotRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeAward" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "projectName" TEXT,
    "periodKey" TEXT NOT NULL,
    "rangeStart" TIMESTAMP(3) NOT NULL,
    "rangeEnd" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "usernames" TEXT[],
    "rank" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "commits" INTEGER NOT NULL DEFAULT 0,
    "lines" INTEGER NOT NULL DEFAULT 0,
    "activeDays" INTEGER NOT NULL DEFAULT 0,
    "filesChanged" INTEGER NOT NULL DEFAULT 0,
    "citation" TEXT NOT NULL,
    "generatedBy" TEXT,
    "status" "AwardStatus" NOT NULL DEFAULT 'SHORTLISTED',
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeAward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeaderboardSnapshot_organizationId_granularity_rangeStart_idx" ON "LeaderboardSnapshot"("organizationId", "granularity", "rangeStart");

-- CreateIndex
CREATE UNIQUE INDEX "LeaderboardSnapshot_organizationId_scope_granularity_period_key" ON "LeaderboardSnapshot"("organizationId", "scope", "granularity", "periodKey");

-- CreateIndex
CREATE INDEX "LeaderboardSnapshotRow_snapshotId_idx" ON "LeaderboardSnapshotRow"("snapshotId");

-- CreateIndex
CREATE INDEX "LeaderboardSnapshotRow_userId_idx" ON "LeaderboardSnapshotRow"("userId");

-- CreateIndex
CREATE INDEX "EmployeeAward_organizationId_scope_periodKey_idx" ON "EmployeeAward"("organizationId", "scope", "periodKey");

-- CreateIndex
CREATE INDEX "EmployeeAward_organizationId_status_idx" ON "EmployeeAward"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "LeaderboardSnapshot" ADD CONSTRAINT "LeaderboardSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderboardSnapshotRow" ADD CONSTRAINT "LeaderboardSnapshotRow_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "LeaderboardSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAward" ADD CONSTRAINT "EmployeeAward_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
