import type { GitHubIssue, Prisma } from "@prisma/client";

import {
  MANAGER_ROLES,
  requireOrganizationMember,
  requireOrganizationRole
} from "../../common/access/organization-access.js";
import { AppError } from "../../common/errors/app-error.js";
import { prisma } from "../../config/database.js";
import { resolveRepositoryToken } from "../github-app/repository-token.js";

import type { IssueListQuery, IssueMetricsQuery } from "./issues.schemas.js";

const MAX_ISSUES = 300;
const MAX_EVENTS_PER_ISSUE = 200;
const MAX_METRIC_ISSUES = 5_000;
const OVERDUE_DAYS = 14;

export type GitHubIssueWebhookPayload = {
  action?: string;
  installation?: { id?: number | string };
  repository?: { id?: number | string };
  sender?: { login?: string } | null;
  issue?: {
    id?: number | string;
    number?: number;
    title?: string;
    body?: string | null;
    state?: string;
    state_reason?: string | null;
    user?: { login?: string; avatar_url?: string | null } | null;
    assignees?: { login?: string }[];
    labels?: { name?: string }[];
    milestone?: { title?: string } | null;
    html_url?: string;
    created_at?: string;
    updated_at?: string;
    closed_at?: string | null;
  };
  assignee?: { login?: string } | null;
  label?: { name?: string } | null;
  milestone?: { title?: string } | null;
};

type EmployeeRef = { userId: string; name: string };

async function buildLoginToEmployee(organizationId: string): Promise<Map<string, EmployeeRef>> {
  const [aliases, mapped] = await Promise.all([
    prisma.employeeGitAlias.findMany({
      where: { organizationId, username: { not: null } },
      select: { username: true, user: { select: { id: true, name: true } } }
    }),
    prisma.contributorIdentity.findMany({
      where: { organizationId, username: { not: null }, mapping: { isNot: null } },
      select: {
        username: true,
        mapping: { select: { user: { select: { id: true, name: true } } } }
      }
    })
  ]);

  const map = new Map<string, EmployeeRef>();
  for (const row of mapped) {
    const user = row.mapping?.user;
    if (row.username && user) {
      map.set(row.username.toLowerCase(), { userId: user.id, name: user.name });
    }
  }
  for (const row of aliases) {
    if (row.username) {
      map.set(row.username.toLowerCase(), { userId: row.user.id, name: row.user.name });
    }
  }
  return map;
}

function mapLogin(login: string | null, employees: Map<string, EmployeeRef>) {
  if (!login) return null;
  return { login, employee: employees.get(login.toLowerCase()) ?? null };
}

function toIssueDto(issue: GitHubIssue, employees: Map<string, EmployeeRef>) {
  return {
    id: issue.id,
    repositoryId: issue.repositoryId,
    externalId: issue.externalId,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    stateReason: issue.stateReason,
    author: mapLogin(issue.authorLogin, employees),
    assignees: issue.assigneeLogins.map((login) => mapLogin(login, employees)),
    labels: issue.labels,
    milestoneTitle: issue.milestoneTitle,
    htmlUrl: issue.htmlUrl,
    openedAt: issue.openedAt,
    providerUpdatedAt: issue.providerUpdatedAt,
    closedAt: issue.closedAt,
    lastSyncedAt: issue.lastSyncedAt
  };
}

function issueRepositoryWhere(query: { organizationId: string; repositoryId?: string; projectId?: string }) {
  return {
    organizationId: query.organizationId,
    ...(query.repositoryId ? { id: query.repositoryId } : {}),
    ...(query.projectId ? { projectId: query.projectId } : {})
  } satisfies Prisma.RepositoryWhereInput;
}

function rangeWhere(from?: string, to?: string) {
  if (!from || !to) return undefined;
  return { gte: new Date(from), lte: new Date(to) };
}

export async function collectIssues(actorId: string, repositoryId: string) {
  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
    select: {
      id: true,
      organizationId: true,
      owner: true,
      name: true,
      appInstallationId: true,
      provider: true
    }
  });
  if (!repository) throw new AppError(404, "Repository not found", "REPO_NOT_FOUND");
  await requireOrganizationRole(actorId, repository.organizationId, MANAGER_ROLES);

  const { token, provider } = await resolveRepositoryToken(repository);
  const issues = await provider.listIssues(token, repository.owner, repository.name, {
    max: MAX_ISSUES
  });
  const snapshots: { issue: (typeof issues)[number]; events: Awaited<ReturnType<typeof provider.listIssueEvents>> }[] = [];

  for (const issue of issues) {
    const events = await provider.listIssueEvents(
      token,
      repository.owner,
      repository.name,
      issue.number,
      { max: MAX_EVENTS_PER_ISSUE }
    );
    snapshots.push({ issue, events });
  }

  const syncedAt = new Date();
  let eventCount = 0;
  await prisma.$transaction(async (tx) => {
    for (const snapshot of snapshots) {
      const issue = snapshot.issue;
      const saved = await tx.gitHubIssue.upsert({
        where: { repositoryId_number: { repositoryId, number: issue.number } },
        create: {
          organizationId: repository.organizationId,
          repositoryId,
          externalId: issue.externalId,
          number: issue.number,
          title: issue.title,
          body: issue.body?.slice(0, 100_000) ?? null,
          state: issue.state,
          stateReason: issue.stateReason,
          authorLogin: issue.authorLogin,
          authorAvatarUrl: issue.authorAvatarUrl,
          assigneeLogins: issue.assigneeLogins,
          labels: issue.labels,
          milestoneTitle: issue.milestoneTitle,
          htmlUrl: issue.htmlUrl,
          openedAt: new Date(issue.openedAt),
          providerUpdatedAt: new Date(issue.updatedAt),
          closedAt: issue.closedAt ? new Date(issue.closedAt) : null,
          lastSyncedAt: syncedAt
        },
        update: {
          externalId: issue.externalId,
          title: issue.title,
          body: issue.body?.slice(0, 100_000) ?? null,
          state: issue.state,
          stateReason: issue.stateReason,
          authorLogin: issue.authorLogin,
          authorAvatarUrl: issue.authorAvatarUrl,
          assigneeLogins: issue.assigneeLogins,
          labels: issue.labels,
          milestoneTitle: issue.milestoneTitle,
          htmlUrl: issue.htmlUrl,
          openedAt: new Date(issue.openedAt),
          providerUpdatedAt: new Date(issue.updatedAt),
          closedAt: issue.closedAt ? new Date(issue.closedAt) : null,
          lastSyncedAt: syncedAt
        }
      });

      for (const event of snapshot.events) {
        await tx.gitHubIssueEvent.upsert({
          where: { issueId_externalId: { issueId: saved.id, externalId: event.externalId } },
          create: {
            issueId: saved.id,
            externalId: event.externalId,
            eventType: event.eventType,
            actorLogin: event.actorLogin,
            assigneeLogin: event.assigneeLogin,
            labelName: event.labelName,
            milestoneTitle: event.milestoneTitle,
            commitSha: event.commitSha,
            occurredAt: new Date(event.occurredAt)
          },
          update: {
            eventType: event.eventType,
            actorLogin: event.actorLogin,
            assigneeLogin: event.assigneeLogin,
            labelName: event.labelName,
            milestoneTitle: event.milestoneTitle,
            commitSha: event.commitSha,
            occurredAt: new Date(event.occurredAt)
          }
        });
        eventCount += 1;
      }
    }

    await tx.auditLog.create({
      data: {
        organizationId: repository.organizationId,
        actorId,
        action: "github_issues.collect",
        entityType: "Repository",
        entityId: repositoryId,
        metadataJson: { issueCount: snapshots.length, eventCount }
      }
    });
  });

  return {
    issueCount: snapshots.length,
    eventCount,
    capped: snapshots.length >= MAX_ISSUES
  };
}

/**
 * Applies a GitHub App `issues` webhook after the controller has authenticated
 * its HMAC. Tenant resolution requires both the installation and repository
 * access grant to agree, matching the push-event security boundary.
 */
export async function handleGitHubAppIssuesEvent(
  payload: GitHubIssueWebhookPayload,
  deliveryId?: string
): Promise<void> {
  const installationId = payload.installation?.id;
  const externalRepositoryId = payload.repository?.id;
  const issue = payload.issue;
  if (
    installationId === undefined ||
    externalRepositoryId === undefined ||
    !issue?.id ||
    !issue.number ||
    !issue.created_at ||
    !issue.updated_at ||
    !issue.html_url
  ) {
    return;
  }

  const installation = await prisma.gitHubAppInstallation.findFirst({
    where: { installationId: String(installationId), suspendedAt: null },
    select: { id: true, organizationId: true }
  });
  if (!installation) return;

  const repository = await prisma.repository.findFirst({
    where: {
      organizationId: installation.organizationId,
      provider: "GITHUB",
      externalId: String(externalRepositoryId),
      appInstallationId: installation.id,
      access: { some: { appInstallationId: installation.id } }
    },
    select: { id: true, organizationId: true }
  });
  if (!repository) return;

  const eventId = deliveryId?.trim() || `${issue.id}:${payload.action ?? "updated"}:${issue.updated_at}`;
  const eventType = payload.action ?? "updated";
  const assigneeLogin = payload.assignee?.login?.trim().toLowerCase() ?? null;
  const labelName = payload.label?.name?.trim() || null;
  const milestoneTitle = payload.milestone?.title?.trim() || null;

  await prisma.$transaction(async (tx) => {
    const saved = await tx.gitHubIssue.upsert({
      where: { repositoryId_number: { repositoryId: repository.id, number: issue.number! } },
      create: {
        organizationId: repository.organizationId,
        repositoryId: repository.id,
        externalId: String(issue.id),
        number: issue.number!,
        title: issue.title ?? "",
        body: issue.body?.slice(0, 100_000) ?? null,
        state: issue.state ?? "open",
        stateReason: issue.state_reason ?? null,
        authorLogin: issue.user?.login ?? null,
        authorAvatarUrl: issue.user?.avatar_url ?? null,
        assigneeLogins: (issue.assignees ?? [])
          .map((assignee) => assignee.login?.trim().toLowerCase())
          .filter((login): login is string => Boolean(login)),
        labels: (issue.labels ?? [])
          .map((label) => label.name?.trim())
          .filter((label): label is string => Boolean(label)),
        milestoneTitle: issue.milestone?.title ?? null,
        htmlUrl: issue.html_url!,
        openedAt: new Date(issue.created_at!),
        providerUpdatedAt: new Date(issue.updated_at!),
        closedAt: issue.closed_at ? new Date(issue.closed_at) : null,
        lastSyncedAt: new Date()
      },
      update: {
        externalId: String(issue.id),
        title: issue.title ?? "",
        body: issue.body?.slice(0, 100_000) ?? null,
        state: issue.state ?? "open",
        stateReason: issue.state_reason ?? null,
        authorLogin: issue.user?.login ?? null,
        authorAvatarUrl: issue.user?.avatar_url ?? null,
        assigneeLogins: (issue.assignees ?? [])
          .map((assignee) => assignee.login?.trim().toLowerCase())
          .filter((login): login is string => Boolean(login)),
        labels: (issue.labels ?? [])
          .map((label) => label.name?.trim())
          .filter((label): label is string => Boolean(label)),
        milestoneTitle: issue.milestone?.title ?? null,
        htmlUrl: issue.html_url!,
        openedAt: new Date(issue.created_at!),
        providerUpdatedAt: new Date(issue.updated_at!),
        closedAt: issue.closed_at ? new Date(issue.closed_at) : null,
        lastSyncedAt: new Date()
      }
    });

    await tx.gitHubIssueEvent.upsert({
      where: { issueId_externalId: { issueId: saved.id, externalId: eventId } },
      create: {
        issueId: saved.id,
        externalId: eventId,
        eventType,
        actorLogin: payload.sender?.login ?? null,
        assigneeLogin,
        labelName,
        milestoneTitle,
        occurredAt: new Date(issue.updated_at!)
      },
      update: {
        eventType,
        actorLogin: payload.sender?.login ?? null,
        assigneeLogin,
        labelName,
        milestoneTitle,
        occurredAt: new Date(issue.updated_at!)
      }
    });
  });
}

export async function listIssues(actorId: string, query: IssueListQuery) {
  await requireOrganizationMember(actorId, query.organizationId);
  const employees = await buildLoginToEmployee(query.organizationId);
  const issues = await prisma.gitHubIssue.findMany({
    where: {
      repository: issueRepositoryWhere(query),
      ...(query.state ? { state: query.state } : {}),
      ...(query.assignee ? { assigneeLogins: { has: query.assignee.trim().toLowerCase() } } : {}),
      ...(rangeWhere(query.from, query.to) ? { openedAt: rangeWhere(query.from, query.to) } : {})
    },
    orderBy: [{ state: "asc" }, { openedAt: "desc" }],
    take: query.limit
  });

  return issues.map((issue) => toIssueDto(issue, employees));
}

export async function listIssueEvents(actorId: string, organizationId: string, issueId: string) {
  const issue = await prisma.gitHubIssue.findUnique({
    where: { id: issueId },
    select: { id: true, organizationId: true }
  });
  if (!issue || issue.organizationId !== organizationId) {
    throw new AppError(404, "Issue not found", "ISSUE_NOT_FOUND");
  }
  await requireOrganizationMember(actorId, organizationId);

  return prisma.gitHubIssueEvent.findMany({
    where: { issueId },
    orderBy: { occurredAt: "desc" },
    take: MAX_EVENTS_PER_ISSUE
  });
}

type IssueDeveloperMetric = {
  login: string;
  employee: EmployeeRef | null;
  assignedOpen: number;
  opened: number;
  closed: number;
};

type IssueMetricRow = Pick<
  GitHubIssue,
  "state" | "assigneeLogins" | "labels" | "openedAt" | "closedAt"
>;

export function calculateIssueMetrics(
  issues: IssueMetricRow[],
  from: Date,
  to: Date,
  employees: Map<string, EmployeeRef>
) {
  const developers = new Map<string, IssueDeveloperMetric>();
  const bucket = (login: string): IssueDeveloperMetric => {
    const normalized = login.toLowerCase();
    const employee = employees.get(normalized) ?? null;
    const key = employee ? `u:${employee.userId}` : `l:${normalized}`;
    let entry = developers.get(key);
    if (!entry) {
      entry = { login, employee, assignedOpen: 0, opened: 0, closed: 0 };
      developers.set(key, entry);
    }
    return entry;
  };

  let open = 0;
  let opened = 0;
  let closed = 0;
  let unassignedOpen = 0;
  let overdueOpen = 0;
  let openAgeTotal = 0;
  let openAgeCount = 0;
  let cycleTotal = 0;
  let cycleCount = 0;
  const labelCounts = new Map<string, number>();

  for (const issue of issues) {
    const openedInPeriod = issue.openedAt >= from && issue.openedAt <= to;
    const closedInPeriod = Boolean(issue.closedAt && issue.closedAt >= from && issue.closedAt <= to);
    if (openedInPeriod) opened += 1;
    if (closedInPeriod) closed += 1;

    for (const label of issue.labels) {
      labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
    }

    if (issue.state === "open") {
      open += 1;
      const ageDays = Math.max(0, (to.getTime() - issue.openedAt.getTime()) / 86_400_000);
      openAgeTotal += ageDays;
      openAgeCount += 1;
      if (ageDays >= OVERDUE_DAYS) overdueOpen += 1;
      if (!issue.assigneeLogins.length) unassignedOpen += 1;
    }

    if (closedInPeriod && issue.closedAt) {
      cycleTotal += Math.max(0, (issue.closedAt.getTime() - issue.openedAt.getTime()) / 86_400_000);
      cycleCount += 1;
    }

    for (const login of issue.assigneeLogins) {
      const developer = bucket(login);
      if (issue.state === "open") developer.assignedOpen += 1;
      if (openedInPeriod) developer.opened += 1;
      if (closedInPeriod) developer.closed += 1;
    }
  }

  return {
    period: { from, to },
    totals: {
      open,
      opened,
      closed,
      unassignedOpen,
      overdueOpen,
      avgAgeDays: openAgeCount ? Math.round((openAgeTotal / openAgeCount) * 10) / 10 : 0,
      avgCycleDays: cycleCount ? Math.round((cycleTotal / cycleCount) * 10) / 10 : 0
    },
    labels: [...labelCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([label, count]) => ({ label, count })),
    developers: [...developers.values()].sort(
      (a, b) => b.assignedOpen + b.opened + b.closed - (a.assignedOpen + a.opened + a.closed)
    )
  };
}

export async function getIssueMetrics(actorId: string, query: IssueMetricsQuery) {
  await requireOrganizationMember(actorId, query.organizationId);
  const employees = await buildLoginToEmployee(query.organizationId);
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);

  const issues = await prisma.gitHubIssue.findMany({
    where: {
      repository: issueRepositoryWhere(query),
      openedAt: { lte: to }
    },
    orderBy: { openedAt: "desc" },
    take: MAX_METRIC_ISSUES
  });

  const metrics = calculateIssueMetrics(issues, from, to, employees);
  return {
    ...metrics,
    truncated: issues.length >= MAX_METRIC_ISSUES,
  };
}
