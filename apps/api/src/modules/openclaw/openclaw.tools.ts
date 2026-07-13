import { prisma } from "../../config/database.js";
import { AppError } from "../../common/errors/app-error.js";
import {
  aggregateActivity,
  type ActivityAnalysis,
  type EmployeeLeaderboardRow
} from "../activity/activity.service.js";
import type {
  MetricDelta,
  RankMovement,
  ReportComparison
} from "../report-engine/comparison.js";
import type { Insight } from "../report-engine/insights.js";
import {
  activityLevel,
  buildPlainSummary,
  humanizeAreas,
  humanizeWorkMix
} from "../report-engine/plain-language.js";
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
    status: "ready"
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
  /** Latest commit instant + sha in scope — used only to fingerprint the data
   *  for the report cache (so an amend or reordering busts a stale report). */
  lastCommitAt: Date | null;
  lastSha: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses a custom-range boundary. A bare `YYYY-MM-DD` (what the date picker
 * sends) is read as a whole *local* calendar day — `from` at local midnight,
 * `to` at the last millisecond — so the end date is inclusive. Otherwise every
 * commit authored on the final day is dropped, because `new Date("YYYY-MM-DD")`
 * parses as UTC midnight, i.e. the *start* of that day. Full datetime strings
 * (which already carry a time) pass through unchanged.
 */
function parseRangeBoundary(value: string, edge: "start" | "end"): Date {
  if (DATE_ONLY.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return edge === "start"
      ? new Date(year, month - 1, day, 0, 0, 0, 0)
      : new Date(year, month - 1, day, 23, 59, 59, 999);
  }
  return new Date(value);
}

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
    const from = parseRangeBoundary(customRange.from, "start");
    const to = parseRangeBoundary(customRange.to, "end");
    if (from > to) {
      throw new AppError(400, "Custom range 'from' must be on or before 'to'", "PERIOD_RANGE_INVALID");
    }
    return { from, to };
  }

  if (period === "today") {
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    return { from, to: now };
  }

  if (period === "yesterday") {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // `to` is the last millisecond of yesterday.
    return { from, to: new Date(todayStart.getTime() - 1) };
  }

  if (period === "this_month") {
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
  }

  if (period === "last_month") {
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    // `to` is the last millisecond of the previous month.
    return { from: lastMonthStart, to: new Date(thisMonthStart.getTime() - 1) };
  }

  const days = period === "last_90_days" ? 90 : period === "last_30_days" ? 30 : 7;
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
  branch?: string;
  since: Date;
  until: Date;
}): Promise<GitActivity> {
  return aggregateActivity(input);
}

export type ReportCommit = {
  sha: string;
  message: string;
  author: string | null;
  additions: number;
  deletions: number;
};

/** Per-employee focus signals (top categories/modules), keyed by employeeId. */
export type EmployeeSignalMap = Map<string, { topCategories: string[]; topModules: string[] }>;

export type ReportContext = {
  reportType: ReportType;
  range: DateRange;
  project?: { id: string; name: string };
  repository?: { id: string; fullName: string };
  employees: ResolvedEmployee[];
  /** Optional branch filter — reflected in the report title when set. */
  branch?: string;
  activity: GitActivity;
  sampleCommits: ReportCommit[];
  analysis?: ActivityAnalysis;
  leaderboard?: EmployeeLeaderboardRow[];
  /** Period-over-period trend (Report advance A). */
  comparison?: ReportComparison;
  /** Auto-surfaced key insights (Report advance B). */
  insights?: Insight[];
  /** Optional — lets "Who did what" say what each person focused on. */
  employeeSignals?: EmployeeSignalMap;
  customPrompt?: string;
};

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function deriveTarget(context: ReportContext): string {
  const base =
    context.repository?.fullName ??
    context.project?.name ??
    (context.employees.length === 1
      ? context.employees[0]!.name
      : context.employees.length === 0
        ? "Entire team"
        : `${context.employees.length} employees`);
  return context.branch ? `${base} (${context.branch})` : base;
}

/** Deterministic title used in the report header regardless of generator. */
export function deriveTitle(context: ReportContext): string {
  return `${context.reportType} report — ${deriveTarget(context)}`;
}

function pctSuffix(delta: MetricDelta): string {
  return delta.deltaPct === null ? "" : ` (${delta.deltaPct > 0 ? "+" : ""}${delta.deltaPct}%)`;
}

/** Short human label for a leaderboard rank movement. */
function moverLabel(move: RankMovement): string {
  if (move.status === "new") return `${move.name} (new)`;
  if (move.status === "dropped") return `${move.name} (dropped off)`;
  const arrow = move.status === "up" ? "↑" : move.status === "down" ? "↓" : "→";
  return `${move.name} ${arrow}${Math.abs(move.delta ?? 0)}`;
}

/** Prompt/template lines describing the trend vs the previous period. */
function comparisonPromptLines(comparison?: ReportComparison): string | null {
  if (!comparison || !comparison.hasBaseline) {
    return null;
  }
  const c = comparison;
  return [
    "",
    `Compared to the previous period (${c.previousPeriod.from.slice(0, 10)} to ${c.previousPeriod.to.slice(0, 10)}):`,
    `- Commits: ${c.commits.current} vs ${c.commits.previous}${pctSuffix(c.commits)}`,
    `- Lines: +${c.additions.current}/-${c.deletions.current} vs +${c.additions.previous}/-${c.deletions.previous}`,
    `- Contributors: ${c.contributors.current} vs ${c.contributors.previous}`,
    ...(c.movers.length ? [`- Rank movement: ${c.movers.map(moverLabel).join("; ")}`] : [])
  ].join("\n");
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

  const analysis = context.analysis;
  const categoryLine =
    analysis && Object.keys(analysis.categories).length
      ? `Work breakdown: ${Object.entries(analysis.categories)
          .map(([category, count]) => `${count} ${category}`)
          .join(", ")}.`
      : null;
  const modulesLine =
    analysis && analysis.topModules.length
      ? `Most-changed areas: ${analysis.topModules.map((item) => item.module).join(", ")}.`
      : null;
  const risksLine =
    analysis && analysis.risks.length ? `Risk signals: ${analysis.risks.join("; ")}.` : null;

  const insightsLines = context.insights?.length
    ? [
        "",
        "Detected key insights (weave the important ones into a '## Key insights' section):",
        ...context.insights.map((insight) => `- [${insight.severity}] ${insight.text}`)
      ].join("\n")
    : null;

  const comparisonLines = comparisonPromptLines(context.comparison);

  const leaderboard = context.leaderboard ?? [];
  const leaderboardLines = leaderboard.length
    ? [
        "",
        "Contributor activity (most involved first — ranked by real work, i.e. lines excluding dependency/generated files; a signal of involvement, not a performance rating):",
        ...leaderboard.map((row) => {
          const signal = row.employeeId
            ? context.employeeSignals?.get(row.employeeId)
            : undefined;
          const focusLine = signal
            ? `\n   focus: ${[
                signal.topCategories.length ? signal.topCategories.join(", ") : null,
                signal.topModules.length ? `areas: ${signal.topModules.join(", ")}` : null
              ]
                .filter(Boolean)
                .join(" · ")}`
            : "";
          return (
            `${row.rank}. ${row.name}${row.mapped ? "" : " (unmapped)"} — ${row.commits} update(s), ~${row.effectiveLines} lines of real work` +
            (row.sampleMessages.length
              ? `\n   worked on: ${row.sampleMessages.join("; ")}`
              : "") +
            focusLine
          );
        })
      ].join("\n")
    : null;

  // Plain-language facts for the executive '## Summary' — the same wording a
  // non-technical reader (manager/PM/exec) sees, so the LLM writes in their
  // language rather than in developer metrics.
  const days = Math.max(
    1,
    Math.round((context.range.to.getTime() - context.range.from.getTime()) / DAY_MS)
  );
  const level = activityLevel(context.activity.commits, days);
  const workMix = humanizeWorkMix(analysis?.categories ?? {});
  const areas = humanizeAreas(analysis?.topModules ?? []);
  const topContributor = leaderboard[0]?.name ?? null;
  const attentionCount = context.insights?.filter((i) => i.severity === "warn").length ?? 0;
  const plainFactsLines = [
    "",
    "Plain-language facts for the '## Summary' section — write these for a non-technical reader (use words like 'updates', 'changes', 'bug fixes', 'new features'; do NOT use 'commit', 'lines of code', 'refactor', 'repository', 'branch', or SHAs):",
    `- Activity level: ${level.label} — ${context.activity.commits} update(s) over ${days} day(s), ${leaderboard.length} contributor(s).`,
    workMix.text ? `- Type of work: ${workMix.text}.` : null,
    areas.length ? `- Main areas worked on: ${areas.join(", ")}.` : null,
    topContributor ? `- Most active person: ${topContributor}.` : null,
    attentionCount > 0 ? `- ${attentionCount} item(s) may need attention (see the insights below).` : null
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const system =
    "You are DevInsight, an assistant that writes clear developer work reports for managers and non-technical stakeholders, based on real Git activity. Explain the work in plain business language, not developer jargon. Write in Markdown. Be specific and factual, reference the actual themes of the work, and never invent data. If there is no activity, say so plainly.";

  const instruction = [
    "Write the report in Markdown for a non-technical reader (a manager or executive). Structure it exactly like this:",
    "1. A short title (H1).",
    "2. A section titled exactly '## Summary' — 3-4 plain sentences built from the plain-language facts above. Say what the team worked on, who was most active, how activity compares with the period before, and anything that needs attention. Avoid developer jargon (no 'commit', 'lines of code', 'refactor', 'repository', 'branch', 'diff', or SHAs).",
    "3. If key insights are provided, a section titled exactly '## Key insights' — 3-5 short bullets on the most important signals (trend, risks, concentration, roster changes), each grounded in the data provided.",
    "4. THE MOST IMPORTANT SECTION — a section titled exactly '## What shipped'. Read the update messages listed below and GROUP them into 3-6 concrete pieces of work or initiatives (for example 'Payment webhook retries', 'Refund flow', 'Login redesign', 'Telegram report delivery'). For each initiative write a short **bold plain-language title**, then one sentence on what it delivered and roughly how much work it was (e.g. 'about a dozen updates by 2 people'). Base every item ONLY on the actual update messages — never invent a feature or a name. Merge related updates into one initiative rather than listing them separately. If the work is genuinely too scattered to group, briefly describe the main areas of activity instead.",
    "5. If a contributor leaderboard is provided, a section titled exactly '## Who did what' listing each person most-active first, one plain line each on what they worked on. Present this as involvement/activity, NOT a performance rating.",
    "6. If a previous-period comparison is provided, a section titled exactly '## Trend vs previous period' with the key changes.",
    "Never invent people or work. Keep it under 600 words."
  ].join("\n");

  const user = [
    `Report type: ${context.reportType}`,
    `Target: ${deriveTarget(context)}`,
    `Period: ${period}`,
    `Totals: ${context.activity.commits} commits, +${context.activity.additions}/-${context.activity.deletions} lines, ${context.activity.filesChanged} files.`,
    categoryLine,
    modulesLine,
    risksLine,
    plainFactsLines,
    context.employees.length
      ? `Employees: ${context.employees.map((employee) => employee.name).join(", ")}`
      : null,
    context.customPrompt ? `Extra instructions: ${context.customPrompt}` : null,
    comparisonLines,
    insightsLines,
    leaderboardLines,
    "",
    "Update messages (source material — read these and cluster them into the '## What shipped' initiatives):",
    commitLines,
    "",
    instruction
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
  const leaderboard = context.leaderboard ?? [];

  const days = Math.max(
    1,
    Math.round((context.range.to.getTime() - context.range.from.getTime()) / DAY_MS)
  );
  const level = activityLevel(context.activity.commits, days);
  const workMix = humanizeWorkMix(context.analysis?.categories ?? {});
  const areas = humanizeAreas(context.analysis?.topModules ?? []);
  const commitsDeltaPct = context.comparison?.hasBaseline
    ? context.comparison.commits.deltaPct
    : null;
  const attentionCount = context.insights?.filter((i) => i.severity === "warn").length ?? 0;
  const summary = buildPlainSummary({
    commits: context.activity.commits,
    days,
    contributors: leaderboard.length,
    workMixText: workMix.text,
    topAreas: areas,
    topContributor: leaderboard[0]?.name ?? null,
    commitsDeltaPct,
    attentionCount
  });

  const lines = [
    `# ${title}`,
    "",
    `**Period:** ${period}`,
    context.repository ? `**Repository:** ${context.repository.fullName}` : null,
    context.project ? `**Project:** ${context.project.name}` : null,
    context.employees.length
      ? `**People:** ${context.employees
          .map((employee) => `${employee.name} (${employee.mappedIdentities} mapped)`)
          .join(", ")}`
      : null,
    context.customPrompt ? `**Prompt:** ${context.customPrompt}` : null,
    "",
    "## Summary",
    summary,
    ...(context.insights?.length
      ? [
          "",
          "## Key insights",
          ...context.insights.map(
            (insight) => `- ${insight.severity === "warn" ? "⚠️ " : ""}${insight.text}`
          )
        ]
      : []),
    "",
    "## Activity",
    `**Activity level:** ${level.label} — ${context.activity.commits} update(s) over ${days} day(s).`,
    workMix.text ? `**Type of work:** ${workMix.text}.` : null,
    areas.length ? `**Main areas:** ${areas.join(", ")}.` : null,
    `Detailed totals: ${context.activity.commits} commits · +${context.activity.additions} / -${context.activity.deletions} lines · ${context.activity.filesChanged} files.`,
    ...(context.comparison?.hasBaseline
      ? (() => {
          const c = context.comparison;
          return [
            "",
            "## Trend vs previous period",
            `- Commits: ${c.commits.current} vs ${c.commits.previous}${pctSuffix(c.commits)}`,
            `- Lines: +${c.additions.current}/-${c.deletions.current} vs +${c.additions.previous}/-${c.deletions.previous}`,
            `- Contributors: ${c.contributors.current} vs ${c.contributors.previous}`,
            ...(c.movers.length ? [`- Movement: ${c.movers.map(moverLabel).join("; ")}`] : [])
          ];
        })()
      : []),
    ...(leaderboard.length
      ? (() => {
          const hasSignals = leaderboard.some(
            (row) => row.employeeId && context.employeeSignals?.has(row.employeeId)
          );
          return [
            "",
            "## Who did what",
            "_Ordered by real work (lines changed, excluding dependency/generated files) — a signal of activity, not a performance rating._",
            "",
            `| # | Contributor | Updates | Work (lines) | Files |${hasSignals ? " Focus |" : ""}`,
            `| --- | --- | ---: | ---: | ---: |${hasSignals ? " --- |" : ""}`,
            ...leaderboard.map((row) => {
              const signal = row.employeeId
                ? context.employeeSignals?.get(row.employeeId)
                : undefined;
              const focusCell = hasSignals
                ? ` ${
                    signal
                      ? [...signal.topCategories, ...signal.topModules].join(", ") || "—"
                      : "—"
                  } |`
                : "";
              return `| ${row.rank} | ${row.name}${row.mapped ? "" : " _(unmapped)_"} | ${row.commits} | ${row.effectiveLines.toLocaleString()} | ${row.filesChanged} |${focusCell}`;
            })
          ];
        })()
      : [])
  ].filter((line): line is string => line !== null);

  return { title, markdown: lines.join("\n") };
}
