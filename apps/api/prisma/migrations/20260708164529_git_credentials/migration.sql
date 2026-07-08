-- CreateEnum
CREATE TYPE "GitProvider" AS ENUM ('GITHUB', 'GITLAB', 'BITBUCKET');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('CONNECTED', 'INVALID', 'DISCONNECTED');

-- CreateTable
CREATE TABLE "GitCredential" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "GitProvider" NOT NULL DEFAULT 'GITHUB',
    "encryptedToken" TEXT NOT NULL,
    "tokenLast4" TEXT,
    "accountLogin" TEXT,
    "scopes" TEXT,
    "status" "CredentialStatus" NOT NULL DEFAULT 'CONNECTED',
    "lastValidatedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GitCredential_organizationId_idx" ON "GitCredential"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "GitCredential_organizationId_provider_key" ON "GitCredential"("organizationId", "provider");

-- AddForeignKey
ALTER TABLE "GitCredential" ADD CONSTRAINT "GitCredential_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitCredential" ADD CONSTRAINT "GitCredential_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
