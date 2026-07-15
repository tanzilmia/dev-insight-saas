import { z } from "zod";

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date");

/** Body to collect pull requests + reviews for one repository. */
export const collectPullRequestsSchema = z.object({
  repositoryId: z.string().min(1)
});

/** Query for per-employee collaboration/review metrics. */
export const reviewMetricsQuerySchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  from: isoDate.optional(),
  to: isoDate.optional()
});

export type ReviewMetricsQuery = z.infer<typeof reviewMetricsQuerySchema>;
