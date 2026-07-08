import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";

import { errorHandler } from "./common/middleware/error-handler.js";
import { activityRouter } from "./modules/activity/activity.controller.js";
import { authRouter } from "./modules/auth/auth.controller.js";
import { contributorsRouter } from "./modules/contributors/contributors.controller.js";
import { credentialsRouter } from "./modules/credentials/credentials.controller.js";
import { employeesRouter } from "./modules/employees/employees.controller.js";
import { openclawRouter } from "./modules/openclaw/openclaw.controller.js";
import { organizationsRouter } from "./modules/organizations/organizations.controller.js";
import { projectsRouter } from "./modules/projects/projects.controller.js";
import { repositoriesRouter } from "./modules/repositories/repositories.controller.js";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
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
  app.use("/api/repositories", repositoriesRouter);
  app.use("/api/repositories", activityRouter);
  app.use("/api/contributors", contributorsRouter);
  app.use("/api/openclaw", openclawRouter);
  app.use(errorHandler);

  return app;
}

