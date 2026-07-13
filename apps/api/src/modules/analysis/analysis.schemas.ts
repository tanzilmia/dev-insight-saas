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

/**
 * Query for the per-employee appraisal (manager-only). Scope defaults to the
 * whole organization; pass `projectId` to scope to one project. Window is the
 * last `months` months unless an explicit custom `from`/`to` is given.
 */
export const employeeAppraisalQuerySchema = z
  .object({
    organizationId: z.string().min(1),
    userId: z.string().min(1),
    projectId: z.string().min(1).optional(),
    months: z.coerce.number().int().min(1).max(24).default(6),
    from: isoDate.optional(),
    to: isoDate.optional()
  })
  .refine((value) => (value.from ? Boolean(value.to) : !value.to), {
    message: "Custom range needs both from and to",
    path: ["to"]
  });

export type EmployeeAppraisalQuery = z.infer<typeof employeeAppraisalQuerySchema>;

/** Query for the project's distinct branch names (the branch selector). */
export const projectBranchesQuerySchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1)
});

export type ProjectBranchesQuery = z.infer<typeof projectBranchesQuerySchema>;

/** Query for leaderboard-snapshot history (Phase 3a). `scope` = "org" or a projectId. */
export const leaderboardHistoryQuerySchema = z.object({
  organizationId: z.string().min(1),
  scope: z.string().trim().min(1).default("org"),
  granularity: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).default("MONTHLY"),
  limit: z.coerce.number().int().min(1).max(52).default(12)
});

export type LeaderboardHistoryQuery = z.infer<typeof leaderboardHistoryQuerySchema>;

/** Query for the daily digest (Phase 3b) — org-wide "yesterday in review". */
export const digestQuerySchema = z.object({
  organizationId: z.string().min(1)
});

export type DigestQuery = z.infer<typeof digestQuerySchema>;

/** Body for generating an employee-of-the-month shortlist (Phase 4b, manager). */
export const awardShortlistSchema = z.object({
  organizationId: z.string().min(1),
  // "org" or a projectId. Omitted → org-wide.
  scope: z.string().trim().min(1).default("org"),
  // "YYYY-MM". Omitted → the last completed calendar month.
  periodKey: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "periodKey must be YYYY-MM")
    .optional()
});

export type AwardShortlistInput = z.infer<typeof awardShortlistSchema>;

/** Query for listing awards (Phase 4b, member). */
export const awardsQuerySchema = z.object({
  organizationId: z.string().min(1),
  scope: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(24)
});

export type AwardsQuery = z.infer<typeof awardsQuerySchema>;

/** Path params for a single award (Phase 4b). */
export const awardParamsSchema = z.object({ id: z.string().min(1) });
