-- GitHub Actions management: per-repository CI configuration + synced workflow
-- runs. Additive and non-destructive. Hand-written per this repo's convention;
-- apply with `prisma migrate deploy`.

-- CreateTable
CREATE TABLE "CiConfiguration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "templateId" TEXT,
    "templateVersion" TEXT,
    "workflowPath" TEXT,
    "setupBranch" TEXT,
    "pullRequestNumber" INTEGER,
    "pullRequestUrl" TEXT,
    "pullRequestState" TEXT,
    "workflowFileSha" TEXT,
    "enabledById" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CiConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "workflowId" TEXT,
    "name" TEXT,
    "branch" TEXT,
    "headSha" TEXT,
    "event" TEXT,
    "status" TEXT,
    "conclusion" TEXT,
    "actor" TEXT,
    "url" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CiConfiguration_repositoryId_key" ON "CiConfiguration"("repositoryId");

-- CreateIndex
CREATE INDEX "CiConfiguration_organizationId_idx" ON "CiConfiguration"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowRun_repositoryId_runId_key" ON "WorkflowRun"("repositoryId", "runId");

-- CreateIndex
CREATE INDEX "WorkflowRun_repositoryId_startedAt_idx" ON "WorkflowRun"("repositoryId", "startedAt");

-- AddForeignKey
ALTER TABLE "CiConfiguration" ADD CONSTRAINT "CiConfiguration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CiConfiguration" ADD CONSTRAINT "CiConfiguration_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
