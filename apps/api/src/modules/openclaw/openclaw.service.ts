import { prisma } from "../../config/database.js";
import { requireOrganizationMember } from "../../common/access/organization-access.js";
import type { GenerateReportInput } from "./openclaw.schemas.js";
import {
  buildReportMarkdown,
  fetchGitActivity,
  resolveEmployees,
  resolveEmployeeUsernames,
  resolvePeriod,
  resolveProject,
  resolveRepository
} from "./openclaw.tools.js";

/**
 * OpenClaw orchestration entry point. A structured report request flows
 * through here: OpenClaw resolves the target/period, gathers activity, and
 * produces the report by calling the internal tools — never straight to an
 * LLM from a controller. Git activity + LLM generation are scaffolded until
 * Phases 8/10 land.
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

  const activity = await fetchGitActivity({
    organizationId: input.organizationId,
    repositoryId: repository?.id,
    projectId: project?.id,
    usernames,
    since: range.from,
    until: range.to
  });

  const { title, markdown } = buildReportMarkdown({
    reportType: input.reportType,
    range,
    project,
    repository,
    employees,
    activity,
    customPrompt: input.customPrompt
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
        employeeCount: employees.length
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
    status: "PARTIAL" as const,
    pending: ["AI report generation (Phase 10)", "Report persistence (Phase 11)"]
  };
}
