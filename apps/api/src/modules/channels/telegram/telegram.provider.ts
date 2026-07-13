import { AppError } from "../../../common/errors/app-error.js";
import type { ChannelProvider, DetectedChat } from "../channel-provider.js";

const TELEGRAM_API_BASE = "https://api.telegram.org";
// Telegram's hard per-message cap is 4096 characters; stay a little under.
const MESSAGE_LIMIT = 4000;

type TelegramResponse<T> =
  | { ok: true; result: T }
  | { ok: false; error_code?: number; description?: string };

type TelegramChat = {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
};

type TelegramUpdate = {
  message?: { chat: TelegramChat };
  edited_message?: { chat: TelegramChat };
  channel_post?: { chat: TelegramChat };
  my_chat_member?: { chat: TelegramChat };
};

/**
 * Telegram Bot API provider. The bot token lives only in the URL path we build
 * here (never logged); the caller passes the decrypted token per request. Maps
 * Telegram's `{ ok: false, description }` envelope to clean AppErrors.
 */
export class TelegramProvider implements ChannelProvider {
  readonly type = "TELEGRAM" as const;
  readonly messageLimit = MESSAGE_LIMIT;

  private async call<T>(
    token: string,
    method: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined
      });
    } catch {
      throw new AppError(502, "Could not reach Telegram", "TELEGRAM_UNREACHABLE");
    }

    const payload = (await response.json().catch(() => null)) as TelegramResponse<T> | null;

    if (!payload) {
      throw new AppError(502, "Telegram returned an unexpected response", "TELEGRAM_BAD_RESPONSE");
    }
    if (!payload.ok) {
      const code = payload.error_code;
      const description = payload.description ?? "Telegram request failed";
      if (code === 401) {
        throw new AppError(400, "The bot token is invalid", "TELEGRAM_UNAUTHORIZED");
      }
      if (code === 400 && /chat not found/i.test(description)) {
        throw new AppError(
          400,
          "Chat not found — add the bot to the group and message it once",
          "TELEGRAM_CHAT_NOT_FOUND"
        );
      }
      if (code === 403) {
        throw new AppError(
          400,
          "The bot was blocked or removed from this chat",
          "TELEGRAM_FORBIDDEN"
        );
      }
      throw new AppError(502, `Telegram: ${description}`, "TELEGRAM_ERROR");
    }

    return payload.result;
  }

  async detectChats(token: string): Promise<DetectedChat[]> {
    const updates = await this.call<TelegramUpdate[]>(token, "getUpdates");
    const byId = new Map<string, DetectedChat>();
    for (const update of updates) {
      const chat =
        update.message?.chat ??
        update.channel_post?.chat ??
        update.my_chat_member?.chat ??
        update.edited_message?.chat;
      if (!chat) {
        continue;
      }
      byId.set(String(chat.id), {
        id: String(chat.id),
        type: chat.type,
        title: chat.title ?? chat.username ?? chat.first_name ?? String(chat.id)
      });
    }
    return [...byId.values()];
  }

  async sendMessage(token: string, chatId: string, text: string): Promise<void> {
    // Plain text (no parse_mode) — bulletproof against Markdown/HTML escaping.
    await this.call(token, "sendMessage", {
      chat_id: chatId,
      text,
      disable_web_page_preview: true
    });
  }
}
