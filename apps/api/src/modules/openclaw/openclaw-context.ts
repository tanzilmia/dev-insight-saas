import jwt from "jsonwebtoken";

import { AppError } from "../../common/errors/app-error.js";
import { env } from "../../config/env.js";

const ISSUER = "devinsight-api";
const AUDIENCE = "devinsight-openclaw-tools";
const LIFETIME = "10m";

export type OpenClawToolContext = {
  organizationId: string;
  requesterId: string;
};

function signingSecret(): string {
  if (!env.OPENCLAW_CONTEXT_SIGNING_SECRET) {
    throw new AppError(
      503,
      "OpenClaw tool context is not configured",
      "OPENCLAW_NOT_CONFIGURED"
    );
  }
  return env.OPENCLAW_CONTEXT_SIGNING_SECRET;
}

/** Mint an opaque, short-lived identity that only the DevInsight API can sign. */
export function mintOpenClawContext(context: OpenClawToolContext): string {
  return jwt.sign({ organizationId: context.organizationId }, signingSecret(), {
    algorithm: "HS256",
    issuer: ISSUER,
    audience: AUDIENCE,
    subject: context.requesterId,
    expiresIn: LIFETIME
  });
}

/** Verify strict token metadata and derive the tool caller's tenant identity. */
export function verifyOpenClawContext(token: string): OpenClawToolContext {
  const secret = signingSecret();

  try {
    const payload = jwt.verify(token, secret, {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE
    });

    if (
      typeof payload === "string" ||
      typeof payload.sub !== "string" ||
      typeof payload.organizationId !== "string" ||
      payload.organizationId.length === 0
    ) {
      throw new Error("Missing context claims");
    }

    return {
      requesterId: payload.sub,
      organizationId: payload.organizationId
    };
  } catch {
    throw new AppError(
      401,
      "Invalid or expired OpenClaw context",
      "INVALID_OPENCLAW_CONTEXT"
    );
  }
}
