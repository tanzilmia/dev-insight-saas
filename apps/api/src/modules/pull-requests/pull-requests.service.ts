import {
  MANAGER_ROLES,
  requireOrganizationMember,
  requireOrganizationRole
} from "../../common/access/organization-access.js";
import { AppError } from "../../common/errors/app-error.js";
import { prisma } from "../../config/database.js";
import { resolveRepositoryToken } from "../github-app/repository-token.js";

import type { ReviewMetricsQuery } from "./pull-requests.schemas.js";

const MAX_PRS = 300;
// Reviews are one API call per PR; only pull them for the newest N to bound cost.
const MAX_REVIEW_FETCH = 150;

/**
 * Fetches pull requests (+ reviews for the newest ones) for a repository and
 * stores them, de-duplicated. Manager-gated and authorized exclusively by the
 * repository's GitHub App installation. This is the raw data behind the
 * collaboration/review metrics (work that never appears in commit counts).
 */
export async function collectPullRequests(actorId: string, repositoryId: string) {
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
  const pulls = await provider.listPullRequests(token, repository.owner, repository.name, {
    max: MAX_PRS
  });

  let reviewCount = 0;

  for (const [index, pr] of pulls.entries()) {
    const saved = await prisma.pullRequest.upsert({
      where: { repositoryId_number: { repositoryId: repository.id, number: pr.number } },
      create: {
        repositoryId: repository.id,
        number: pr.number,
        title: pr.title,
        authorLogin: pr.authorLogin,
        state: pr.state,
        merged: pr.merged,
        openedAt: new Date(pr.openedAt),
        mergedAt: pr.mergedAt ? new Date(pr.mergedAt) : null,
        closedAt: pr.closedAt ? new Date(pr.closedAt) : null
      },
      update: {
        title: pr.title,
        state: pr.state,
        merged: pr.merged,
        mergedAt: pr.mergedAt ? new Date(pr.mergedAt) : null,
        closedAt: pr.closedAt ? new Date(pr.closedAt) : null
      }
    });

    if (index < MAX_REVIEW_FETCH) {
      const reviews = await provider.listPullRequestReviews(
        token,
        repository.owner,
        repository.name,
        pr.number
      );
      for (const review of reviews) {
        await prisma.pullRequestReview.upsert({
          where: { pullRequestId_externalId: { pullRequestId: saved.id, externalId: review.externalId } },
          create: {
            pullRequestId: saved.id,
            externalId: review.externalId,
            reviewerLogin: review.reviewerLogin,
            state: review.state,
            submittedAt: review.submittedAt ? new Date(review.submittedAt) : null
          },
          update: {
            state: review.state,
            submittedAt: review.submittedAt ? new Date(review.submittedAt) : null
          }
        });
        reviewCount += 1;
      }
    }
  }

  await prisma.auditLog.create({
    data: {
      organizationId: repository.organizationId,
      actorId,
      action: "pull_requests.collect",
      entityType: "Repository",
      entityId: repository.id,
      metadataJson: { prCount: pulls.length, reviewCount }
    }
  });

  return { prCount: pulls.length, reviewCount };
}

type EmployeeRef = { userId: string; name: string };

/** Lowercase git-login → employee, from declared aliases + mapped contributors. */
async function buildLoginToEmployee(organizationId: string): Promise<Map<string, EmployeeRef>> {
  const [aliases, mapped] = await Promise.all([
    prisma.employeeGitAlias.findMany({
      where: { organizationId, username: { not: null } },
      select: { username: true, user: { select: { id: true, name: true } } }
    }),
    prisma.contributorIdentity.findMany({
      where: { organizationId, username: { not: null }, mapping: { isNot: null } },
      select: { username: true, mapping: { select: { user: { select: { id: true, name: true } } } } }
    })
  ]);

  const map = new Map<string, EmployeeRef>();
  for (const c of mapped) {
    const user = c.mapping?.user;
    if (c.username && user) map.set(c.username.toLowerCase(), { userId: user.id, name: user.name });
  }
  for (const a of aliases) {
    if (a.username) map.set(a.username.toLowerCase(), { userId: a.user.id, name: a.user.name });
  }
  return map;
}

type DevCollab = {
  login: string;
  employee: EmployeeRef | null;
  prsOpened: number;
  prsMerged: number;
  reviewsGiven: number;
  approvals: number;
  changesRequested: number;
};

/**
 * Per-developer collaboration metrics over a period: PRs opened/merged and
 * reviews given (approvals / changes-requested), each joined to an employee
 * where the git login maps. Surfaces review/mentoring work that commit counts
 * miss. Read-only, org-member gated.
 */
export async function getReviewMetrics(actorId: string, query: ReviewMetricsQuery) {
  await requireOrganizationMember(actorId, query.organizationId);

  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from
    ? new Date(query.from)
    : (() => {
        const d = new Date(to);
        d.setDate(d.getDate() - 90);
        return d;
      })();

  const scope = {
    organizationId: query.organizationId,
    ...(query.projectId ? { projectId: query.projectId } : {})
  };

  const [prs, reviews, loginToEmployee] = await Promise.all([
    prisma.pullRequest.findMany({
      where: { repository: scope, openedAt: { gte: from, lte: to } },
      select: { authorLogin: true, merged: true }
    }),
    prisma.pullRequestReview.findMany({
      where: { pullRequest: { repository: scope }, submittedAt: { gte: from, lte: to } },
      select: { reviewerLogin: true, state: true }
    }),
    buildLoginToEmployee(query.organizationId)
  ]);

  const byKey = new Map<string, DevCollab>();
  const bucket = (login: string | null): DevCollab | null => {
    if (!login) return null;
    const employee = loginToEmployee.get(login.toLowerCase()) ?? null;
    const key = employee ? `u:${employee.userId}` : `l:${login.toLowerCase()}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { login, employee, prsOpened: 0, prsMerged: 0, reviewsGiven: 0, approvals: 0, changesRequested: 0 };
      byKey.set(key, entry);
    }
    return entry;
  };

  const totals = { prsOpened: 0, prsMerged: 0, reviewsGiven: 0 };

  for (const pr of prs) {
    totals.prsOpened += 1;
    if (pr.merged) totals.prsMerged += 1;
    const entry = bucket(pr.authorLogin);
    if (entry) {
      entry.prsOpened += 1;
      if (pr.merged) entry.prsMerged += 1;
    }
  }
  for (const review of reviews) {
    totals.reviewsGiven += 1;
    const entry = bucket(review.reviewerLogin);
    if (entry) {
      entry.reviewsGiven += 1;
      if (review.state === "APPROVED") entry.approvals += 1;
      else if (review.state === "CHANGES_REQUESTED") entry.changesRequested += 1;
    }
  }

  const developers = [...byKey.values()].sort(
    (a, b) => b.reviewsGiven + b.prsOpened - (a.reviewsGiven + a.prsOpened)
  );

  return { period: { from, to }, totals, developers };
}
