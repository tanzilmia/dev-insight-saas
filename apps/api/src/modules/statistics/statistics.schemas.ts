import { z } from "zod";

import { periodSchema } from "../openclaw/openclaw.schemas.js";

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date");

/** Query for the statistics overview endpoint (dashboard). */
export const statisticsQuerySchema = z.object({
  organizationId: z.string().min(1),
  period: periodSchema.default("last_30_days"),
  from: isoDate.optional(),
  to: isoDate.optional()
});

export type StatisticsQuery = z.infer<typeof statisticsQuerySchema>;
