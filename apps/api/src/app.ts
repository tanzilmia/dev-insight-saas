import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";

import { errorHandler } from "./common/middleware/error-handler.js";
import { activityRouter } from "./modules/activity/activity.controller.js";
import { analysisRouter } from "./modules/analysis/analysis.controller.js";
import { authRouter } from "./modules/auth/auth.controller.js";
import { channelsRouter } from "./modules/channels/channels.controller.js";
import { contributorsRouter } from "./modules/contributors/contributors.controller.js";
import { credentialsRouter } from "./modules/credentials/credentials.controller.js";
import { employeesRouter } from "./modules/employees/employees.controller.js";
import { githubAppRouter } from "./modules/github-app/github-app.controller.js";
import { githubAppWebhookRouter } from "./modules/github-app/github-app.webhook.controller.js";
import { openclawRouter } from "./modules/openclaw/openclaw.controller.js";
import { openclawServiceRouter } from "./modules/openclaw/openclaw.service-tools.controller.js";
import { organizationsRouter } from "./modules/organizations/organizations.controller.js";
import { projectsRouter } from "./modules/projects/projects.controller.js";
import { reportsRouter } from "./modules/reports/reports.controller.js";
import { publicReportsRouter } from "./modules/reports/reports.public.controller.js";
import { repositoriesRouter } from "./modules/repositories/repositories.controller.js";
import { schedulesRouter } from "./modules/schedules/schedules.controller.js";
import { statisticsRouter } from "./modules/statistics/statistics.controller.js";
import { webhooksRouter } from "./modules/webhooks/webhooks.controller.js";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  // Webhook deliveries need the RAW body for HMAC verification, so these routers
  // (with their own raw parsers) mount before the global JSON parser.
  app.use("/api/webhooks", webhooksRouter);
  app.use("/api/webhooks/github-app", githubAppWebhookRouter);
  app.use(express.json());
  app.use(pinoHttp());

  app.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      service: "devinsight-api"
    });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/organizations", organizationsRouter);
  app.use("/api/projects", projectsRouter);
  app.use("/api/employees", employeesRouter);
  app.use("/api/git-credentials", credentialsRouter);
  app.use("/api/github-app", githubAppRouter);
  app.use("/api/repositories", repositoriesRouter);
  app.use("/api/repositories", activityRouter);
  app.use("/api/contributors", contributorsRouter);
  // Service-key tool endpoints must be mounted BEFORE the JWT-guarded router so
  // OpenClaw's (non-JWT) tool calls reach them; unmatched paths fall through.
  app.use("/api/openclaw", openclawServiceRouter);
  app.use("/api/openclaw", openclawRouter);
  // Public (no-auth) shared-report view — mounted before the JWT reports router.
  app.use("/api/public/reports", publicReportsRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/statistics", statisticsRouter);
  app.use("/api/analysis", analysisRouter);
  app.use("/api/schedules", schedulesRouter);
  app.use("/api/channels", channelsRouter);
  app.use(errorHandler);

  return app;
}
