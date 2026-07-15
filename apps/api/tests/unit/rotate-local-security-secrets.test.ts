import { describe, expect, it } from "vitest";

const { rotateEnvText } = await import(
  "../../../../scripts/rotate-local-security-secrets.mjs"
);

describe("local security secret rotation", () => {
  it("replaces existing secrets, adds missing ones, and does not retain old values", () => {
    const original = [
      'DATABASE_URL="postgresql://example"',
      'JWT_ACCESS_SECRET="old-jwt-secret"',
      'OPENCLAW_SERVICE_KEY="old-service-secret"',
      ""
    ].join("\n");
    const rotated = rotateEnvText(original);

    expect(rotated).toContain('DATABASE_URL="postgresql://example"');
    expect(rotated).not.toContain("old-jwt-secret");
    expect(rotated).not.toContain("old-service-secret");
    for (const key of [
      "JWT_ACCESS_SECRET",
      "OPENCLAW_SERVICE_KEY",
      "OPENCLAW_CONTEXT_SIGNING_SECRET",
      "MCP_ACCESS_TOKEN"
    ]) {
      expect(rotated.match(new RegExp(`^${key}=`, "gm"))).toHaveLength(1);
      expect(rotated.match(new RegExp(`^${key}=\"([A-Za-z0-9_-]{64})\"$`, "m"))).not.toBeNull();
    }
  });

  it("generates fresh values on every rotation", () => {
    expect(rotateEnvText("")).not.toBe(rotateEnvText(""));
  });
});
