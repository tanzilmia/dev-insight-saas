import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";

import { errorHandler } from "./common/middleware/error-handler.js";
import { authRouter } from "./modules/auth/auth.controller.js";
import { organizationsRouter } from "./modules/organizations/organizations.controller.js";

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
  app.use(errorHandler);

  return app;
}

