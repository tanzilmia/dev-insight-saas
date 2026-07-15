-- CreateTable
CREATE TABLE "CodeQualitySnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectKey" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bugs" INTEGER NOT NULL,
    "vulnerabilities" INTEGER NOT NULL,
    "codeSmells" INTEGER NOT NULL,
    "securityHotspots" INTEGER NOT NULL,
    "coverage" DOUBLE PRECISION,
    "duplicatedLinesDensity" DOUBLE PRECISION,
    "techDebtMinutes" INTEGER,
    "linesOfCode" INTEGER,
    "gateStatus" TEXT NOT NULL,
    "reliabilityRating" TEXT,
    "securityRating" TEXT,
    "maintainabilityRating" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodeQualitySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CodeQualitySnapshot_organizationId_projectKey_idx" ON "CodeQualitySnapshot"("organizationId", "projectKey");

-- CreateIndex
CREATE UNIQUE INDEX "CodeQualitySnapshot_organizationId_projectKey_dayKey_key" ON "CodeQualitySnapshot"("organizationId", "projectKey", "dayKey");

-- AddForeignKey
ALTER TABLE "CodeQualitySnapshot" ADD CONSTRAINT "CodeQualitySnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
