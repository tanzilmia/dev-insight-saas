import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";

import { AppError } from "../../src/common/errors/app-error.js";
import { env } from "../../src/config/env.js";
import {
  mintOpenClawContext,
  verifyOpenClawContext
} from "../../src/modules/openclaw/openclaw-context.js";

describe("OpenClaw signed tenant context", () => {
  const context = { organizationId: "org_123", requesterId: "user_456" };

  it("round-trips the verified tenant identity with a ten-minute maximum lifetime", () => {
    const token = mintOpenClawContext(context);
    expect(verifyOpenClawContext(token)).toEqual(context);

    const payload = jwt.decode(token) as { iat: number; exp: number };
    expect(payload.exp - payload.iat).toBeGreaterThan(0);
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(10 * 60);
  });

  it("rejects a tampered signature", () => {
    const token = mintOpenClawContext(context);
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    expect(() => verifyOpenClawContext(tampered)).toThrowError(AppError);
  });

  it("rejects expired, wrong-audience, and wrong-issuer contexts", () => {
    const secret = env.OPENCLAW_CONTEXT_SIGNING_SECRET!;
    const base = { organizationId: context.organizationId };
    const expired = jwt.sign(base, secret, {
      subject: context.requesterId,
      issuer: "devinsight-api",
      audience: "devinsight-openclaw-tools",
      expiresIn: -1
    });
    const wrongAudience = jwt.sign(base, secret, {
      subject: context.requesterId,
      issuer: "devinsight-api",
      audience: "another-service",
      expiresIn: "10m"
    });
    const wrongIssuer = jwt.sign(base, secret, {
      subject: context.requesterId,
      issuer: "another-issuer",
      audience: "devinsight-openclaw-tools",
      expiresIn: "10m"
    });

    for (const token of [expired, wrongAudience, wrongIssuer]) {
      expect(() => verifyOpenClawContext(token)).toThrowError(
        expect.objectContaining({
          statusCode: 401,
          code: "INVALID_OPENCLAW_CONTEXT"
        })
      );
    }
  });
});
