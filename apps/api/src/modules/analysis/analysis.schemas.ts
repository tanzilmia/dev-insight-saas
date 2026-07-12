import { z } from "zod";

import { periodSchema } from "../openclaw/openclaw.schemas.js";

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date");

/** Query for the per-employee project analysis endpoint (manager-only). */
export const projectAnalysisQuerySchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  period: periodSchema.default("last_30_days"),
  from: isoDate.optional(),
  to: isoDate.optional(),
  // Optional branch-name filter: only commits reachable from this branch
  // (via CommitBranch) count. Omitted → all branches, deduped.
  branch: z.string().trim().min(1).max(200).optional()
});

export type ProjectAnalysisQuery = z.infer<typeof projectAnalysisQuerySchema>;

/** Query for one employee's commit list (the details table). */
export const employeeCommitsQuerySchema = projectAnalysisQuerySchema.extend({
  userId: z.string().min(1)
});

export type EmployeeCommitsQuery = z.infer<typeof employeeCommitsQuerySchema>;

/** Query for the project's distinct branch names (the branch selector). */
export const projectBranchesQuerySchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1)
});

export type ProjectBranchesQuery = z.infer<typeof projectBranchesQuerySchema>;
