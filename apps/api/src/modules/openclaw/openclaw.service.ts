import { prisma } from "../../config/database.js";
import { requireOrganizationMember } from "../../common/access/organization-access.js";
import {
  analyzeActivity,
  buildEmployeeLeaderboard,
  ensureActivityCollected,
  sampleCommits
} from "../activity/activity.service.js";
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
}) {
  return `c${activity.commits}-a${activity.additions}-d${activity.deletions}-f${activity.filesChanged}`;
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
    since: range.from,
    until: range.to
  };

  const activity = await fetchGitActivity(activityQuery);
  const analysis = await analyzeActivity(activityQuery);
  const leaderboard = await buildEmployeeLeaderboard(activityQuery);
  const dataFingerprint = computeFingerprint(activity);

  const targetLabel =
    repository?.fullName ??
    project?.name ??
    (employees.length === 1 ? employees[0]!.name : `${employees.length} employees`);

  const statistics = {
    commits: activity.commits,
    additions: activity.additions,
    deletions: activity.deletions,
    filesChanged: activity.filesChanged
  };

  const readyPending = ["Statistics dashboard (Phase 13)", "Report sharing (Phase 14)"];

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
        status: "GENERATED" as const,
        pending: readyPending,
        cached: true,
        collection
      };
    }
  }

  const commits = await sampleCommits(activityQuery);

  const context: ReportContext = {
    reportType: input.reportType,
    range,
    project,
    repository,
    employees,
    activity,
    sampleCommits: commits,
    analysis,
    leaderboard,
    customPrompt: input.customPrompt
  };

  const title = deriveTitle(context);
  const llm = getLLMProvider();

  let markdown = buildReportMarkdown(context).markdown;
  let status: "GENERATED" | "PARTIAL" = "PARTIAL";
  let pending = [
    "LLM provider configuration",
    "Statistics dashboard (Phase 13)",
    "Report sharing (Phase 14)"
  ];

  if (llm.available) {
    try {
      markdown = await llm.complete(buildReportPrompt(context));
      status = "GENERATED";
      pending = readyPending;
    } catch (error) {
      // Fall back to the template so a report is always returned.
      console.warn("LLM report generation failed; using template.", error);
    }
  }

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
    status,
    generatedBy: status === "GENERATED" ? "llm" : "template",
    // Only fingerprint LLM reports — the cache reuses those, never the template.
    dataFingerprint: status === "GENERATED" ? dataFingerprint : undefined,
    contributors: employees.map((employee) => ({
      userId: employee.id,
      name: employee.name,
      commitCount: 0
    }))
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
    status,
    pending,
    cached: false,
    collection
  };
}
