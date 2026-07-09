import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

import { AppError } from "../../common/errors/app-error.js";
import { env } from "../../config/env.js";

function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) {
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Guards the OpenClaw tool endpoints. These are called by the OpenClaw runtime
 * (not by browsers), authenticated with a shared service key in the
 * `x-openclaw-key` header rather than a user JWT.
 */
export function requireServiceKey(req: Request, _res: Response, next: NextFunction) {
  const configured = env.OPENCLAW_SERVICE_KEY;

  if (!configured) {
    next(new AppError(503, "OpenClaw tool access is not configured", "OPENCLAW_NOT_CONFIGURED"));
    return;
  }

  const provided = req.header("x-openclaw-key");

  if (!provided || !safeEqual(provided, configured)) {
    next(new AppError(401, "Invalid OpenClaw service key", "INVALID_SERVICE_KEY"));
    return;
  }

  next();
}
