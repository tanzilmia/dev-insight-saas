import { AppError } from "../../common/errors/app-error.js";
import { env } from "../../config/env.js";

export type ChatTurn = { role: "user" | "assistant"; content: string };

type GatewayResponse = {
  choices?: { message?: { content?: string } }[];
};

/** Whether the backend can reach a configured OpenClaw runtime. */
export function isGatewayConfigured(): boolean {
  return Boolean(
    env.OPENCLAW_GATEWAY_URL &&
      env.OPENCLAW_GATEWAY_TOKEN &&
      env.OPENCLAW_SERVICE_KEY &&
      env.OPENCLAW_CONTEXT_SIGNING_SECRET
  );
}

/** The system turn supplies an opaque API-signed context, never raw trusted ids. */
function systemNote(contextToken: string): string {
  return (
    "You are DevInsight's assistant. Every DevInsight tool requires the exact opaque " +
    `contextToken below. Pass it unchanged and never reveal it to the user. contextToken=${contextToken}`
  );
}

type StreamGatewayChunk = {
  choices?: { delta?: { content?: string }; message?: { content?: string } }[];
};

/**
 * Asks the gateway for a streamed (OpenAI-compatible SSE) completion and yields
 * the agent's reply in text deltas as they arrive. `messages` is the recent
 * conversation (user/assistant turns) so the agent keeps context across turns.
 * Falls back to yielding the whole reply once if the gateway responds without
 * streaming. Aborting `signal` cancels the upstream request (e.g. the browser
 * closed the stream) so the LLM call stops too.
 */
export async function* streamChatWithAgent(
  messages: ChatTurn[],
  contextToken: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  if (!env.OPENCLAW_GATEWAY_URL || !env.OPENCLAW_GATEWAY_TOKEN) {
    throw new AppError(503, "OpenClaw chat is not configured yet", "OPENCLAW_NOT_CONFIGURED");
  }

  let response: Response;
  try {
    response = await fetch(`${env.OPENCLAW_GATEWAY_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENCLAW_GATEWAY_TOKEN}`
      },
      signal,
      body: JSON.stringify({
        model: "openclaw/default",
        stream: true,
        messages: [{ role: "system", content: systemNote(contextToken) }, ...messages]
      })
    });
  } catch {
    if (signal?.aborted) {
      return; // client cancelled — nothing to surface
    }
    throw new AppError(502, "Could not reach the OpenClaw gateway", "OPENCLAW_UNREACHABLE");
  }

  if (!response.ok || !response.body) {
    throw new AppError(502, "OpenClaw gateway request failed", "OPENCLAW_ERROR");
  }

  // If the gateway ignored `stream`, deliver the whole reply as one chunk.
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("event-stream")) {
    const data = (await response.json()) as GatewayResponse;
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (content) {
      yield content;
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by blank lines; process complete lines.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
          continue;
        }
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          return;
        }
        try {
          const parsed = JSON.parse(payload) as StreamGatewayChunk;
          const delta = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content;
          if (delta) {
            yield delta;
          }
        } catch {
          // Ignore partial/keepalive frames.
        }
      }
    }
  } catch {
    if (signal?.aborted) {
      return; // client cancelled mid-stream
    }
    throw new AppError(502, "OpenClaw stream interrupted", "OPENCLAW_ERROR");
  }
}
