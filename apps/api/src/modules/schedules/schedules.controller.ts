import { Router } from "express";

import { asyncHandler } from "../../common/http/async-handler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  createScheduleSchema,
  scheduleListQuerySchema,
  scheduleParamsSchema,
  updateScheduleSchema
} from "./schedules.schemas.js";
import {
  createSchedule,
  deleteSchedule,
  listSchedules,
  runScheduleNow,
  updateSchedule
} from "./schedules.service.js";

export const schedulesRouter = Router();

schedulesRouter.use(requireAuth);

schedulesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { organizationId } = scheduleListQuerySchema.parse(req.query);
    const schedules = await listSchedules(req.authUser!.id, organizationId);
    res.status(200).json({ schedules });
  })
);

schedulesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = createScheduleSchema.parse(req.body);
    const schedule = await createSchedule(req.authUser!.id, input);
    res.status(201).json({ schedule });
  })
);

schedulesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = scheduleParamsSchema.parse(req.params);
    const input = updateScheduleSchema.parse(req.body);
    const schedule = await updateSchedule(req.authUser!.id, id, input);
    res.status(200).json({ schedule });
  })
);

schedulesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = scheduleParamsSchema.parse(req.params);
    const result = await deleteSchedule(req.authUser!.id, id);
    res.status(200).json(result);
  })
);

schedulesRouter.post(
  "/:id/run",
  asyncHandler(async (req, res) => {
    const { id } = scheduleParamsSchema.parse(req.params);
    const result = await runScheduleNow(req.authUser!.id, id);
    res.status(200).json(result);
  })
);
