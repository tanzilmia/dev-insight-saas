export type ChatMessage = {
  role: "system" | "user";
  content: string;
};

/**
 * Provider-agnostic LLM interface. OpenAI is the only implementation today;
 * others (Anthropic, local, OpenRouter) can be added behind this without
 * touching callers — the codebase must never hardcode a single LLM provider.
 */
export interface LLMProvider {
  /** True when the provider is configured (e.g. an API key is present). */
  readonly available: boolean;
  complete(messages: ChatMessage[]): Promise<string>;
}
