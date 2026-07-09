import { z } from "zod";

export const reportTypeSchema = z.enum([
  "repository",
  "project",
  "employee",
  "team"
]);

export const periodSchema = z.enum([
  "today",
  "yesterday",
  "last_7_days",
  "last_30_days",
  "last_90_days",
  "this_month",
  "last_month",
  "custom"
]);

const isoDate = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date");

/**
 * The structured report request a dashboard (or, later, a chat channel) sends
 * to OpenClaw. OpenClaw orchestrates the tools to fulfil it.
 */
export const generateReportSchema = z
  .object({
    organizationId: z.string().min(1),
    reportType: reportTypeSchema,
    repositoryId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    employeeIds: z.array(z.string().min(1)).max(50).optional(),
    period: periodSchema.default("last_7_days"),
    customRange: z.object({ from: isoDate, to: isoDate }).optional(),
    customPrompt: z.string().trim().max(2000).optional()
  })
  .superRefine((value, ctx) => {
    if (value.period === "custom" && !value.customRange) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "customRange is required when period is 'custom'",
        path: ["customRange"]
      });
    }

    if (value.reportType === "repository" && !value.repositoryId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "repositoryId is required for a repository report",
        path: ["repositoryId"]
      });
    }

    if (value.reportType === "project" && !value.projectId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "projectId is required for a project report",
        path: ["projectId"]
      });
    }

    if (
      (value.reportType === "employee" || value.reportType === "team") &&
      !value.employeeIds?.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "employeeIds is required for an employee or team report",
        path: ["employeeIds"]
      });
    }
  });

export type ReportType = z.infer<typeof reportTypeSchema>;
export type Period = z.infer<typeof periodSchema>;
export type GenerateReportInput = z.infer<typeof generateReportSchema>;
