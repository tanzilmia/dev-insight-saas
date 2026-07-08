import { AppError } from "../../common/errors/app-error.js";
import { env } from "../../config/env.js";
import type { ChatMessage, LLMProvider } from "./llm-provider.js";

type OpenAIResponse = {
  choices?: { message?: { content?: string } }[];
};

/** OpenAI-compatible chat completions provider. */
export class OpenAIProvider implements LLMProvider {
  get available(): boolean {
    return Boolean(env.OPENAI_API_KEY);
  }

  async complete(messages: ChatMessage[]): Promise<string> {
    if (!env.OPENAI_API_KEY) {
      throw new AppError(400, "OpenAI is not configured", "LLM_NOT_CONFIGURED");
    }

    let response: Response;

    try {
      response = await fetch(`${env.OPENAI_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: env.OPENAI_MODEL,
          messages,
          temperature: 0.4
        })
      });
    } catch {
      throw new AppError(502, "Could not reach the LLM provider", "LLM_UNREACHABLE");
    }

    if (!response.ok) {
      let detail = "";
      try {
        const body = (await response.json()) as { error?: { message?: string } };
        detail = body.error?.message ?? "";
      } catch {
        // ignore non-JSON error bodies
      }
      throw new AppError(
        502,
        `LLM request failed (${response.status})${detail ? `: ${detail}` : ""}`,
        "LLM_ERROR"
      );
    }

    const data = (await response.json()) as OpenAIResponse;
    const content = data.choices?.[0]?.message?.content?.trim();

    if (!content) {
      throw new AppError(502, "LLM returned an empty response", "LLM_EMPTY");
    }

    return content;
  }
}
