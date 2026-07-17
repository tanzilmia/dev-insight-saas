import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { env } from "../../src/config/env.js";
import { streamChatWithAgent } from "../../src/modules/openclaw/openclaw.gateway.js";

const originalGatewayUrl = env.OPENCLAW_GATEWAY_URL;
const originalGatewayToken = env.OPENCLAW_GATEWAY_TOKEN;

function mockFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function collectReply(): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of streamChatWithAgent(
    [{ role: "user", content: "Hello" }],
    "opaque-test-context"
  )) {
    chunks.push(chunk);
  }
  return chunks.join("");
}

beforeEach(() => {
  env.OPENCLAW_GATEWAY_URL = "https://openclaw.example.test";
  env.OPENCLAW_GATEWAY_TOKEN = "test-gateway-token";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  env.OPENCLAW_GATEWAY_URL = originalGatewayUrl;
  env.OPENCLAW_GATEWAY_TOKEN = originalGatewayToken;
});

describe("OpenClaw gateway streaming", () => {
  it("yields text from normal SSE completion chunks", async () => {
    mockFetch(
      new Response(
        [
          'data: {"choices":[{"delta":{"content":"gateway "}}]}',
          'data: {"choices":[{"delta":{"content":"ok"}}]}',
          "data: [DONE]",
          ""
        ].join("\n\n"),
        { headers: { "Content-Type": "text/event-stream" } }
      )
    );

    await expect(collectReply()).resolves.toBe("gateway ok");
  });

  it("maps a streamed provider limit to a sanitized application error", async () => {
    const privateProviderDetail =
      "Request too large for organization org_private on tokens per day: Limit 100000";
    mockFetch(
      new Response(
        `data: ${JSON.stringify({
          error: { message: privateProviderDetail, type: "rate_limit_error" }
        })}\n\n`,
        { headers: { "Content-Type": "text/event-stream" } }
      )
    );

    let caught: unknown;
    try {
      await collectReply();
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      statusCode: 429,
      code: "OPENCLAW_PROVIDER_LIMIT",
      message: "The AI service has reached its provider limit. Please try again later."
    });
    expect(String((caught as Error).message)).not.toContain("org_private");
    expect(String((caught as Error).message)).not.toContain("100000");
  });

  it("maps a non-stream provider limit to the same sanitized error", async () => {
    mockFetch(
      new Response(
        JSON.stringify({
          error: {
            message: "Rate limit reached for secret upstream organization",
            code: 1302
          }
        }),
        {
          status: 429,
          headers: { "Content-Type": "application/json" }
        }
      )
    );

    await expect(collectReply()).rejects.toMatchObject({
      statusCode: 429,
      code: "OPENCLAW_PROVIDER_LIMIT",
      message: "The AI service has reached its provider limit. Please try again later."
    });
  });
});
