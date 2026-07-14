import { describe, expect, it } from "vitest";

import {
  decryptToken,
  encryptToken,
  tokenLast4
} from "../../src/common/crypto/token-cipher.js";

describe("token-cipher", () => {
  it("round-trips a token through encrypt -> decrypt", () => {
    const secret = "ghp_exampleTokenValue1234567890";
    expect(decryptToken(encryptToken(secret))).toBe(secret);
  });

  it("emits the iv:tag:ciphertext base64 triple format", () => {
    const parts = encryptToken("hello").split(":");
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(part.length).toBeGreaterThan(0);
    }
  });

  it("uses a fresh IV, so identical plaintext encrypts differently each time", () => {
    expect(encryptToken("same-input")).not.toBe(encryptToken("same-input"));
  });

  it("round-trips unicode (multi-byte) tokens", () => {
    expect(decryptToken(encryptToken("পাসওয়ার্ড🔐"))).toBe("পাসওয়ার্ড🔐");
  });

  it("documents the empty-plaintext edge: empty ciphertext base64 trips the guard", () => {
    // Not a real case (a PAT/bot token is never empty); pinning current behavior.
    expect(() => decryptToken(encryptToken(""))).toThrow(/Malformed/);
  });

  it("throws on a malformed payload", () => {
    expect(() => decryptToken("not-a-valid-payload")).toThrow(/Malformed encrypted token payload/);
    expect(() => decryptToken("only:two")).toThrow(/Malformed/);
  });

  it("throws when the ciphertext is tampered (GCM integrity check)", () => {
    const [ivB64, tagB64, dataB64] = encryptToken("tamper-me").split(":");
    const bytes = Buffer.from(dataB64!, "base64");
    bytes[0] = bytes[0]! ^ 0xff; // flip a bit -> auth tag no longer matches
    const tampered = [ivB64, tagB64, bytes.toString("base64")].join(":");
    expect(() => decryptToken(tampered)).toThrow();
  });

  it("tokenLast4 returns the last four characters", () => {
    expect(tokenLast4("ghp_abcd1234")).toBe("1234");
    expect(tokenLast4("ab")).toBe("ab");
  });
});
