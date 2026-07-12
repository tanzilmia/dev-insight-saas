import { Router } from "express";

import { asyncHandler } from "../../common/http/async-handler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { employeeCommitsQuerySchema, projectAnalysisQuerySchema } from "./analysis.schemas.js";
import { getEmployeeCommits, getProjectAnalysis } from "./analysis.service.js";

export const analysisRouter = Router();

analysisRouter.use(requireAuth);

analysisRouter.get(
  "/project",
  asyncHandler(async (req, res) => {
    const query = projectAnalysisQuerySchema.parse(req.query);
    const analysis = await getProjectAnalysis(req.authUser!.id, query);

    res.status(200).json({ analysis });
  })
);

analysisRouter.get(
  "/project/commits",
  asyncHandler(async (req, res) => {
    const query = employeeCommitsQuerySchema.parse(req.query);
    const commits = await getEmployeeCommits(req.authUser!.id, query);

    res.status(200).json({ commits });
  })
);
