-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "dataFingerprint" TEXT;

-- CreateIndex
CREATE INDEX "Report_organizationId_reportType_dataFingerprint_idx" ON "Report"("organizationId", "reportType", "dataFingerprint");
