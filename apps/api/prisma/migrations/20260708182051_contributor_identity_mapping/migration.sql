-- CreateTable
CREATE TABLE "ContributorIdentity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "provider" "GitProvider" NOT NULL DEFAULT 'GITHUB',
    "externalId" TEXT NOT NULL,
    "username" TEXT,
    "authorName" TEXT,
    "authorEmail" TEXT,
    "avatarUrl" TEXT,
    "contributions" INTEGER NOT NULL DEFAULT 0,
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContributorIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeGitMapping" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contributorIdentityId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeGitMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContributorIdentity_organizationId_idx" ON "ContributorIdentity"("organizationId");

-- CreateIndex
CREATE INDEX "ContributorIdentity_repositoryId_idx" ON "ContributorIdentity"("repositoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ContributorIdentity_repositoryId_externalId_key" ON "ContributorIdentity"("repositoryId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeGitMapping_contributorIdentityId_key" ON "EmployeeGitMapping"("contributorIdentityId");

-- CreateIndex
CREATE INDEX "EmployeeGitMapping_organizationId_idx" ON "EmployeeGitMapping"("organizationId");

-- CreateIndex
CREATE INDEX "EmployeeGitMapping_userId_idx" ON "EmployeeGitMapping"("userId");

-- AddForeignKey
ALTER TABLE "ContributorIdentity" ADD CONSTRAINT "ContributorIdentity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributorIdentity" ADD CONSTRAINT "ContributorIdentity_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeGitMapping" ADD CONSTRAINT "EmployeeGitMapping_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeGitMapping" ADD CONSTRAINT "EmployeeGitMapping_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeGitMapping" ADD CONSTRAINT "EmployeeGitMapping_contributorIdentityId_fkey" FOREIGN KEY ("contributorIdentityId") REFERENCES "ContributorIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
