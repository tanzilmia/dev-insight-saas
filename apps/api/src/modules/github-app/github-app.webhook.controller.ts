import { Router, raw } from "express";

import { asyncHandler } from "../../common/http/async-handler.js";
import { isGitHubAppWebhookConfigured, verifyWebhookSignature } from "./github-app.auth.js";
import {
  handleInstallationEvent,
  handleInstallationRepositoriesEvent,
  type WebhookInstallationPayload
} from "./github-app.service.js";
import {
  handleGitHubAppPushEvent,
  type GitHubAppPushPayload
} from "./github-app-push.service.js";
import {
  handleGitHubAppIssuesEvent,
  type GitHubIssueWebhookPayload
} from "../issues/issues.service.js";
import {
  handleGitHubAppWorkflowRunEvent,
  type GitHubWorkflowRunPayload
} from "./github-app-workflow.service.js";

/**
 * GitHub App webhook receiver. ONE endpoint for every installation (configured
 * on the App). No JWT — authenticity is the App-level HMAC secret. Mounted
 * BEFORE the global express.json() with a raw parser, because signature
 * verification needs the exact bytes GitHub sent.
 */
export const githubAppWebhookRouter = Router();

githubAppWebhookRouter.post(
  "/",
  raw({ type: "application/json", limit: "5mb" }),
  asyncHandler(async (req, res) => {
    if (!isGitHubAppWebhookConfigured()) {
      res
        .status(503)
        .json({ error: { code: "GITHUB_APP_NOT_CONFIGURED", message: "Not configured" } });
      return;
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    if (!verifyWebhookSignature(rawBody, req.get("x-hub-signature-256"))) {
      res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } });
      return;
    }

    const event = req.get("x-github-event");
    if (event === "ping") {
      res.status(200).json({ ok: true });
      return;
    }

    let payload: WebhookInstallationPayload &
      GitHubAppPushPayload &
      GitHubWorkflowRunPayload &
      GitHubIssueWebhookPayload;
    try {
      payload = JSON.parse(rawBody.toString("utf8")) as WebhookInstallationPayload &
        GitHubAppPushPayload;
    } catch {
      res.status(400).json({ error: { code: "BAD_PAYLOAD", message: "Invalid JSON" } });
      return;
    }

    // Answer fast (GitHub times deliveries out at ~10s); process in background.
    res.status(202).json({ accepted: true });
    let task: Promise<void> | undefined;
    if (event === "installation") {
      task = handleInstallationEvent(payload);
    } else if (event === "installation_repositories") {
      task = handleInstallationRepositoriesEvent(payload);
    } else if (event === "push") {
      task = handleGitHubAppPushEvent(payload);
    } else if (event === "workflow_run") {
      task = handleGitHubAppWorkflowRunEvent(payload);
    } else if (event === "issues") {
      task = handleGitHubAppIssuesEvent(payload, req.get("x-github-delivery") ?? undefined);
    }
    void task?.catch((error) => {
      console.warn(`[github-app] ${event ?? "unknown"} webhook processing failed`, error);
    });
  })
);
