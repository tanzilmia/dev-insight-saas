import { Router } from "express";

import { asyncHandler } from "../../common/http/async-handler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { generateReportSchema } from "./openclaw.schemas.js";
import { orchestrateReport } from "./openclaw.service.js";
import { OPENCLAW_TOOLS } from "./openclaw.tools.js";

export const openclawRouter = Router();

openclawRouter.use(requireAuth);

// Tool contracts OpenClaw orchestrates (transparency / future external callers).
openclawRouter.get(
  "/tools",
  asyncHandler(async (_req, res) => {
    res.status(200).json({ tools: OPENCLAW_TOOLS });
  })
);

// Structured dashboard report request → OpenClaw orchestration.
openclawRouter.post(
  "/reports/generate",
  asyncHandler(async (req, res) => {
    const payload = generateReportSchema.parse(req.body);
    const report = await orchestrateReport(req.authUser!.id, payload);

    res.status(200).json({ report });
  })
);
