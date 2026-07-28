import { z } from "zod";

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date");

export const collectIssuesSchema = z.object({
  repositoryId: z.string().min(1)
});

const issueQueryBaseSchema = z.object({
  organizationId: z.string().min(1),
  repositoryId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  state: z.enum(["open", "closed"]).optional(),
  assignee: z.string().trim().min(1).max(100).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

const hasCompleteDateRange = (value: { from?: string; to?: string }) =>
  value.from ? Boolean(value.to) : !value.to;

const dateRangeError = {
  message: "A date range needs both from and to",
  path: ["to"]
};

export const issueListQuerySchema = issueQueryBaseSchema.refine(
  hasCompleteDateRange,
  dateRangeError
);

export const issueMetricsQuerySchema = issueQueryBaseSchema
  .omit({ limit: true })
  .refine(hasCompleteDateRange, dateRangeError);

export const issueParamsSchema = z.object({ id: z.string().min(1) });

export type IssueListQuery = z.infer<typeof issueListQuerySchema>;
export type IssueMetricsQuery = z.infer<typeof issueMetricsQuerySchema>;
