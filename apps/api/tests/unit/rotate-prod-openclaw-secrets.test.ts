import { describe, expect, it } from "vitest";

const { rotateOpenClawEnvText } = await import(
  "../../../../scripts/rotate-prod-openclaw-secrets.mjs"
);

describe("production OpenClaw secret rotation", () => {
  it("rotates every cross-service secret without changing unrelated config", () => {
    const original = [
      'DATABASE_URL="postgresql://example"',
      'OPENCLAW_GATEWAY_URL="http://openclaw-gateway:18789"',
      'OPENCLAW_GATEWAY_TOKEN="exposed-gateway-token"',
      'OPENCLAW_SERVICE_KEY="exposed-service-key"',
      ""
    ].join("\n");

    const rotated = rotateOpenClawEnvText(original);

    expect(rotated).toContain('DATABASE_URL="postgresql://example"');
    expect(rotated).toContain('OPENCLAW_GATEWAY_URL="http://openclaw-gateway:18789"');
    expect(rotated).not.toContain("exposed-gateway-token");
    expect(rotated).not.toContain("exposed-service-key");

    for (const key of [
      "OPENCLAW_GATEWAY_TOKEN",
      "OPENCLAW_SERVICE_KEY",
      "MCP_ACCESS_TOKEN",
      "OPENCLAW_CONTEXT_SIGNING_SECRET"
    ]) {
      expect(rotated.match(new RegExp(`^${key}=`, "gm"))).toHaveLength(1);
      expect(rotated.match(new RegExp(`^${key}="([A-Za-z0-9_-]{64})"$`, "m"))).not.toBeNull();
    }
  });

  it("generates independent values for every rotation", () => {
    const first = rotateOpenClawEnvText("");
    const second = rotateOpenClawEnvText("");

    expect(first).not.toBe(second);
    const values = [...first.matchAll(/="([A-Za-z0-9_-]{64})"$/gm)].map((match) => match[1]);
    expect(new Set(values).size).toBe(4);
  });
});
