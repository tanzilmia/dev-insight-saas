import { AppError } from "../../common/errors/app-error.js";
import { env } from "../../config/env.js";

export type ChatTurn = { role: "user" | "assistant"; content: string };

type GatewayResponse = {
  choices?: { message?: { content?: string } }[];
};

type GatewayErrorResponse = {
  error?:
    | string
    | {
        message?: unknown;
        type?: unknown;
        code?: unknown;
      };
};

const PROVIDER_LIMIT_MESSAGE =
  "The AI service has reached its provider limit. Please try again later.";

function gatewayError(payload: unknown, status?: number): AppError | null {
  const body = payload as GatewayErrorResponse | null;
  const upstreamError = body && typeof body === "object" ? body.error : undefined;

  let details = "";
  if (typeof upstreamError === "string") {
    details = upstreamError;
  } else if (upstreamError && typeof upstreamError === "object") {
    details = [upstreamError.message, upstreamError.type, upstreamError.code]
      .filter((value) => value !== undefined && value !== null)
      .map(String)
      .join(" ");
  }

  const isProviderLimit =
    status === 429 ||
    /rate.?limit|too many requests|request too large|tokens per (minute|day)|quota|\b130[25]\b/i.test(
      details
    );

  if (isProviderLimit) {
    return new AppError(429, PROVIDER_LIMIT_MESSAGE, "OPENCLAW_PROVIDER_LIMIT");
  }

  if (upstreamError !== undefined) {
    return new AppError(502, "OpenClaw gateway request failed", "OPENCLAW_ERROR");
  }

  return null;
}

async function errorFromResponse(response: Response): Promise<AppError> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    // Some gateways return an empty or non-JSON error body. Only the HTTP
    // status is needed to identify a rate limit; other details stay private.
  }

  return (
    gatewayError(payload, response.status) ??
    new AppError(502, "OpenClaw gateway request failed", "OPENCLAW_ERROR")
  );
}

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
} & GatewayErrorResponse;

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

  if (!response.ok) {
    throw await errorFromResponse(response);
  }

  if (!response.body) {
    throw new AppError(502, "OpenClaw gateway request failed", "OPENCLAW_ERROR");
  }

  // If the gateway ignored `stream`, deliver the whole reply as one chunk.
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("event-stream")) {
    let data: GatewayResponse & GatewayErrorResponse;
    try {
      data = (await response.json()) as GatewayResponse & GatewayErrorResponse;
    } catch {
      throw new AppError(502, "OpenClaw gateway request failed", "OPENCLAW_ERROR");
    }

    const upstreamError = gatewayError(data, response.status);
    if (upstreamError) {
      throw upstreamError;
    }

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
        let parsed: StreamGatewayChunk;
        try {
          parsed = JSON.parse(payload) as StreamGatewayChunk;
        } catch {
          // Ignore partial/keepalive frames.
          continue;
        }

        const upstreamError = gatewayError(parsed, response.status);
        if (upstreamError) {
          throw upstreamError;
        }

        const delta = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content;
        if (delta) {
          yield delta;
        }
      }
    }
  } catch (error) {
    if (signal?.aborted) {
      return; // client cancelled mid-stream
    }
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(502, "OpenClaw stream interrupted", "OPENCLAW_ERROR");
  }
}
