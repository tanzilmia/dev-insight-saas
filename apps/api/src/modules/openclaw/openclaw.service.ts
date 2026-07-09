import { prisma } from "../../config/database.js";
import { requireOrganizationMember } from "../../common/access/organization-access.js";
import { analyzeActivity, sampleCommits } from "../activity/activity.service.js";
import { getLLMProvider } from "../llm/llm-registry.js";
import { createReport } from "../reports/reports.service.js";
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

function deriveTargetLabel(context: ReportContext) {
  return (
    context.repository?.fullName ??
    context.project?.name ??
    (context.employees.length === 1
      ? context.employees[0]!.name
      : `${context.employees.length} employees`)
  );
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

  const activityQuery = {
    organizationId: input.organizationId,
    repositoryId: repository?.id,
    projectId: project?.id,
    usernames,
    since: range.from,
    until: range.to
  };

  const activity = await fetchGitActivity(activityQuery);
  const commits = await sampleCommits(activityQuery);
  const analysis = await analyzeActivity(activityQuery);

  const context: ReportContext = {
    reportType: input.reportType,
    range,
    project,
    repository,
    employees,
    activity,
    sampleCommits: commits,
    analysis,
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
      pending = ["Statistics dashboard (Phase 13)", "Report sharing (Phase 14)"];
    } catch (error) {
      // Fall back to the template so a report is always returned.
      console.warn("LLM report generation failed; using template.", error);
    }
  }

  const savedReport = await createReport({
    organizationId: input.organizationId,
    requestedById: requesterId,
    reportType: input.reportType,
    targetLabel: deriveTargetLabel(context),
    repositoryId: repository?.id,
    projectId: project?.id,
    periodStart: range.from,
    periodEnd: range.to,
    title,
    markdownContent: markdown,
    statistics: {
      commits: activity.commits,
      additions: activity.additions,
      deletions: activity.deletions,
      filesChanged: activity.filesChanged
    },
    status,
    generatedBy: status === "GENERATED" ? "llm" : "template",
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
        reportId: savedReport.id
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
    statistics: {
      commits: activity.commits,
      additions: activity.additions,
      deletions: activity.deletions,
      filesChanged: activity.filesChanged
    },
    analysis,
    status,
    pending
  };
}
