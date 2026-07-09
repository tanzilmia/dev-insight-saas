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
