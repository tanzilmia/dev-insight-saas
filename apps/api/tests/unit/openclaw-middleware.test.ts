import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { AppError } from "../../src/common/errors/app-error.js";
import { env } from "../../src/config/env.js";
import { mintOpenClawContext } from "../../src/modules/openclaw/openclaw-context.js";
import { requireServiceKey } from "../../src/modules/openclaw/openclaw.middleware.js";

function requestWith(headers: Record<string, string>): Request {
  return {
    header(name: string) {
      return headers[name.toLowerCase()];
    }
  } as Request;
}

function runMiddleware(req: Request) {
  const next = vi.fn<NextFunction>();
  requireServiceKey(req, {} as Response, next);
  return next;
}

describe("OpenClaw service tool authentication", () => {
  const context = { organizationId: "org_signed", requesterId: "user_signed" };

  it("requires the service key before inspecting tenant context", () => {
    const next = runMiddleware(requestWith({}));
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401, code: "INVALID_SERVICE_KEY" })
    );
  });

  it("requires an API-signed context token", () => {
    const next = runMiddleware(
      requestWith({ "x-openclaw-key": env.OPENCLAW_SERVICE_KEY! })
    );
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401, code: "MISSING_OPENCLAW_CONTEXT" })
    );
  });

  it("attaches identity only from verified claims", () => {
    const req = requestWith({
      "x-openclaw-key": env.OPENCLAW_SERVICE_KEY!,
      "x-openclaw-context": mintOpenClawContext(context)
    });
    const next = runMiddleware(req);

    expect(next).toHaveBeenCalledWith();
    expect(req.openClawContext).toEqual(context);
  });

  it("returns a generic auth error for a forged context", () => {
    const next = runMiddleware(
      requestWith({
        "x-openclaw-key": env.OPENCLAW_SERVICE_KEY!,
        "x-openclaw-context": "forged-context"
      })
    );
    const error = next.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 401, code: "INVALID_OPENCLAW_CONTEXT" });
  });
});
