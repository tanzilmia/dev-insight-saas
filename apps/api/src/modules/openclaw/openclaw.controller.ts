import { Router } from "express";
import { z } from "zod";

import { asyncHandler } from "../../common/http/async-handler.js";
import { AppError } from "../../common/errors/app-error.js";
import { requireOrganizationMember } from "../../common/access/organization-access.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  chatWithAgent,
  isGatewayConfigured,
  streamChatWithAgent
} from "./openclaw.gateway.js";
import { generateReportSchema } from "./openclaw.schemas.js";
import { orchestrateReport } from "./openclaw.service.js";
import { OPENCLAW_TOOLS } from "./openclaw.tools.js";

const chatSchema = z.object({
  organizationId: z.string().min(1),
  message: z.string().trim().min(1).max(2000)
});

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

// Lets the frontend know whether the website chat box can be used yet.
openclawRouter.get(
  "/chat/status",
  asyncHandler(async (_req, res) => {
    res.status(200).json({ configured: isGatewayConfigured() });
  })
);

// Website chat box → OpenClaw agent. The gateway token stays server-side; org
// access is enforced before proxying, and the user's context is forwarded.
openclawRouter.post(
  "/chat",
  asyncHandler(async (req, res) => {
    const { organizationId, message } = chatSchema.parse(req.body);
    await requireOrganizationMember(req.authUser!.id, organizationId);
    const reply = await chatWithAgent(message, {
      organizationId,
      requesterId: req.authUser!.id
    });

    res.status(200).json({ reply });
  })
);

// Streaming variant — the agent's reply is written to the response in text
// chunks as it is produced, so the chat box can render it token-by-token.
openclawRouter.post(
  "/chat/stream",
  asyncHandler(async (req, res) => {
    const { organizationId, message } = chatSchema.parse(req.body);
    await requireOrganizationMember(req.authUser!.id, organizationId);

    // Validate reachability before committing to a streamed (headers-sent)
    // response, so this failure can still be a normal JSON error.
    if (!isGatewayConfigured()) {
      throw new AppError(503, "OpenClaw chat is not configured yet", "OPENCLAW_NOT_CONFIGURED");
    }

    res.status(200);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    try {
      for await (const delta of streamChatWithAgent(message, {
        organizationId,
        requesterId: req.authUser!.id
      })) {
        res.write(delta);
      }
    } catch (error) {
      // Headers are already sent, so surface the error inline in the stream.
      const note = error instanceof AppError ? error.message : "Failed to generate a reply";
      res.write(`\n\n_${note}_`);
    } finally {
      res.end();
    }
  })
);
