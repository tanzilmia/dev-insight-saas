import { AppError } from "../../common/errors/app-error.js";
import { env } from "../../config/env.js";

type ChatContext = { organizationId: string; requesterId: string };

type GatewayResponse = {
  choices?: { message?: { content?: string } }[];
};

/** Whether the backend can reach a configured OpenClaw runtime. */
export function isGatewayConfigured(): boolean {
  return Boolean(env.OPENCLAW_GATEWAY_URL && env.OPENCLAW_GATEWAY_TOKEN);
}

/**
 * Sends a chat message to the OpenClaw runtime and returns the agent's reply.
 * The gateway token stays server-side; the org/requester context is passed so
 * the agent scopes tool calls to the right organization and user.
 */
export async function chatWithAgent(message: string, context: ChatContext): Promise<string> {
  if (!env.OPENCLAW_GATEWAY_URL || !env.OPENCLAW_GATEWAY_TOKEN) {
    throw new AppError(503, "OpenClaw chat is not configured yet", "OPENCLAW_NOT_CONFIGURED");
  }

  const systemNote =
    `You are DevInsight's assistant, acting for organizationId=${context.organizationId} ` +
    `and requesterId=${context.requesterId}. Pass these values when calling report tools.`;

  let response: Response;

  try {
    response = await fetch(`${env.OPENCLAW_GATEWAY_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENCLAW_GATEWAY_TOKEN}`
      },
      body: JSON.stringify({
        // OpenClaw treats `model` as an agent target; "openclaw/default" is the
        // stable alias for the configured default agent.
        model: "openclaw/default",
        messages: [
          { role: "system", content: systemNote },
          { role: "user", content: message }
        ]
      })
    });
  } catch {
    throw new AppError(502, "Could not reach the OpenClaw gateway", "OPENCLAW_UNREACHABLE");
  }

  if (!response.ok) {
    throw new AppError(502, "OpenClaw gateway request failed", "OPENCLAW_ERROR");
  }

  const data = (await response.json()) as GatewayResponse;
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

type StreamGatewayChunk = {
  choices?: { delta?: { content?: string }; message?: { content?: string } }[];
};

/**
 * Streaming variant of {@link chatWithAgent}: asks the gateway for a streamed
 * (OpenAI-compatible SSE) completion and yields the agent's reply in text
 * deltas as they arrive. Falls back to yielding the whole reply once if the
 * gateway responds without streaming.
 */
export async function* streamChatWithAgent(
  message: string,
  context: ChatContext
): AsyncGenerator<string> {
  if (!env.OPENCLAW_GATEWAY_URL || !env.OPENCLAW_GATEWAY_TOKEN) {
    throw new AppError(503, "OpenClaw chat is not configured yet", "OPENCLAW_NOT_CONFIGURED");
  }

  const systemNote =
    `You are DevInsight's assistant, acting for organizationId=${context.organizationId} ` +
    `and requesterId=${context.requesterId}. Pass these values when calling report tools.`;

  let response: Response;
  try {
    response = await fetch(`${env.OPENCLAW_GATEWAY_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENCLAW_GATEWAY_TOKEN}`
      },
      body: JSON.stringify({
        model: "openclaw/default",
        stream: true,
        messages: [
          { role: "system", content: systemNote },
          { role: "user", content: message }
        ]
      })
    });
  } catch {
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
}
