import type { ChannelType } from "@prisma/client";

/** A chat/group the bot can currently see (for admin-panel "Detect chats"). */
export type DetectedChat = {
  id: string;
  type: string;
  title: string;
};

/**
 * A delivery destination provider (Telegram today; Discord/Slack later drop in
 * behind this interface). Per the project rule, channel-specific API calls stay
 * behind this abstraction — services never call a channel API directly.
 */
export interface ChannelProvider {
  readonly type: ChannelType;

  /** Discover chats the bot can currently see. Powers admin "Detect chats". */
  detectChats(token: string): Promise<DetectedChat[]>;

  /** Send one plain-text message (≤ the channel's per-message limit). */
  sendMessage(token: string, chatId: string, text: string): Promise<void>;

  /**
   * Send a file attachment (e.g. a long report as a `.md`) with an optional
   * caption. Optional — providers that can't attach files omit it, and callers
   * fall back to chunked text messages.
   */
  sendDocument?(
    token: string,
    chatId: string,
    filename: string,
    content: string,
    caption?: string
  ): Promise<void>;

  /** Max characters per message; callers split longer text into chunks. */
  readonly messageLimit: number;
}
