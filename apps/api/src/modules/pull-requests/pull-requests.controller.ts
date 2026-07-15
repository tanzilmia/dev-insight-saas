import { Router } from "express";

import { asyncHandler } from "../../common/http/async-handler.js";
import { requireAuth } from "../auth/auth.middleware.js";

import { collectPullRequestsSchema, reviewMetricsQuerySchema } from "./pull-requests.schemas.js";
import { collectPullRequests, getReviewMetrics } from "./pull-requests.service.js";

export const pullRequestsRouter = Router();

pullRequestsRouter.use(requireAuth);

// POST /api/pull-requests/collect — fetch PRs + reviews for a repository.
pullRequestsRouter.post(
  "/collect",
  asyncHandler(async (req, res) => {
    const { repositoryId } = collectPullRequestsSchema.parse(req.body);
    const result = await collectPullRequests(req.authUser!.id, repositoryId);

    res.status(200).json({ result });
  })
);

// GET /api/pull-requests/review-metrics — per-developer collaboration metrics.
pullRequestsRouter.get(
  "/review-metrics",
  asyncHandler(async (req, res) => {
    const query = reviewMetricsQuerySchema.parse(req.query);
    const metrics = await getReviewMetrics(req.authUser!.id, query);

    res.status(200).json({ metrics });
  })
);
