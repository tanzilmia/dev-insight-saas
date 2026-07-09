import { Router } from "express";

import { asyncHandler } from "../../common/http/async-handler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { statisticsQuerySchema } from "./statistics.schemas.js";
import { getStatisticsOverview } from "./statistics.service.js";

export const statisticsRouter = Router();

statisticsRouter.use(requireAuth);

// GET /api/statistics/overview — dashboard aggregates for an org + period.
statisticsRouter.get(
  "/overview",
  asyncHandler(async (req, res) => {
    const query = statisticsQuerySchema.parse(req.query);
    const overview = await getStatisticsOverview(req.authUser!.id, query);

    res.status(200).json({ overview });
  })
);
