import type { Prisma } from "@prisma/client";

import { prisma } from "../../config/database.js";
import { requireOrganizationMember } from "../../common/access/organization-access.js";
import { analyzeActivity, buildEmployeeLeaderboard } from "../activity/activity.service.js";
import { resolvePeriod } from "../openclaw/openclaw.tools.js";
import type { StatisticsQuery } from "./statistics.schemas.js";

// Guards on the daily time series so an unbounded custom range can't explode it.
const MAX_SERIES_POINTS = 180;

function startOfDay(date: Date) {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

/**
 * Local `YYYY-MM-DD` for a day bucket. `toISOString().slice(0,10)` would emit
 * the UTC date, mislabelling every bucket by a day (and pairing it with the
 * wrong commits) in any server timezone ahead of UTC, since the buckets are
 * keyed by *local* midnight.
 */
function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Aggregates stored Git activity for the whole organization over a period into
 * the numbers the dashboard needs: headline totals, a daily commit series, top
 * contributors (Phase F leaderboard), per-repository / per-project breakdowns,
 * and the work/risk summary (Phase 9). Reads only what has been collected — it
 * never hits Git.
 */
export async function getStatisticsOverview(actorId: string, query: StatisticsQuery) {
  await requireOrganizationMember(actorId, query.organizationId);

  const range = resolvePeriod(
    query.period,
    query.from && query.to ? { from: query.from, to: query.to } : undefined
  );
  const { from, to } = range;

  const commitWhere: Prisma.CommitWhereInput = {
    repository: { organizationId: query.organizationId },
    committedAt: { gte: from, lte: to }
  };

  const [totals, contributorRows, activeRepoRows, commits, byRepoGroup, leaderboard, analysis] =
    await Promise.all([
      prisma.commit.aggregate({
        where: commitWhere,
        _count: { _all: true },
        _sum: { additions: true, deletions: true, changedFilesCount: true }
      }),
      prisma.commit.findMany({ where: commitWhere, select: { username: true }, distinct: ["username"] }),
      prisma.commit.findMany({
        where: commitWhere,
        select: { repositoryId: true },
        distinct: ["repositoryId"]
      }),
      prisma.commit.findMany({
        where: commitWhere,
        select: { committedAt: true, additions: true, deletions: true },
        orderBy: { committedAt: "asc" }
      }),
      prisma.commit.groupBy({
        by: ["repositoryId"],
        where: commitWhere,
        _count: { _all: true },
        _sum: { additions: true, deletions: true }
      }),
      buildEmployeeLeaderboard({ organizationId: query.organizationId, since: from, until: to }),
      analyzeActivity({ organizationId: query.organizationId, since: from, until: to })
    ]);

  // Daily commit series, gaps filled so the chart is continuous.
  const buckets = new Map<number, { commits: number; additions: number; deletions: number }>();
  for (const commit of commits) {
    const key = startOfDay(commit.committedAt).getTime();
    const bucket = buckets.get(key) ?? { commits: 0, additions: 0, deletions: 0 };
    bucket.commits += 1;
    bucket.additions += commit.additions;
    bucket.deletions += commit.deletions;
    buckets.set(key, bucket);
  }

  const commitsOverTime: {
    date: string;
    commits: number;
    additions: number;
    deletions: number;
  }[] = [];
  let cursor = startOfDay(from);
  const endDay = startOfDay(to);
  while (cursor <= endDay && commitsOverTime.length < MAX_SERIES_POINTS) {
    const bucket = buckets.get(cursor.getTime()) ?? { commits: 0, additions: 0, deletions: 0 };
    commitsOverTime.push({ date: toLocalDateKey(cursor), ...bucket });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
  }

  // Per-repository + per-project breakdowns.
  const repos = await prisma.repository.findMany({
    where: { id: { in: byRepoGroup.map((row) => row.repositoryId) } },
    select: { id: true, fullName: true, project: { select: { id: true, name: true } } }
  });
  const repoById = new Map(repos.map((repo) => [repo.id, repo]));

  const byRepository = byRepoGroup
    .map((row) => ({
      id: row.repositoryId,
      name: repoById.get(row.repositoryId)?.fullName ?? "unknown",
      commits: row._count._all,
      additions: row._sum.additions ?? 0,
      deletions: row._sum.deletions ?? 0
    }))
    .sort((a, b) => b.commits - a.commits);

  const projectAgg = new Map<string, { id: string; name: string; commits: number }>();
  for (const row of byRepoGroup) {
    const project = repoById.get(row.repositoryId)?.project ?? null;
    const key = project?.id ?? "__none__";
    const existing = projectAgg.get(key);
    if (existing) {
      existing.commits += row._count._all;
    } else {
      projectAgg.set(key, { id: key, name: project?.name ?? "No project", commits: row._count._all });
    }
  }
  const byProject = [...projectAgg.values()].sort((a, b) => b.commits - a.commits);

  return {
    period: { from, to },
    totals: {
      commits: totals._count._all,
      additions: totals._sum.additions ?? 0,
      deletions: totals._sum.deletions ?? 0,
      filesChanged: totals._sum.changedFilesCount ?? 0,
      repositories: activeRepoRows.length,
      contributors: contributorRows.filter((row) => row.username).length
    },
    commitsOverTime,
    topContributors: leaderboard.slice(0, 8),
    byRepository: byRepository.slice(0, 8),
    byProject: byProject.slice(0, 8),
    categories: analysis.categories,
    topModules: analysis.topModules,
    risks: analysis.risks
  };
}
