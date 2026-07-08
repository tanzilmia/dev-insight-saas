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
