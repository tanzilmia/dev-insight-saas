import { Router } from "express";

import { asyncHandler } from "../../common/http/async-handler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  awardParamsSchema,
  awardShortlistSchema,
  awardsQuerySchema,
  digestQuerySchema,
  employeeAppraisalQuerySchema,
  employeeCommitsQuerySchema,
  leaderboardHistoryQuerySchema,
  projectAnalysisQuerySchema,
  projectBranchesQuerySchema
} from "./analysis.schemas.js";
import {
  getEmployeeCommits,
  getProjectAnalysis,
  getProjectBranches
} from "./analysis.service.js";
import { getEmployeeAppraisal } from "./appraisal.service.js";
import { getLeaderboardHistory } from "./leaderboard-snapshots.js";
import { getDailyDigest } from "./digest.service.js";
import { confirmAward, generateShortlist, listAwards } from "./awards.service.js";

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
  "/project/branches",
  asyncHandler(async (req, res) => {
    const query = projectBranchesQuerySchema.parse(req.query);
    const branches = await getProjectBranches(req.authUser!.id, query);

    res.status(200).json({ branches });
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

analysisRouter.get(
  "/appraisal",
  asyncHandler(async (req, res) => {
    const query = employeeAppraisalQuerySchema.parse(req.query);
    const appraisal = await getEmployeeAppraisal(req.authUser!.id, query);

    res.status(200).json({ appraisal });
  })
);

analysisRouter.get(
  "/leaderboard-history",
  asyncHandler(async (req, res) => {
    const query = leaderboardHistoryQuerySchema.parse(req.query);
    const snapshots = await getLeaderboardHistory(req.authUser!.id, query);

    res.status(200).json({ snapshots });
  })
);

analysisRouter.get(
  "/digest",
  asyncHandler(async (req, res) => {
    const query = digestQuerySchema.parse(req.query);
    const digest = await getDailyDigest(req.authUser!.id, query);

    res.status(200).json({ digest });
  })
);

analysisRouter.get(
  "/awards",
  asyncHandler(async (req, res) => {
    const query = awardsQuerySchema.parse(req.query);
    const awards = await listAwards(req.authUser!.id, query);

    res.status(200).json({ awards });
  })
);

analysisRouter.post(
  "/awards/shortlist",
  asyncHandler(async (req, res) => {
    const input = awardShortlistSchema.parse(req.body);
    const result = await generateShortlist(req.authUser!.id, input);

    res.status(200).json(result);
  })
);

analysisRouter.post(
  "/awards/:id/confirm",
  asyncHandler(async (req, res) => {
    const { id } = awardParamsSchema.parse(req.params);
    const award = await confirmAward(req.authUser!.id, id);

    res.status(200).json({ award });
  })
);
