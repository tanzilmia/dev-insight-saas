import { Router, raw } from "express";

import { asyncHandler } from "../../common/http/async-handler.js";
import { prisma } from "../../config/database.js";
import { decryptToken } from "../../common/crypto/token-cipher.js";
import { handlePushDelivery, verifySignature } from "./webhooks.service.js";

/**
 * GitHub webhook deliveries. No JWT — authenticity comes from the per-repo
 * HMAC secret. Mounted BEFORE the global express.json() with a raw body
 * parser, because signature verification needs the exact bytes GitHub sent.
 */
export const webhooksRouter = Router();

webhooksRouter.post(
  "/github/:repositoryId",
  raw({ type: "application/json", limit: "5mb" }),
  asyncHandler(async (req, res) => {
    const idParam = req.params.repositoryId;
    const repositoryId = typeof idParam === "string" ? idParam : "";
    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
      select: { id: true, webhookSecret: true }
    });

    // Unknown target or live sync not enabled: reveal nothing beyond status.
    if (!repository) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
      return;
    }
    if (!repository.webhookSecret) {
      res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } });
      return;
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    const secret = decryptToken(repository.webhookSecret);
    if (!verifySignature(rawBody, secret, req.get("x-hub-signature-256"))) {
      res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } });
      return;
    }

    const event = req.get("x-github-event");
    if (event === "ping") {
      res.status(200).json({ ok: true });
      return;
    }
    if (event !== "push") {
      res.status(202).json({ ignored: event ?? "unknown" });
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      res.status(400).json({ error: { code: "BAD_PAYLOAD", message: "Invalid JSON" } });
      return;
    }

    // Answer fast (GitHub times deliveries out at ~10s); ingest in background.
    res.status(202).json({ accepted: true });
    void handlePushDelivery(repository.id, payload as Parameters<typeof handlePushDelivery>[1]);
  })
);
