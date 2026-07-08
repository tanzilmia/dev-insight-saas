import { prisma } from "../../config/database.js";
import { requireOrganizationMember } from "../../common/access/organization-access.js";
import { sampleCommits } from "../activity/activity.service.js";
import { getLLMProvider } from "../llm/llm-registry.js";
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

  const context: ReportContext = {
    reportType: input.reportType,
    range,
    project,
    repository,
    employees,
    activity,
    sampleCommits: commits,
    customPrompt: input.customPrompt
  };

  const title = deriveTitle(context);
  const llm = getLLMProvider();

  let markdown = buildReportMarkdown(context).markdown;
  let status: "GENERATED" | "PARTIAL" = "PARTIAL";
  let pending = ["AI report generation (Phase 10)", "Report persistence (Phase 11)"];

  if (llm.available) {
    try {
      markdown = await llm.complete(buildReportPrompt(context));
      status = "GENERATED";
      pending = ["Report persistence (Phase 11)"];
    } catch (error) {
      // Fall back to the template so a report is always returned.
      console.warn("LLM report generation failed; using template.", error);
    }
  }

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
        generatedBy: status === "GENERATED" ? "llm" : "template"
      }
    }
  });

  return {
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
    status,
    pending
  };
}
