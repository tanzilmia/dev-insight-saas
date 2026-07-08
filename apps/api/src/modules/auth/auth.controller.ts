import { Router } from "express";

import { asyncHandler } from "../../common/http/async-handler.js";
import { loginSchema, registerSchema } from "./auth.schemas.js";
import { getCurrentUser, login, register } from "./auth.service.js";
import { requireAuth } from "./auth.middleware.js";

export const authRouter = Router();

authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const payload = registerSchema.parse(req.body);
    const result = await register(payload);

    res.status(201).json(result);
  })
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const payload = loginSchema.parse(req.body);
    const result = await login(payload);

    res.status(200).json(result);
  })
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await getCurrentUser(req.authUser!.id);

    res.status(200).json(result);
  })
);

