import { Router } from "express";

import { asyncHandler } from "../../common/http/async-handler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { activityParamsSchema, activityRangeSchema } from "./activity.schemas.js";
import {
  collectActivity,
  getActivitySummary,
  getRepositoryBranches
} from "./activity.service.js";

export const activityRouter = Router();

activityRouter.use(requireAuth);

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
