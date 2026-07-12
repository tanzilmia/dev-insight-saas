import { z } from "zod";

const isoDate = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date")
  .optional();

export const activityParamsSchema = z.object({
  id: z.string().min(1)
});

export const activityRangeSchema = z.object({
  since: isoDate,
  until: isoDate
});

// Deep collection lookback: 30 days .. 10 years. The UI offers 180/365/730/3650.
// verify: re-list the whole range ignoring the coverage ledger (recovers
// commits pushed after earlier collections).
export const deepCollectBodySchema = z.object({
  lookbackDays: z.coerce.number().int().min(30).max(3650).default(365),
  verify: z.boolean().default(false)
});

export const collectionJobsQuerySchema = z.object({
  organizationId: z.string().min(1)
});
