import { z } from "zod";

import { reportTypeSchema } from "../openclaw/openclaw.schemas.js";

export const scheduleCadenceSchema = z.enum(["DAILY", "WEEKLY", "MONTHLY"]);

// A recurring report uses a relative window (no fixed custom range).
export const schedulePeriodSchema = z.enum([
  "today",
  "yesterday",
  "last_7_days",
  "last_30_days",
  "last_90_days",
  "this_month",
  "last_month"
]);

function refineTarget(
  value: { reportType: string; repositoryId?: string; projectId?: string; employeeIds?: string[] },
  ctx: z.RefinementCtx
) {
  if (value.reportType === "repository" && !value.repositoryId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "repositoryId is required", path: ["repositoryId"] });
  }
  if (value.reportType === "project" && !value.projectId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "projectId is required", path: ["projectId"] });
  }
  if (
    (value.reportType === "employee" || value.reportType === "team") &&
    !value.employeeIds?.length
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "employeeIds is required", path: ["employeeIds"] });
  }
}

export const createScheduleSchema = z
  .object({
    organizationId: z.string().min(1),
    name: z.string().trim().min(1).max(120),
    reportType: reportTypeSchema,
    repositoryId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    employeeIds: z.array(z.string().min(1)).max(50).optional(),
    period: schedulePeriodSchema.default("last_7_days"),
    cadence: scheduleCadenceSchema,
    customPrompt: z.string().trim().max(2000).optional()
  })
  .superRefine(refineTarget);

export const updateScheduleSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  period: schedulePeriodSchema.optional(),
  cadence: scheduleCadenceSchema.optional(),
  customPrompt: z.string().trim().max(2000).nullable().optional(),
  enabled: z.boolean().optional()
});

export const scheduleParamsSchema = z.object({ id: z.string().min(1) });
export const scheduleListQuerySchema = z.object({ organizationId: z.string().min(1) });

export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;
export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;
