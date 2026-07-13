-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('TELEGRAM');

-- AlterTable
ALTER TABLE "ReportSchedule" ADD COLUMN     "channelId" TEXT;

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "ChannelType" NOT NULL DEFAULT 'TELEGRAM',
    "label" TEXT NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "tokenLast4" TEXT,
    "chatId" TEXT NOT NULL,
    "chatTitle" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "lastDeliveryAt" TIMESTAMP(3),
    "lastDeliveryStatus" TEXT,
    "lastDeliveryError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationChannel_organizationId_idx" ON "NotificationChannel"("organizationId");

-- AddForeignKey
ALTER TABLE "NotificationChannel" ADD CONSTRAINT "NotificationChannel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
