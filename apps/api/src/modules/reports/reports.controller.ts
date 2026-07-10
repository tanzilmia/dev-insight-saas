import { Router } from "express";

import { asyncHandler } from "../../common/http/async-handler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { listReportsQuerySchema, reportParamsSchema } from "./reports.schemas.js";
import {
  deleteReport,
  getReport,
  listReports,
  shareReport,
  unshareReport
} from "./reports.service.js";

export const reportsRouter = Router();

reportsRouter.use(requireAuth);

reportsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { organizationId, reportType, limit } = listReportsQuerySchema.parse(req.query);
    const reports = await listReports(req.authUser!.id, organizationId, {
      reportType,
      limit
    });

    res.status(200).json({ reports });
  })
);

reportsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = reportParamsSchema.parse(req.params);
    const report = await getReport(req.authUser!.id, id);

    res.status(200).json({ report });
  })
);

reportsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = reportParamsSchema.parse(req.params);
    const result = await deleteReport(req.authUser!.id, id);

    res.status(200).json(result);
  })
);

reportsRouter.post(
  "/:id/share",
  asyncHandler(async (req, res) => {
    const { id } = reportParamsSchema.parse(req.params);
    const result = await shareReport(req.authUser!.id, id);

    res.status(200).json(result);
  })
);

reportsRouter.delete(
  "/:id/share",
  asyncHandler(async (req, res) => {
    const { id } = reportParamsSchema.parse(req.params);
    const result = await unshareReport(req.authUser!.id, id);

    res.status(200).json(result);
  })
);
