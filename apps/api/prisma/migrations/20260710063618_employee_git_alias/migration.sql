-- CreateTable
CREATE TABLE "EmployeeGitAlias" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "GitProvider" NOT NULL DEFAULT 'GITHUB',
    "username" TEXT,
    "email" TEXT,
    "name" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeGitAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeGitAlias_organizationId_provider_username_idx" ON "EmployeeGitAlias"("organizationId", "provider", "username");

-- CreateIndex
CREATE INDEX "EmployeeGitAlias_organizationId_provider_email_idx" ON "EmployeeGitAlias"("organizationId", "provider", "email");

-- CreateIndex
CREATE INDEX "EmployeeGitAlias_userId_idx" ON "EmployeeGitAlias"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeGitAlias_organizationId_provider_username_key" ON "EmployeeGitAlias"("organizationId", "provider", "username");

-- AddForeignKey
ALTER TABLE "EmployeeGitAlias" ADD CONSTRAINT "EmployeeGitAlias_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeGitAlias" ADD CONSTRAINT "EmployeeGitAlias_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
