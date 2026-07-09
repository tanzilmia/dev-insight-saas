import type { Prisma, Report, ReportContributor } from "@prisma/client";

import { requireOrganizationMember } from "../../common/access/organization-access.js";
import { AppError } from "../../common/errors/app-error.js";
import { prisma } from "../../config/database.js";
import type { ReportType } from "../openclaw/openclaw.schemas.js";

type ReportStatistics = {
  commits: number;
  additions: number;
  deletions: number;
  filesChanged: number;
};

type CreateReportContributorInput = {
  userId?: string;
  contributorIdentityId?: string;
  name?: string;
  commitCount?: number;
};

type CreateReportInput = {
  organizationId: string;
  requestedById: string;
  reportType: ReportType;
  targetLabel: string;
  repositoryId?: string;
  projectId?: string;
  periodStart: Date;
  periodEnd: Date;
  title: string;
  markdownContent: string;
  statistics: ReportStatistics;
  status: "GENERATED" | "PARTIAL";
  generatedBy: "llm" | "template";
  contributors?: CreateReportContributorInput[];
};

type ReportWithContributors = Report & { contributors: ReportContributor[] };

function toSummary(report: Report) {
  return {
    id: report.id,
    organizationId: report.organizationId,
    reportType: report.reportType,
    targetLabel: report.targetLabel,
    title: report.title,
    status: report.status,
    generatedBy: report.generatedBy,
    period: {
      from: report.periodStart,
      to: report.periodEnd
    },
    statistics: report.statisticsJson,
    createdAt: report.createdAt
  };
}

function toContributor(contributor: ReportContributor) {
  return {
    id: contributor.id,
    userId: contributor.userId,
    contributorIdentityId: contributor.contributorIdentityId,
    name: contributor.name,
    commitCount: contributor.commitCount
  };
}

function toDetail(report: ReportWithContributors) {
  return {
    ...toSummary(report),
    markdown: report.markdownContent,
    repositoryId: report.repositoryId,
    projectId: report.projectId,
    requestedById: report.requestedById,
    contributors: report.contributors.map(toContributor)
  };
}

export async function createReport(input: CreateReportInput) {
  const statisticsJson = input.statistics as unknown as Prisma.InputJsonObject;

  const report = await prisma.$transaction(async (tx) => {
    const created = await tx.report.create({
      data: {
        organizationId: input.organizationId,
        requestedById: input.requestedById,
        reportType: input.reportType,
        targetLabel: input.targetLabel,
        repositoryId: input.repositoryId ?? null,
        projectId: input.projectId ?? null,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        title: input.title,
        markdownContent: input.markdownContent,
        statisticsJson,
        status: input.status,
        generatedBy: input.generatedBy,
        contributors: input.contributors?.length
          ? {
              create: input.contributors.map((contributor) => ({
                userId: contributor.userId ?? null,
                contributorIdentityId: contributor.contributorIdentityId ?? null,
                name: contributor.name ?? null,
                commitCount: contributor.commitCount ?? 0
              }))
            }
          : undefined
      },
      include: { contributors: true }
    });

    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        actorId: input.requestedById,
        action: "report.create",
        entityType: "Report",
        entityId: created.id,
        metadataJson: {
          reportType: input.reportType,
          status: input.status,
          generatedBy: input.generatedBy
        }
      }
    });

    return created;
  });

  return toDetail(report);
}

export async function listReports(
  actorId: string,
  organizationId: string,
  filters: { reportType?: ReportType; limit: number }
) {
  await requireOrganizationMember(actorId, organizationId);

  const reports = await prisma.report.findMany({
    where: {
      organizationId,
      ...(filters.reportType ? { reportType: filters.reportType } : {})
    },
    orderBy: { createdAt: "desc" },
    take: filters.limit
  });

  return reports.map(toSummary);
}

export async function getReport(actorId: string, reportId: string) {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: { contributors: true }
  });

  if (!report) {
    throw new AppError(404, "Report was not found", "REPORT_NOT_FOUND");
  }

  await requireOrganizationMember(actorId, report.organizationId);

  return toDetail(report);
}
