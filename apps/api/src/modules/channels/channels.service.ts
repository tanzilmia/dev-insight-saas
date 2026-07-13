import type { NotificationChannel } from "@prisma/client";

import { prisma } from "../../config/database.js";
import { AppError } from "../../common/errors/app-error.js";
import {
  MANAGER_ROLES,
  requireOrganizationMember,
  requireOrganizationRole
} from "../../common/access/organization-access.js";
import { decryptToken, encryptToken, tokenLast4 } from "../../common/crypto/token-cipher.js";
import { getChannelProvider } from "./channel-registry.js";
import { buildReportMessages } from "./telegram-format.js";
import type {
  CreateChannelInput,
  DetectChatsInput,
  SendReportInput,
  UpdateChannelInput
} from "./channels.schemas.js";

/** Public shape — never includes the encrypted token. */
function toDto(channel: NotificationChannel) {
  return {
    id: channel.id,
    type: channel.type,
    label: channel.label,
    tokenLast4: channel.tokenLast4,
    chatId: channel.chatId,
    chatTitle: channel.chatTitle,
    enabled: channel.enabled,
    lastDeliveryAt: channel.lastDeliveryAt,
    lastDeliveryStatus: channel.lastDeliveryStatus,
    lastDeliveryError: channel.lastDeliveryError,
    createdAt: channel.createdAt
  };
}

export type ChannelDto = ReturnType<typeof toDto>;

async function loadOwnedChannel(actorId: string, id: string, roles = MANAGER_ROLES) {
  const channel = await prisma.notificationChannel.findUnique({ where: { id } });
  if (!channel) {
    throw new AppError(404, "Channel was not found", "CHANNEL_NOT_FOUND");
  }
  await requireOrganizationRole(actorId, channel.organizationId, roles);
  return channel;
}

/** Detect the chats a bot can currently see (admin-panel "Detect chats"). */
export async function detectChats(actorId: string, input: DetectChatsInput) {
  await requireOrganizationRole(actorId, input.organizationId, MANAGER_ROLES);
  const provider = getChannelProvider(input.type);
  const chats = await provider.detectChats(input.token);
  return chats;
}

export async function listChannels(actorId: string, organizationId: string) {
  await requireOrganizationMember(actorId, organizationId);
  const channels = await prisma.notificationChannel.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" }
  });
  return channels.map(toDto);
}

export async function createChannel(actorId: string, input: CreateChannelInput) {
  await requireOrganizationRole(actorId, input.organizationId, MANAGER_ROLES);

  // Validate the token against the provider (rejects a bad token up front).
  await getChannelProvider(input.type).detectChats(input.token);

  const channel = await prisma.$transaction(async (tx) => {
    const saved = await tx.notificationChannel.create({
      data: {
        organizationId: input.organizationId,
        type: input.type,
        label: input.label,
        encryptedToken: encryptToken(input.token),
        tokenLast4: tokenLast4(input.token),
        chatId: input.chatId,
        chatTitle: input.chatTitle ?? null,
        createdById: actorId
      }
    });
    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        actorId,
        action: "channel.create",
        entityType: "NotificationChannel",
        entityId: saved.id,
        // Never record the token itself.
        metadataJson: { type: input.type, chatId: input.chatId }
      }
    });
    return saved;
  });

  return toDto(channel);
}

export async function updateChannel(actorId: string, id: string, input: UpdateChannelInput) {
  const channel = await loadOwnedChannel(actorId, id);

  const data: Record<string, unknown> = {};
  if (input.label !== undefined) data.label = input.label;
  if (input.chatId !== undefined) data.chatId = input.chatId;
  if (input.chatTitle !== undefined) data.chatTitle = input.chatTitle;
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (input.token !== undefined) {
    await getChannelProvider(channel.type).detectChats(input.token); // validate new token
    data.encryptedToken = encryptToken(input.token);
    data.tokenLast4 = tokenLast4(input.token);
  }

  const updated = await prisma.notificationChannel.update({ where: { id }, data });
  return toDto(updated);
}

export async function deleteChannel(actorId: string, id: string) {
  const channel = await loadOwnedChannel(actorId, id);
  await prisma.$transaction(async (tx) => {
    await tx.notificationChannel.delete({ where: { id } });
    await tx.auditLog.create({
      data: {
        organizationId: channel.organizationId,
        actorId,
        action: "channel.delete",
        entityType: "NotificationChannel",
        entityId: id,
        metadataJson: { type: channel.type }
      }
    });
  });
  return { ok: true as const };
}

/** Low-level send: decrypts the token, sends each message, records delivery. */
async function sendMessages(channel: NotificationChannel, messages: string[]) {
  const provider = getChannelProvider(channel.type);
  const token = decryptToken(channel.encryptedToken);
  try {
    for (const message of messages) {
      await provider.sendMessage(token, channel.chatId, message);
    }
    await prisma.notificationChannel.update({
      where: { id: channel.id },
      data: { lastDeliveryAt: new Date(), lastDeliveryStatus: "ok", lastDeliveryError: null }
    });
  } catch (error) {
    const message = (error as Error).message.slice(0, 500);
    await prisma.notificationChannel.update({
      where: { id: channel.id },
      data: { lastDeliveryAt: new Date(), lastDeliveryStatus: "error", lastDeliveryError: message }
    });
    throw error;
  }
}

/** Sends a fixed test message so the manager can verify the connection. */
export async function testChannel(actorId: string, id: string) {
  const channel = await loadOwnedChannel(actorId, id);
  const provider = getChannelProvider(channel.type);
  await sendMessages(channel, [
    "✅ DevInsight test message — this channel is connected. Scheduled reports will arrive here."
  ]);
  return { ok: true as const, limit: provider.messageLimit };
}

type ReportLike = {
  title: string;
  markdown: string;
  periodStart: Date | string;
  periodEnd: Date | string;
  statistics?: {
    commits?: number;
    additions?: number;
    deletions?: number;
    filesChanged?: number;
  } | null;
};

/** Sends a saved report to a channel — the "Send to Telegram" button. */
export async function sendReportToChannel(actorId: string, input: SendReportInput) {
  const channel = await loadOwnedChannel(actorId, input.channelId);

  const report = await prisma.report.findFirst({
    where: { id: input.reportId, organizationId: channel.organizationId }
  });
  if (!report) {
    throw new AppError(404, "Report was not found", "REPORT_NOT_FOUND");
  }

  const stats = (report.statisticsJson as ReportLike["statistics"]) ?? null;
  const provider = getChannelProvider(channel.type);
  const messages = buildReportMessages(
    {
      title: report.title,
      markdown: report.markdownContent,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      statistics: stats
    },
    provider.messageLimit
  );

  await sendMessages(channel, messages);
  return { ok: true as const, messages: messages.length };
}

/**
 * Delivers a just-generated report to a channel for the scheduler. Resilient:
 * a missing/disabled/foreign channel or a send failure is swallowed and
 * returned as a status — report generation must never fail on delivery.
 */
export async function deliverReportForSchedule(
  organizationId: string,
  channelId: string,
  report: ReportLike
): Promise<{ ok: boolean; error?: string }> {
  try {
    const channel = await prisma.notificationChannel.findUnique({ where: { id: channelId } });
    if (!channel || channel.organizationId !== organizationId) {
      return { ok: false, error: "channel not found" };
    }
    if (!channel.enabled) {
      return { ok: false, error: "channel disabled" };
    }
    const provider = getChannelProvider(channel.type);
    const messages = buildReportMessages(report, provider.messageLimit);
    await sendMessages(channel, messages);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message.slice(0, 300) };
  }
}
