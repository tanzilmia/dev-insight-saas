import { Router } from "express";
import { z } from "zod";

import { asyncHandler } from "../../common/http/async-handler.js";
import { AppError } from "../../common/errors/app-error.js";
import { requireOrganizationMember } from "../../common/access/organization-access.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { isGatewayConfigured, streamChatWithAgent } from "./openclaw.gateway.js";
import { generateReportSchema } from "./openclaw.schemas.js";
import { orchestrateReport } from "./openclaw.service.js";
import { OPENCLAW_TOOLS } from "./openclaw.tools.js";

const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(8000)
});

const chatStreamSchema = z.object({
  organizationId: z.string().min(1),
  messages: z.array(chatMessageSchema).min(1).max(20)
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
// access is enforced before proxying, and the user's context is forwarded. The
// agent's reply streams back token-by-token so the chat box renders it live.
openclawRouter.post(
  "/chat/stream",
  asyncHandler(async (req, res) => {
    const { organizationId, messages } = chatStreamSchema.parse(req.body);
    await requireOrganizationMember(req.authUser!.id, organizationId);

    // Validate reachability before committing to a streamed (headers-sent)
    // response, so this failure can still be a normal JSON error.
    if (!isGatewayConfigured()) {
      throw new AppError(503, "OpenClaw chat is not configured yet", "OPENCLAW_NOT_CONFIGURED");
    }

    res.status(200);
    // NDJSON: each line is a JSON event ({type:"delta"|"error"}) so the client
    // can distinguish a real reply chunk from a mid-stream failure — the headers
    // are already sent, so an error can no longer be a status code / JSON body.
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Cancel the upstream LLM call if the browser disconnects mid-stream.
    const controller = new AbortController();
    res.on("close", () => controller.abort());

    try {
      for await (const delta of streamChatWithAgent(
        messages,
        { organizationId, requesterId: req.authUser!.id },
        controller.signal
      )) {
        res.write(`${JSON.stringify({ type: "delta", text: delta })}\n`);
      }
    } catch (error) {
      const note = error instanceof AppError ? error.message : "Failed to generate a reply";
      res.write(`${JSON.stringify({ type: "error", message: note })}\n`);
    } finally {
      res.end();
    }
  })
);
