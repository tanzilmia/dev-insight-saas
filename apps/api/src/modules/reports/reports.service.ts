import { randomBytes } from "node:crypto";

import type { Prisma, Report, ReportContributor } from "@prisma/client";

import {
  MANAGER_ROLES,
  requireOrganizationMember,
  requireOrganizationRole
} from "../../common/access/organization-access.js";
import { AppError } from "../../common/errors/app-error.js";
import { prisma } from "../../config/database.js";
import type { ReportComparison } from "../report-engine/comparison.js";
import type { Insight } from "../report-engine/insights.js";
import type { ReportType } from "../openclaw/openclaw.schemas.js";

type ReportStatistics = {
  commits: number;
  additions: number;
  deletions: number;
  filesChanged: number;
};

/**
 * `statisticsJson` holds the 4 headline counts plus (optionally) the persisted
 * period comparison + key insights (Report advances A/B), so a saved/history
 * report renders the same structured panel as a freshly generated one. Splits
 * the stored blob back into its parts for the response.
 */
function splitStatistics(json: unknown): {
  statistics: ReportStatistics | null;
  comparison: ReportComparison | null;
  insights: Insight[] | null;
} {
  const j = (json ?? {}) as Record<string, unknown>;
  const statistics =
    j.commits !== undefined
      ? {
          commits: Number(j.commits) || 0,
          additions: Number(j.additions) || 0,
          deletions: Number(j.deletions) || 0,
          filesChanged: Number(j.filesChanged) || 0
        }
      : null;
  return {
    statistics,
    comparison: (j.comparison as ReportComparison | undefined) ?? null,
    insights: (j.insights as Insight[] | undefined) ?? null
  };
}

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
  comparison?: ReportComparison | null;
  insights?: Insight[] | null;
  status: "GENERATED" | "PARTIAL";
  generatedBy: "llm" | "template";
  dataFingerprint?: string;
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
    statistics: splitStatistics(report.statisticsJson).statistics,
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
  const { comparison, insights } = splitStatistics(report.statisticsJson);
  return {
    ...toSummary(report),
    markdown: report.markdownContent,
    repositoryId: report.repositoryId,
    projectId: report.projectId,
    requestedById: report.requestedById,
    shareToken: report.shareToken,
    comparison,
    insights,
    contributors: report.contributors.map(toContributor)
  };
}

export async function createReport(input: CreateReportInput) {
  // Persist the headline stats plus (optionally) the comparison/insights so a
  // history report renders the same structured panel as a fresh one.
  const statisticsJson = {
    ...input.statistics,
    ...(input.comparison ? { comparison: input.comparison } : {}),
    ...(input.insights?.length ? { insights: input.insights } : {})
  } as unknown as Prisma.InputJsonObject;

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
        dataFingerprint: input.dataFingerprint ?? null,
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

function startOfDay(date: Date) {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

type CacheLookupInput = {
  organizationId: string;
  reportType: ReportType;
  repositoryId?: string;
  projectId?: string;
  targetLabel: string;
  periodStart: Date;
  periodEnd: Date;
  dataFingerprint: string;
};

/**
 * Report cache (Phase C): returns a previously LLM-generated report that can be
 * safely reused for an identical request — same scope, same day-bucketed period,
 * and identical data fingerprint — so the LLM is not re-run. Day-bucketing lets a
 * relative window (e.g. "last 30 days") hit the cache within the same day, while
 * the fingerprint forces a fresh report as soon as new commits are collected.
 */
export async function findCachedReport(input: CacheLookupInput) {
  const startDay = startOfDay(input.periodStart);
  const endDay = startOfDay(input.periodEnd);

  const report = await prisma.report.findFirst({
    where: {
      organizationId: input.organizationId,
      reportType: input.reportType,
      repositoryId: input.repositoryId ?? null,
      projectId: input.projectId ?? null,
      targetLabel: input.targetLabel,
      dataFingerprint: input.dataFingerprint,
      generatedBy: "llm",
      status: "GENERATED",
      periodStart: { gte: startDay, lt: addDays(startDay, 1) },
      periodEnd: { gte: endDay, lt: addDays(endDay, 1) }
    },
    orderBy: { createdAt: "desc" },
    include: { contributors: true }
  });

  return report ? toDetail(report) : null;
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

export async function deleteReport(actorId: string, reportId: string) {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: { id: true, organizationId: true }
  });

  if (!report) {
    throw new AppError(404, "Report was not found", "REPORT_NOT_FOUND");
  }

  // Deleting is destructive, so gate it to managers/owners (viewing is any member).
  await requireOrganizationRole(actorId, report.organizationId, MANAGER_ROLES);
  await prisma.report.delete({ where: { id: reportId } });

  return { id: reportId };
}

const SHARE_TOKEN_BYTES = 24;

/** Create (or return the existing) public share token for a report. */
export async function shareReport(actorId: string, reportId: string) {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: { id: true, organizationId: true, shareToken: true }
  });
  if (!report) {
    throw new AppError(404, "Report was not found", "REPORT_NOT_FOUND");
  }
  await requireOrganizationRole(actorId, report.organizationId, MANAGER_ROLES);

  if (report.shareToken) {
    return { token: report.shareToken };
  }
  const token = randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
  await prisma.report.update({ where: { id: reportId }, data: { shareToken: token } });
  return { token };
}

/** Revoke a report's public share link. */
export async function unshareReport(actorId: string, reportId: string) {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: { id: true, organizationId: true }
  });
  if (!report) {
    throw new AppError(404, "Report was not found", "REPORT_NOT_FOUND");
  }
  await requireOrganizationRole(actorId, report.organizationId, MANAGER_ROLES);
  await prisma.report.update({ where: { id: reportId }, data: { shareToken: null } });
  return { id: reportId };
}

/**
 * Public, unauthenticated read of a shared report by its token. Returns only the
 * presentational fields — never org ids, contributor rows, or internal data.
 */
export async function getPublicReport(token: string) {
  const report = await prisma.report.findUnique({ where: { shareToken: token } });
  if (!report) {
    throw new AppError(404, "This shared report is no longer available", "SHARED_REPORT_NOT_FOUND");
  }
  const { statistics, comparison, insights } = splitStatistics(report.statisticsJson);
  return {
    title: report.title,
    markdown: report.markdownContent,
    reportType: report.reportType,
    targetLabel: report.targetLabel,
    status: report.status,
    period: { from: report.periodStart, to: report.periodEnd },
    statistics,
    comparison,
    insights,
    createdAt: report.createdAt
  };
}
