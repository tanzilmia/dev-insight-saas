import { Router } from "express";

import { asyncHandler } from "../../common/http/async-handler.js";
import { requireAuth } from "../auth/auth.middleware.js";

import { codeQualityQuerySchema } from "./code-quality.schemas.js";
import { getCodeQualityOverview } from "./code-quality.service.js";

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
