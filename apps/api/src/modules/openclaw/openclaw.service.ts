import { prisma } from "../../config/database.js";
import { requireOrganizationMember } from "../../common/access/organization-access.js";
import {
  analyzeActivity,
  buildEmployeeLeaderboard,
  ensureActivityCollected,
  sampleCommits
} from "../activity/activity.service.js";
import { buildProjectEmployeeSignals } from "../analysis/analysis.service.js";
import { buildComparison } from "../report-engine/comparison.js";
import { buildInsights } from "../report-engine/insights.js";
import { buildCaveats } from "../report-engine/plain-language.js";
import { type ReportTheme, buildThemesPrompt, parseThemes } from "../report-engine/themes.js";
import { getLLMProvider } from "../llm/llm-registry.js";
import { createReport, findCachedReport } from "../reports/reports.service.js";
import type { GenerateReportInput } from "./openclaw.schemas.js";
import {
  buildReportMarkdown,
  buildReportPrompt,
  deriveTitle,
  fetchGitActivity,
  resolveEmployees,
  resolveEmployeeUsernames,
  resolvePeriod,
  resolveProject,
  resolveRepository,
  type ReportContext
} from "./openclaw.tools.js";

/** A cheap fingerprint of the underlying data; identical data ⇒ reuse the report. */
function computeFingerprint(activity: {
  commits: number;
  additions: number;
  deletions: number;
  filesChanged: number;
  lastCommitAt: Date | null;
  lastSha: string | null;
}) {
  // Include the latest commit instant + sha, not just the totals: two different
  // commit sets can share the same counts (and an amend keeps the counts), so
  // totals alone would keep serving a stale cached report.
  const t = activity.lastCommitAt ? activity.lastCommitAt.getTime() : 0;
  return `c${activity.commits}-a${activity.additions}-d${activity.deletions}-f${activity.filesChanged}-t${t}-s${activity.lastSha ?? ""}`;
}

/**
 * Appends the deterministic "Good to know" trust-calibration footer to a report.
 * Kept separate from the LLM narrative (and baked into the saved markdown) so the
 * caveats can never be paraphrased away, and so they render in every channel.
 */
function appendCaveats(markdown: string, caveats: string[]): string {
  if (!caveats.length) {
    return markdown;
  }
  return `${markdown}\n\n---\n\n## Good to know\n\n${caveats.map((caveat) => `- ${caveat}`).join("\n")}`;
}

/** The equal-length window immediately before `range` (for the trend comparison). */
function previousPeriod(range: { from: Date; to: Date }): { from: Date; to: Date } {
  const duration = Math.max(1, range.to.getTime() - range.from.getTime());
  const to = new Date(range.from.getTime() - 1);
  const from = new Date(to.getTime() - duration);
  return { from, to };
}

/**
 * OpenClaw orchestration entry point. A structured report request flows
 * through here: OpenClaw resolves the target/period, gathers real commit
 * activity, then produces the report via the LLM tool — never straight to an
 * LLM from a controller. Falls back to a deterministic template when no LLM is
 * configured, so the flow always works.
 */
export async function orchestrateReport(requesterId: string, input: GenerateReportInput) {
  await requireOrganizationMember(requesterId, input.organizationId);

  const range = resolvePeriod(input.period, input.customRange);

  const project = input.projectId
    ? await resolveProject(input.organizationId, input.projectId)
    : undefined;
  const repository = input.repositoryId
    ? await resolveRepository(input.organizationId, input.repositoryId)
    : undefined;
  const employees = input.employeeIds?.length
    ? await resolveEmployees(input.organizationId, input.employeeIds)
    : [];

  // Employee/team reports filter commits to the employees' mapped identities.
  const usernames = input.employeeIds?.length
    ? await resolveEmployeeUsernames(input.organizationId, input.employeeIds)
    : undefined;

  // Smart engine (Phase C): make sure the requested window is in the DB before we
  // read it — auto-collect only the sub-ranges missing from the coverage ledger,
  // per repository the report touches. Uses the org's stored credential.
  const collection = await ensureActivityCollected(
    {
      organizationId: input.organizationId,
      repositoryId: repository?.id,
      projectId: project?.id,
      employeeIds: input.employeeIds
    },
    range.from,
    range.to
  );

  const activityQuery = {
    organizationId: input.organizationId,
    repositoryId: repository?.id,
    projectId: project?.id,
    usernames,
    branch: input.branch,
    since: range.from,
    until: range.to
  };

  const activity = await fetchGitActivity(activityQuery);
  const analysis = await analyzeActivity(activityQuery);
  // Reports rank by noise-free lines so a dependency bump can't top the board.
  const leaderboard = await buildEmployeeLeaderboard(activityQuery, 5, { excludeNoise: true });

  // Report advance A/B: period-over-period comparison + auto-surfaced insights.
  // The previous window is the equal-length span just before this one, read
  // best-effort from stored data (no extra Git collection). buildComparison
  // suppresses deltas when there's no baseline, so a first-ever report is fine.
  const prevRange = previousPeriod(range);
  const prevQuery = { ...activityQuery, since: prevRange.from, until: prevRange.to };
  const prevActivity = await fetchGitActivity(prevQuery);
  const prevLeaderboard = await buildEmployeeLeaderboard(prevQuery, 0, { excludeNoise: true });
  const comparison = buildComparison({
    previousPeriod: { from: prevRange.from.toISOString(), to: prevRange.to.toISOString() },
    current: {
      commits: activity.commits,
      additions: activity.additions,
      deletions: activity.deletions,
      filesChanged: activity.filesChanged,
      contributors: leaderboard.length
    },
    previous: {
      commits: prevActivity.commits,
      additions: prevActivity.additions,
      deletions: prevActivity.deletions,
      filesChanged: prevActivity.filesChanged,
      contributors: prevLeaderboard.length
    },
    currentLeaders: leaderboard.map((row) => ({
      name: row.name,
      employeeId: row.employeeId,
      rank: row.rank
    })),
    previousLeaders: prevLeaderboard.map((row) => ({
      name: row.name,
      employeeId: row.employeeId,
      rank: row.rank
    }))
  });
  const insights = buildInsights({
    activity: { commits: activity.commits },
    analysis,
    leaderboard: leaderboard.map((row) => ({ name: row.name, lines: row.lines })),
    comparison
  });

  // Trust-calibration caveats: what the numbers do and don't cover. Deterministic
  // and appended to the saved markdown (both the LLM and template paths) so a
  // non-technical reader always knows the limits — never paraphrased away.
  const caveats = buildCaveats({
    hasBaseline: comparison.hasBaseline,
    unmappedContributors: leaderboard.filter((row) => !row.mapped && row.commits > 0).length,
    skippedRepositories: collection.warnings.length
  });

  // Fold the branch AND the previous-period baseline into the fingerprint: a
  // branch-filtered report never collides with the all-branches one, and a
  // changed baseline (which changes the trend/insights) busts a stale cache.
  const baseFingerprint = `${computeFingerprint(activity)}-p${prevActivity.commits}s${prevActivity.lastSha ?? ""}`;
  const dataFingerprint = input.branch ? `b:${input.branch}|${baseFingerprint}` : baseFingerprint;

  const baseTargetLabel =
    repository?.fullName ??
    project?.name ??
    (employees.length === 1
      ? employees[0]!.name
      : employees.length === 0
        ? "Entire team"
        : `${employees.length} employees`);
  const targetLabel = input.branch
    ? `${baseTargetLabel} · ${input.branch}`
    : baseTargetLabel;

  const statistics = {
    commits: activity.commits,
    additions: activity.additions,
    deletions: activity.deletions,
    filesChanged: activity.filesChanged
  };

  // Report cache: an identical prior request with the same data reuses the saved
  // report and skips the LLM. Custom prompts are one-off, so they always regenerate.
  if (!input.customPrompt) {
    const cached = await findCachedReport({
      organizationId: input.organizationId,
      reportType: input.reportType,
      repositoryId: repository?.id,
      projectId: project?.id,
      targetLabel,
      periodStart: range.from,
      periodEnd: range.to,
      dataFingerprint
    });

    if (cached) {
      return {
        reportId: cached.id,
        reportType: input.reportType,
        title: cached.title,
        markdown: cached.markdown,
        period: { from: range.from, to: range.to },
        project: project ?? null,
        repository: repository ?? null,
        employees,
        statistics,
        analysis,
        leaderboard,
        comparison,
        insights,
        themes: cached.themes ?? [],
        caveats,
        status: "GENERATED" as const,
        pending: [] as string[],
        warnings: collection.warnings,
        cached: true,
        collection
      };
    }
  }

  // Pass more update messages than the on-screen sample so the LLM has enough
  // material to cluster the work into "what shipped" themes (Phase 2).
  const commits = await sampleCommits(activityQuery, 60);

  // Project reports get per-employee focus signals (top categories/modules)
  // so the narrative can say WHAT each person worked on. Optional — a failure
  // here must never fail the report.
  let employeeSignals: ReportContext["employeeSignals"];
  if (input.reportType === "project" && project) {
    try {
      employeeSignals = await buildProjectEmployeeSignals(
        input.organizationId,
        project.id,
        range.from,
        range.to
      );
    } catch (error) {
      console.warn("Per-employee signals unavailable for report prompt.", error);
    }
  }

  const context: ReportContext = {
    reportType: input.reportType,
    range,
    project,
    repository,
    employees,
    branch: input.branch,
    activity,
    sampleCommits: commits,
    analysis,
    leaderboard,
    comparison,
    insights,
    employeeSignals,
    customPrompt: input.customPrompt
  };

  const title = deriveTitle(context);
  const llm = getLLMProvider();

  let markdown = buildReportMarkdown(context).markdown;
  let status: "GENERATED" | "PARTIAL" = "PARTIAL";
  let pending: string[] = [
    "AI narrative unavailable — no LLM provider is configured, so this report uses a deterministic template."
  ];

  if (llm.available) {
    try {
      markdown = await llm.complete(buildReportPrompt(context));
      status = "GENERATED";
      pending = [];
    } catch (error) {
      // Fall back to the template so a report is always returned.
      console.warn("LLM report generation failed; using template.", error);
      pending = ["AI narrative failed to generate; showing a deterministic template instead."];
    }
  }

  // Phase 2.5 — a dedicated structured clustering pass so "What shipped" can render
  // as a panel (not only prose). Reuses the already-fetched commit sample (no extra
  // DB/Git call) and only runs on a successful LLM report. Best-effort: a failure
  // here just yields no structured themes; the prose "## What shipped" still renders.
  let themes: ReportTheme[] = [];
  if (llm.available && !input.customPrompt && status === "GENERATED" && commits.length >= 3) {
    try {
      themes = parseThemes(await llm.complete(buildThemesPrompt(commits)));
    } catch (error) {
      console.warn("Theme clustering failed; skipping structured themes.", error);
    }
  }

  // Bake the deterministic caveats into the persisted markdown so they show in
  // every channel (dashboard, history, share link, Telegram) regardless of generator.
  markdown = appendCaveats(markdown, caveats);

  const savedReport = await createReport({
    organizationId: input.organizationId,
    requestedById: requesterId,
    reportType: input.reportType,
    targetLabel,
    repositoryId: repository?.id,
    projectId: project?.id,
    periodStart: range.from,
    periodEnd: range.to,
    title,
    markdownContent: markdown,
    statistics,
    comparison,
    insights,
    themes,
    status,
    generatedBy: status === "GENERATED" ? "llm" : "template",
    // Only fingerprint LLM reports — the cache reuses those, never the template.
    dataFingerprint: status === "GENERATED" ? dataFingerprint : undefined,
    contributors: employees.map((employee) => {
      const row = leaderboard.find((entry) => entry.employeeId === employee.id);
      return { userId: employee.id, name: employee.name, commitCount: row?.commits ?? 0 };
    })
  });

  await prisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      actorId: requesterId,
      action: "openclaw.report.generate",
      entityType: "Report",
      metadataJson: {
        reportType: input.reportType,
        period: input.period,
        repositoryId: input.repositoryId ?? null,
        projectId: input.projectId ?? null,
        branch: input.branch ?? null,
        employeeCount: employees.length,
        generatedBy: status === "GENERATED" ? "llm" : "template",
        reportId: savedReport.id,
        rangesCollected: collection.rangesCollected
      }
    }
  });

  return {
    reportId: savedReport.id,
    reportType: input.reportType,
    title,
    markdown,
    period: { from: range.from, to: range.to },
    project: project ?? null,
    repository: repository ?? null,
    employees,
    statistics,
    analysis,
    leaderboard,
    comparison,
    insights,
    themes,
    caveats,
    status,
    pending,
    warnings: collection.warnings,
    cached: false,
    collection
  };
}
