import { Router } from "express";

import { asyncHandler } from "../../common/http/async-handler.js";
import { requireAuth } from "../auth/auth.middleware.js";

import {
  codeQualityConnectionSchema,
  codeQualityOrgQuerySchema,
  codeQualityQuerySchema,
  codeQualityRepositorySchema,
  codeQualitySummaryQuerySchema,
  codeQualityTrendQuerySchema
} from "./code-quality.schemas.js";
import { getCodeQualityTrend } from "./snapshots.service.js";
import {
  deleteConnection,
  getConnection,
  listSonarProjects,
  saveConnection,
  testConnection
} from "./connection.service.js";
import { getCodeQualityOverview, getCodeQualitySummary } from "./code-quality.service.js";
import {
  deprovisionRepositoryCodeQuality,
  provisionRepositoryCodeQuality
} from "./provisioning.service.js";

export const codeQualityRouter = Router();

codeQualityRouter.use(requireAuth);

// GET /api/code-quality/overview — SonarQube measures + per-developer issues
// for an org's project.
codeQualityRouter.get(
  "/overview",
  asyncHandler(async (req, res) => {
    const query = codeQualityQuerySchema.parse(req.query);
    const overview = await getCodeQualityOverview(req.authUser!.id, query);

    res.status(200).json({ overview });
  })
);

// GET /api/code-quality/trend — snapshot series (coverage/bugs over time).
codeQualityRouter.get(
  "/trend",
  asyncHandler(async (req, res) => {
    const query = codeQualityTrendQuerySchema.parse(req.query);
    const trend = await getCodeQualityTrend(req.authUser!.id, query);

    res.status(200).json({ trend });
  })
);

// GET /api/code-quality/summary — org-wide code-health rollup (Overview card).
codeQualityRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const { organizationId, projectId } = codeQualitySummaryQuerySchema.parse(req.query);
    const summary = await getCodeQualitySummary(req.authUser!.id, organizationId, projectId);

    res.status(200).json({ summary });
  })
);

// GET /api/code-quality/connection — current SonarQube connection (no token).
codeQualityRouter.get(
  "/connection",
  asyncHandler(async (req, res) => {
    const { organizationId } = codeQualityOrgQuerySchema.parse(req.query);
    const connection = await getConnection(req.authUser!.id, organizationId);

    res.status(200).json({ connection });
  })
);

// POST /api/code-quality/connection/test — validate base URL + token (no save).
codeQualityRouter.post(
  "/connection/test",
  asyncHandler(async (req, res) => {
    const input = codeQualityConnectionSchema.parse(req.body);
    const result = await testConnection(req.authUser!.id, input);

    res.status(200).json({ result });
  })
);

// PUT /api/code-quality/connection — test then save (token encrypted at rest).
codeQualityRouter.put(
  "/connection",
  asyncHandler(async (req, res) => {
    const input = codeQualityConnectionSchema.parse(req.body);
    const connection = await saveConnection(req.authUser!.id, input);

    res.status(200).json({ connection });
  })
);

// DELETE /api/code-quality/connection — remove the connection.
codeQualityRouter.delete(
  "/connection",
  asyncHandler(async (req, res) => {
    const { organizationId } = codeQualityOrgQuerySchema.parse(req.query);
    const connection = await deleteConnection(req.authUser!.id, organizationId);

    res.status(200).json({ connection });
  })
);

// GET /api/code-quality/projects — SonarQube projects for the mapping dropdown.
codeQualityRouter.get(
  "/projects",
  asyncHandler(async (req, res) => {
    const { organizationId } = codeQualityOrgQuerySchema.parse(req.query);
    const result = await listSonarProjects(req.authUser!.id, organizationId);

    res.status(200).json(result);
  })
);

// POST /api/code-quality/provision — enable automated SonarQube scanning for a
// repo (create project + token, inject repo secrets, open the workflow-update
// PR). Manager-gated in the service.
codeQualityRouter.post(
  "/provision",
  asyncHandler(async (req, res) => {
    const { repositoryId } = codeQualityRepositorySchema.parse(req.body);
    const result = await provisionRepositoryCodeQuality(req.authUser!.id, repositoryId);

    res.status(200).json({ result });
  })
);

// DELETE /api/code-quality/provision — turn off automated scanning (clears the
// provisioning marker; the SonarQube project + results are kept).
codeQualityRouter.delete(
  "/provision",
  asyncHandler(async (req, res) => {
    const { repositoryId } = codeQualityRepositorySchema.parse(req.query);
    const result = await deprovisionRepositoryCodeQuality(req.authUser!.id, repositoryId);

    res.status(200).json({ result });
  })
);
