-- CreateTable
CREATE TABLE "CodeQualityConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'sonarqube',
    "baseUrl" TEXT NOT NULL,
    "tokenCipher" TEXT NOT NULL,
    "organizationKey" TEXT,
    "status" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodeQualityConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CodeQualityConnection_organizationId_key" ON "CodeQualityConnection"("organizationId");

-- AddForeignKey
ALTER TABLE "CodeQualityConnection" ADD CONSTRAINT "CodeQualityConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
