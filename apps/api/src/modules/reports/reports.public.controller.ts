import { Router } from "express";
import { z } from "zod";

import { asyncHandler } from "../../common/http/async-handler.js";
import { getPublicReport } from "./reports.service.js";

const tokenParamsSchema = z.object({ token: z.string().min(1).max(128) });

/**
 * Public, unauthenticated access to a report shared by its token. Mounted
 * OUTSIDE the JWT-guarded reports router so anyone with the link can view it.
 */
export const publicReportsRouter = Router();

publicReportsRouter.get(
  "/:token",
  asyncHandler(async (req, res) => {
    const { token } = tokenParamsSchema.parse(req.params);
    const report = await getPublicReport(token);

    res.status(200).json({ report });
  })
);
