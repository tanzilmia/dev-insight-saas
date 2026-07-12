import { Router } from "express";

import { asyncHandler } from "../../common/http/async-handler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  activityParamsSchema,
  activityRangeSchema,
  collectionJobsQuerySchema,
  deepCollectBodySchema
} from "./activity.schemas.js";
import {
  collectActivity,
  getActivitySummary,
  getRepositoryBranches
} from "./activity.service.js";
import {
  cancelDeepCollection,
  listCollectionJobs,
  startDeepCollection
} from "./deep-collection.js";

export const activityRouter = Router();

activityRouter.use(requireAuth);

// Literal path registered before the /:id/... routes. The UI polls this to
// drive progress bars and to resume display after a page reload.
activityRouter.get(
  "/collection-jobs",
  asyncHandler(async (req, res) => {
    const { organizationId } = collectionJobsQuerySchema.parse(req.query);
    const jobs = await listCollectionJobs(req.authUser!.id, organizationId);

    res.status(200).json({ jobs });
  })
);

activityRouter.post(
  "/:id/deep-collect",
  asyncHandler(async (req, res) => {
    const { id } = activityParamsSchema.parse(req.params);
    const input = deepCollectBodySchema.parse(req.body ?? {});
    const job = await startDeepCollection(req.authUser!.id, id, input);

    res.status(202).json({ job });
  })
);

activityRouter.post(
  "/:id/deep-collect/cancel",
  asyncHandler(async (req, res) => {
    const { id } = activityParamsSchema.parse(req.params);
    const job = await cancelDeepCollection(req.authUser!.id, id);

    res.status(200).json({ job });
  })
);

activityRouter.post(
  "/:id/activity",
  asyncHandler(async (req, res) => {
    const { id } = activityParamsSchema.parse(req.params);
    const range = activityRangeSchema.parse(req.body);
    const result = await collectActivity(req.authUser!.id, id, range);

    res.status(200).json({ activity: result });
  })
);

activityRouter.get(
  "/:id/activity",
  asyncHandler(async (req, res) => {
    const { id } = activityParamsSchema.parse(req.params);
    const range = activityRangeSchema.parse(req.query);
    const summary = await getActivitySummary(req.authUser!.id, id, range);

    res.status(200).json({ activity: summary });
  })
);

activityRouter.get(
  "/:id/branches",
  asyncHandler(async (req, res) => {
    const { id } = activityParamsSchema.parse(req.params);
    const branches = await getRepositoryBranches(req.authUser!.id, id);

    res.status(200).json({ branches });
  })
);
