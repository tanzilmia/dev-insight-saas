-- GitHub App foundation: installations + repository-access grants, and make a
-- Repository's PAT credential optional (App-synced repos have no PAT). Additive
-- and non-destructive; existing rows are unaffected. Hand-written per this
-- repo's convention (Neon + non-interactive shell); apply with
-- `prisma migrate deploy`.

-- CreateTable
CREATE TABLE "GitHubAppInstallation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "accountType" TEXT,
    "accountId" TEXT,
    "targetType" TEXT,
    "repositorySelection" TEXT,
    "permissions" JSONB,
    "suspendedAt" TIMESTAMP(3),
    "repositoryCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubAppInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepositoryAccess" (
    "id" TEXT NOT NULL,
    "appInstallationId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepositoryAccess_pkey" PRIMARY KEY ("id")
);

-- AlterTable: PAT credential becomes optional; add the App installation link.
ALTER TABLE "Repository" ALTER COLUMN "credentialId" DROP NOT NULL,
ADD COLUMN "appInstallationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "GitHubAppInstallation_installationId_key" ON "GitHubAppInstallation"("installationId");

-- CreateIndex
CREATE INDEX "GitHubAppInstallation_organizationId_idx" ON "GitHubAppInstallation"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RepositoryAccess_appInstallationId_repositoryId_key" ON "RepositoryAccess"("appInstallationId", "repositoryId");

-- CreateIndex
CREATE INDEX "RepositoryAccess_repositoryId_idx" ON "RepositoryAccess"("repositoryId");

-- CreateIndex
CREATE INDEX "Repository_appInstallationId_idx" ON "Repository"("appInstallationId");

-- AddForeignKey
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_appInstallationId_fkey" FOREIGN KEY ("appInstallationId") REFERENCES "GitHubAppInstallation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubAppInstallation" ADD CONSTRAINT "GitHubAppInstallation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryAccess" ADD CONSTRAINT "RepositoryAccess_appInstallationId_fkey" FOREIGN KEY ("appInstallationId") REFERENCES "GitHubAppInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryAccess" ADD CONSTRAINT "RepositoryAccess_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
