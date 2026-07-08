import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";

import { AppError } from "../../common/errors/app-error.js";
import { env } from "../../config/env.js";
import type { AuthUser } from "./auth.types.js";

declare global {
  // Express exposes request augmentation through a namespace declaration.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const authorization = req.headers.authorization;
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;

  if (!token) {
    next(new AppError(401, "Missing bearer token", "MISSING_TOKEN"));
    return;
  }

  try {
    req.authUser = jwt.verify(token, env.JWT_ACCESS_SECRET) as AuthUser;
    next();
  } catch {
    next(new AppError(401, "Invalid or expired bearer token", "INVALID_TOKEN"));
  }
}
