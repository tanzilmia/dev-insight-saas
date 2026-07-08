import { prisma } from "../../config/database.js";
import { AppError } from "../../common/errors/app-error.js";
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
    description: "Fetch normalized commit activity for the target + period",
    status: "pending",
    pendingPhase: "Phase 8 (Git Activity Collection)"
  },
  {
    name: "generate_report",
    description: "Build the Markdown report from activity via the LLM",
    status: "pending",
    pendingPhase: "Phase 10 (LLM Integration)"
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

/**
 * fetch_git_activity — SCAFFOLD. Real commit collection lands in Phase 8.
 * Returns zeroed stats flagged `pending` so the orchestration is observable.
 */
export async function fetchGitActivity(): Promise<GitActivity> {
  return { commits: 0, additions: 0, deletions: 0, filesChanged: 0, pending: true };
}

type ReportContext = {
  reportType: ReportType;
  range: DateRange;
  project?: { id: string; name: string };
  repository?: { id: string; fullName: string };
  employees: ResolvedEmployee[];
  activity: GitActivity;
  customPrompt?: string;
};

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

/**
 * generate_report — SCAFFOLD. The real Markdown is produced by the LLM in
 * Phase 10. For now this assembles a deterministic placeholder from the
 * resolved context so the end-to-end flow is verifiable.
 */
export function buildReportMarkdown(context: ReportContext): { title: string; markdown: string } {
  const target =
    context.repository?.fullName ??
    context.project?.name ??
    (context.employees.length === 1
      ? context.employees[0]!.name
      : `${context.employees.length} employees`);

  const title = `${context.reportType} report — ${target}`;
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
    "> ⚙️ Scaffold report. Git activity collection (Phase 8) and AI narrative (Phase 10) are not wired yet — this confirms the OpenClaw orchestration path end to end."
  ].filter((line): line is string => line !== null);

  return { title, markdown: lines.join("\n") };
}
