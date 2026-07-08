import { prisma } from "../../config/database.js";
import { AppError } from "../../common/errors/app-error.js";
import { aggregateActivity } from "../activity/activity.service.js";
import type { ChatMessage } from "../llm/llm-provider.js";
import type { Period, ReportType } from "./openclaw.schemas.js";

/**
 * Contracts for the tools OpenClaw orchestrates. `ready` tools work today;
 * `pending` tools are scaffolded and completed in the noted phase.
 */
export const OPENCLAW_TOOLS = [
  { name: "resolve_project", description: "Resolve a project by id within an org", status: "ready" },
  { name: "resolve_repository", description: "Resolve a tracked repository by id", status: "ready" },
  { name: "resolve_employee", description: "Resolve employees by id within an org", status: "ready" },
  { name: "resolve_period", description: "Resolve a reporting period to a date range", status: "ready" },
  {
    name: "fetch_git_activity",
    description: "Aggregate stored commit activity for the target + period",
    status: "ready"
  },
  {
    name: "generate_report",
    description: "Build the Markdown report from activity via the LLM",
    status: "ready"
  },
  {
    name: "save_report",
    description: "Persist the generated report and statistics",
    status: "pending",
    pendingPhase: "Phase 11 (Report Persistence)"
  },
  {
    name: "share_report",
    description: "Share a report to a team channel",
    status: "pending",
    pendingPhase: "Phase 14 (Sharing)"
  }
] as const;

export type DateRange = { from: Date; to: Date };

export type ResolvedEmployee = {
  id: string;
  name: string;
  email: string;
  mappedIdentities: number;
};

export type GitActivity = {
  commits: number;
  additions: number;
  deletions: number;
  filesChanged: number;
  /** True while commit collection (Phase 8) is not yet wired. */
  pending: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** resolve_period — turns a period keyword (or custom range) into dates. */
export function resolvePeriod(
  period: Period,
  customRange?: { from: string; to: string }
): DateRange {
  const now = new Date();

  if (period === "custom") {
    if (!customRange) {
      throw new AppError(400, "Custom range is required", "PERIOD_RANGE_MISSING");
    }
    return { from: new Date(customRange.from), to: new Date(customRange.to) };
  }

  if (period === "today") {
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    return { from, to: now };
  }

  const days = period === "last_30_days" ? 30 : 7;
  return { from: new Date(now.getTime() - days * DAY_MS), to: now };
}

/** resolve_project — loads a project scoped to the organization. */
export async function resolveProject(organizationId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId }
  });

  if (!project) {
    throw new AppError(404, "Project was not found in this organization", "PROJECT_NOT_FOUND");
  }

  return { id: project.id, name: project.name };
}

/** resolve_repository — loads a tracked repository scoped to the organization. */
export async function resolveRepository(organizationId: string, repositoryId: string) {
  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId }
  });

  if (!repository) {
    throw new AppError(404, "Repository was not found in this organization", "REPOSITORY_NOT_FOUND");
  }

  return {
    id: repository.id,
    fullName: repository.fullName,
    owner: repository.owner,
    name: repository.name
  };
}

/** resolve_employee — validates employee ids and returns them with mapping counts. */
export async function resolveEmployees(
  organizationId: string,
  employeeIds: string[]
): Promise<ResolvedEmployee[]> {
  const memberships = await prisma.organizationMember.findMany({
    where: { organizationId, userId: { in: employeeIds }, status: "ACTIVE" },
    include: { user: true }
  });

  if (memberships.length !== employeeIds.length) {
    const found = new Set(memberships.map((membership) => membership.userId));
    const missing = employeeIds.filter((id) => !found.has(id));
    throw new AppError(
      400,
      `Some employees are not active members of this organization: ${missing.join(", ")}`,
      "EMPLOYEE_NOT_IN_ORGANIZATION"
    );
  }

  const mappingCounts = await prisma.employeeGitMapping.groupBy({
    by: ["userId"],
    where: { organizationId, userId: { in: employeeIds } },
    _count: { _all: true }
  });
  const countByUser = new Map(
    mappingCounts.map((row) => [row.userId, row._count._all])
  );

  return memberships.map((membership) => ({
    id: membership.user.id,
    name: membership.user.name,
    email: membership.user.email,
    mappedIdentities: countByUser.get(membership.user.id) ?? 0
  }));
}

/** Resolves the Git usernames mapped to a set of employees (for filtering). */
export async function resolveEmployeeUsernames(
  organizationId: string,
  employeeIds: string[]
): Promise<string[]> {
  const mappings = await prisma.employeeGitMapping.findMany({
    where: { organizationId, userId: { in: employeeIds } },
    include: { contributorIdentity: { select: { username: true } } }
  });

  return [
    ...new Set(
      mappings
        .map((mapping) => mapping.contributorIdentity.username)
        .filter((username): username is string => Boolean(username))
    )
  ];
}

/**
 * fetch_git_activity — aggregates stored commit activity for the target and
 * period. Real as of Phase 8 (commit collection).
 */
export async function fetchGitActivity(input: {
  organizationId: string;
  repositoryId?: string;
  projectId?: string;
  usernames?: string[];
  since: Date;
  until: Date;
}): Promise<GitActivity> {
  const stats = await aggregateActivity(input);
  return { ...stats, pending: false };
}

export type ReportCommit = {
  sha: string;
  message: string;
  author: string | null;
  additions: number;
  deletions: number;
};

export type ReportContext = {
  reportType: ReportType;
  range: DateRange;
  project?: { id: string; name: string };
  repository?: { id: string; fullName: string };
  employees: ResolvedEmployee[];
  activity: GitActivity;
  sampleCommits: ReportCommit[];
  customPrompt?: string;
};

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function deriveTarget(context: ReportContext): string {
  return (
    context.repository?.fullName ??
    context.project?.name ??
    (context.employees.length === 1
      ? context.employees[0]!.name
      : `${context.employees.length} employees`)
  );
}

/** Deterministic title used in the report header regardless of generator. */
export function deriveTitle(context: ReportContext): string {
  return `${context.reportType} report — ${deriveTarget(context)}`;
}

/**
 * Builds the LLM prompt from the resolved report context and real commit
 * activity. The provider (OpenAI) turns this into the Markdown narrative.
 */
export function buildReportPrompt(context: ReportContext): ChatMessage[] {
  const period = `${formatDate(context.range.from)} to ${formatDate(context.range.to)}`;
  const commitLines =
    context.sampleCommits
      .map(
        (commit) =>
          `- ${commit.message} (${commit.author ?? "unknown"}, +${commit.additions}/-${commit.deletions})`
      )
      .join("\n") || "(no commits in this period)";

  const system =
    "You are DevInsight, an assistant that writes concise, factual developer work reports for engineering managers from Git commit activity. Write in Markdown. Be specific and reference actual commit themes. Never invent data. If there are no commits, say so plainly.";

  const user = [
    `Report type: ${context.reportType}`,
    `Target: ${deriveTarget(context)}`,
    `Period: ${period}`,
    `Totals: ${context.activity.commits} commits, +${context.activity.additions}/-${context.activity.deletions} lines, ${context.activity.filesChanged} files.`,
    context.employees.length
      ? `Employees: ${context.employees.map((employee) => employee.name).join(", ")}`
      : null,
    context.customPrompt ? `Extra instructions: ${context.customPrompt}` : null,
    "",
    "Recent commits:",
    commitLines,
    "",
    "Write the report in Markdown: a short title (H1), a 2-3 sentence summary, a bulleted list of key themes/work done grounded in the commits above, and a one-line note on volume. Keep it under 250 words."
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}

/**
 * generate_report fallback — a deterministic template used when no LLM is
 * configured. Produces the same title as {@link deriveTitle}.
 */
export function buildReportMarkdown(context: ReportContext): { title: string; markdown: string } {
  const title = deriveTitle(context);
  const period = `${formatDate(context.range.from)} → ${formatDate(context.range.to)}`;

  const lines = [
    `# ${title}`,
    "",
    `**Period:** ${period}`,
    context.repository ? `**Repository:** ${context.repository.fullName}` : null,
    context.project ? `**Project:** ${context.project.name}` : null,
    context.employees.length
      ? `**Employees:** ${context.employees
          .map((employee) => `${employee.name} (${employee.mappedIdentities} mapped)`)
          .join(", ")}`
      : null,
    context.customPrompt ? `**Prompt:** ${context.customPrompt}` : null,
    "",
    "## Activity",
    `Commits: ${context.activity.commits} · +${context.activity.additions} / -${context.activity.deletions} · ${context.activity.filesChanged} files`,
    "",
    "## Summary",
    context.activity.commits > 0
      ? `Based on ${context.activity.commits} commit(s) in this period. The AI narrative (Phase 10) will summarize this activity.`
      : "No commit activity found for this target and period. Collect commits on the Repositories page, then regenerate."
  ].filter((line): line is string => line !== null);

  return { title, markdown: lines.join("\n") };
}
