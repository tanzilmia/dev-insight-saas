import { z } from "zod";

export const channelTypeSchema = z.enum(["TELEGRAM"]);

export const createChannelSchema = z.object({
  organizationId: z.string().min(1),
  type: channelTypeSchema.default("TELEGRAM"),
  label: z.string().trim().min(1).max(120),
  token: z.string().trim().min(10).max(200),
  chatId: z.string().trim().min(1).max(64),
  chatTitle: z.string().trim().max(200).optional()
});

export type CreateChannelInput = z.infer<typeof createChannelSchema>;

/** Pre-save "Detect chats": send the token, get the chats the bot can see. */
export const detectChatsSchema = z.object({
  organizationId: z.string().min(1),
  type: channelTypeSchema.default("TELEGRAM"),
  token: z.string().trim().min(10).max(200)
});

export type DetectChatsInput = z.infer<typeof detectChatsSchema>;

export const updateChannelSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  token: z.string().trim().min(10).max(200).optional(),
  chatId: z.string().trim().min(1).max(64).optional(),
  chatTitle: z.string().trim().max(200).nullable().optional(),
  enabled: z.boolean().optional()
});

export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;

export const listChannelsQuerySchema = z.object({
  organizationId: z.string().min(1)
});

export const channelParamsSchema = z.object({ id: z.string().min(1) });

/** Send a saved report to a channel (the "Send to Telegram" button). */
export const sendReportSchema = z.object({
  channelId: z.string().min(1),
  reportId: z.string().min(1)
});

export type SendReportInput = z.infer<typeof sendReportSchema>;
