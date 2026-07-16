-- AlterTable
ALTER TABLE "Repository" ADD COLUMN     "sonarProvisionedAt" TIMESTAMP(3),
ADD COLUMN     "sonarTokenCipher" TEXT;
