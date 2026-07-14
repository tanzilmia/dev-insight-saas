import { Router } from "express";

import { asyncHandler } from "../../common/http/async-handler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  disableCi,
  enableCi,
  getCiStatus,
  inspectRepository,
  listWorkflowRuns,
  mergeCi,
  syncCi
} from "./ci.service.js";
import { repositoryBodySchema, repositoryQuerySchema } from "./ci.schemas.js";

/**
 * GitHub Actions management endpoints (JWT). Reads are org-member; mutations
 * (enable/disable/sync/inspect) are manager-gated inside the service and
 * audit-logged. All GitHub access goes through the App installation token.
 */
export const ciRouter = Router();
ciRouter.use(requireAuth);

ciRouter.get(
  "/status",
  asyncHandler(async (req, res) => {
    const { repositoryId } = repositoryQuerySchema.parse(req.query);
    res.json(await getCiStatus(req.authUser!.id, repositoryId));
  })
);

ciRouter.get(
  "/inspect",
  asyncHandler(async (req, res) => {
    const { repositoryId } = repositoryQuerySchema.parse(req.query);
    res.json(await inspectRepository(req.authUser!.id, repositoryId));
  })
);

ciRouter.get(
  "/runs",
  asyncHandler(async (req, res) => {
    const { repositoryId } = repositoryQuerySchema.parse(req.query);
    res.json({ runs: await listWorkflowRuns(req.authUser!.id, repositoryId) });
  })
);

ciRouter.post(
  "/enable",
  asyncHandler(async (req, res) => {
    const { repositoryId } = repositoryBodySchema.parse(req.body);
    res.json(await enableCi(req.authUser!.id, repositoryId));
  })
);

ciRouter.post(
  "/disable",
  asyncHandler(async (req, res) => {
    const { repositoryId } = repositoryBodySchema.parse(req.body);
    res.json(await disableCi(req.authUser!.id, repositoryId));
  })
);

ciRouter.post(
  "/sync",
  asyncHandler(async (req, res) => {
    const { repositoryId } = repositoryBodySchema.parse(req.body);
    res.json(await syncCi(req.authUser!.id, repositoryId));
  })
);

ciRouter.post(
  "/merge",
  asyncHandler(async (req, res) => {
    const { repositoryId } = repositoryBodySchema.parse(req.body);
    res.json(await mergeCi(req.authUser!.id, repositoryId));
  })
);
