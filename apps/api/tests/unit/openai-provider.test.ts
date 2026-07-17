import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { env } from "../../src/config/env.js";
import { OpenAIProvider } from "../../src/modules/llm/openai.provider.js";

const original = {
  apiKey: env.OPENAI_API_KEY,
  baseUrl: env.OPENAI_BASE_URL,
  model: env.OPENAI_MODEL
};

function successfulFetch() {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({ choices: [{ message: { content: "generated report" } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  env.OPENAI_API_KEY = "test-provider-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  env.OPENAI_API_KEY = original.apiKey;
  env.OPENAI_BASE_URL = original.baseUrl;
  env.OPENAI_MODEL = original.model;
});

describe("OpenAI-compatible report provider", () => {
  it("disables thinking for Z.AI GLM reports", async () => {
    env.OPENAI_BASE_URL = "https://api.z.ai/api/coding/paas/v4";
    env.OPENAI_MODEL = "glm-5.2";
    const fetchMock = successfulFetch();

    await expect(
      new OpenAIProvider().complete([{ role: "user", content: "Generate a report" }])
    ).resolves.toBe("generated report");

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "glm-5.2",
      thinking: { type: "disabled" }
    });
  });

  it("does not send Z.AI-only options to another compatible provider", async () => {
    env.OPENAI_BASE_URL = "https://api.example.test/v1";
    env.OPENAI_MODEL = "example-model";
    const fetchMock = successfulFetch();

    await new OpenAIProvider().complete([{ role: "user", content: "Generate a report" }]);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).not.toHaveProperty("thinking");
  });
});
