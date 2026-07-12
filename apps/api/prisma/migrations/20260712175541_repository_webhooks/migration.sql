-- AlterTable
ALTER TABLE "Repository" ADD COLUMN     "lastWebhookAt" TIMESTAMP(3),
ADD COLUMN     "webhookExternalId" TEXT,
ADD COLUMN     "webhookSecret" TEXT,
ADD COLUMN     "webhookStatus" TEXT;
