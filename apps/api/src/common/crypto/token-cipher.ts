import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { env } from "../../config/env.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit nonce, recommended for GCM

// The key is validated as a base64-encoded 32-byte value in config/env.ts.
const key = Buffer.from(env.GIT_TOKEN_ENCRYPTION_KEY, "base64");

/**
 * Encrypts a server-side integration secret with AES-256-GCM. The returned string
 * packs the IV, auth tag, and ciphertext as base64 segments joined by ":".
 * This is the only representation that should ever be persisted.
 */
export function encryptToken(plainText: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64")
  ].join(":");
}

/** Reverses {@link encryptToken}. Call only server-side, moments before use. */
export function decryptToken(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(":");

  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted token payload");
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));

  const plain = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final()
  ]);

  return plain.toString("utf8");
}

/** Last 4 characters of a token, kept for display only (e.g. "•••• a1b2"). */
export function tokenLast4(plainText: string): string {
  return plainText.slice(-4);
}
