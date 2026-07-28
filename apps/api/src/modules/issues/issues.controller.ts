import { Router } from "express";

import { asyncHandler } from "../../common/http/async-handler.js";
import { requireAuth } from "../auth/auth.middleware.js";

import {
  collectIssuesSchema,
  issueListQuerySchema,
  issueMetricsQuerySchema,
  issueParamsSchema
} from "./issues.schemas.js";
import { collectIssues, getIssueMetrics, listIssueEvents, listIssues } from "./issues.service.js";

export const issuesRouter = Router();

issuesRouter.use(requireAuth);

issuesRouter.post(
  "/collect",
  asyncHandler(async (req, res) => {
    const { repositoryId } = collectIssuesSchema.parse(req.body);
    const result = await collectIssues(req.authUser!.id, repositoryId);
    res.status(200).json({ result });
  })
);

issuesRouter.get(
  "/metrics",
  asyncHandler(async (req, res) => {
    const query = issueMetricsQuerySchema.parse(req.query);
    const metrics = await getIssueMetrics(req.authUser!.id, query);
    res.status(200).json({ metrics });
  })
);

issuesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = issueListQuerySchema.parse(req.query);
    const issues = await listIssues(req.authUser!.id, query);
    res.status(200).json({ issues });
  })
);

issuesRouter.get(
  "/:id/events",
  asyncHandler(async (req, res) => {
    const { id } = issueParamsSchema.parse(req.params);
    const organizationId = issueListQuerySchema.shape.organizationId.parse(req.query.organizationId);
    const events = await listIssueEvents(req.authUser!.id, organizationId, id);
    res.status(200).json({ events });
  })
);
