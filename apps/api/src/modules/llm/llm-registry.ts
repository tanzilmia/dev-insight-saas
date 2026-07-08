import type { LLMProvider } from "./llm-provider.js";
import { OpenAIProvider } from "./openai.provider.js";

const openaiProvider = new OpenAIProvider();

/** Returns the active LLM provider. Only OpenAI is wired for now. */
export function getLLMProvider(): LLMProvider {
  return openaiProvider;
}
