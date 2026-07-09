-- CreateTable
CREATE TABLE "RepositoryCoverage" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "rangeStart" TIMESTAMP(3) NOT NULL,
    "rangeEnd" TIMESTAMP(3) NOT NULL,
    "commitCount" INTEGER NOT NULL DEFAULT 0,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepositoryCoverage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RepositoryCoverage_repositoryId_branch_idx" ON "RepositoryCoverage"("repositoryId", "branch");

-- AddForeignKey
ALTER TABLE "RepositoryCoverage" ADD CONSTRAINT "RepositoryCoverage_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
