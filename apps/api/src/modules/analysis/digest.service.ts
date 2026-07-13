import { prisma } from "../../config/database.js";
import { requireOrganizationMember } from "../../common/access/organization-access.js";
import {
  aggregateActivity,
  analyzeActivity,
  buildEmployeeLeaderboard,
  type EmployeeLeaderboardRow
} from "../activity/activity.service.js";
import { toLocalDateKey } from "../statistics/statistics.service.js";
import { dayRange } from "./leaderboard-snapshots.js";
import type { DigestQuery } from "./analysis.schemas.js";

const DAY_MS = 86_400_000;
const TOP_MOVERS = 5;
const STREAK_LOOKBACK_DAYS = 21;

/** Stable identity across two days: the mapped employee, else the display name. */
function identityKey(row: { employeeId: string | null; name: string }): string {
  return row.employeeId ? `emp:${row.employeeId}` : `name:${row.name.toLowerCase()}`;
}

type TopMover = {
  name: string;
  userId: string | null;
  usernames: string[];
  rank: number;
  commits: number;
  lines: number;
  /** Places gained vs the day before; null = not ranked yesterday (new). */
  rankDelta: number | null;
  /** Consecutive active days ending on the digest day (from commit history). */
  streak: number;
};

/**
 * Computes each top mover's active-day streak ending on `endKey`, from the org's
 * commit history over a bounded lookback. Robust (doesn't require snapshots).
 */
async function computeStreaks(
  organizationId: string,
  movers: EmployeeLeaderboardRow[],
  since: Date,
  endKey: string
): Promise<Map<string, number>> {
  const usernames = [...new Set(movers.flatMap((m) => m.usernames))];
  const streaks = new Map<string, number>();
  if (!usernames.length) {
    return streaks;
  }

  const commits = await prisma.commit.findMany({
    where: {
      repository: { organizationId },
      username: { in: usernames },
      committedAt: { gte: since }
    },
    select: { username: true, committedAt: true }
  });

  const daysByUsername = new Map<string, Set<string>>();
  for (const commit of commits) {
    if (!commit.username) {
      continue;
    }
    const set = daysByUsername.get(commit.username) ?? new Set<string>();
    set.add(toLocalDateKey(commit.committedAt));
    daysByUsername.set(commit.username, set);
  }

  for (const mover of movers) {
    const days = new Set<string>();
    for (const username of mover.usernames) {
      for (const key of daysByUsername.get(username) ?? []) {
        days.add(key);
      }
    }
    // Walk back from the digest day while each day has activity.
    let streak = 0;
    const cursor = new Date(`${endKey}T00:00:00`);
    while (days.has(toLocalDateKey(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    streaks.set(identityKey({ employeeId: mover.employeeId, name: mover.name }), streak);
  }

  return streaks;
}

/**
 * Daily digest (Phase 3b) — an org-wide "yesterday in review": headline totals,
 * the day's top movers with rank-deltas vs the day before and active-day
 * streaks, the volume trend, and risk signals. Org-member gated. Computed live
 * (adjacent-day leaderboards) so it works even before any snapshot exists.
 */
export async function getDailyDigest(actorId: string, query: DigestQuery) {
  await requireOrganizationMember(actorId, query.organizationId);

  const now = new Date();
  const yesterday = dayRange(new Date(now.getTime() - DAY_MS));
  const dayBefore = dayRange(new Date(now.getTime() - 2 * DAY_MS));

  const scope = { organizationId: query.organizationId };
  const yRange = { since: yesterday.rangeStart, until: yesterday.rangeEnd };
  const dRange = { since: dayBefore.rangeStart, until: dayBefore.rangeEnd };

  const [totals, prevTotals, board, prevBoard, analysis, repoGroups] = await Promise.all([
    aggregateActivity({ ...scope, ...yRange }),
    aggregateActivity({ ...scope, ...dRange }),
    buildEmployeeLeaderboard({ ...scope, ...yRange }, 0),
    buildEmployeeLeaderboard({ ...scope, ...dRange }, 0),
    analyzeActivity({ ...scope, ...yRange }),
    prisma.commit.groupBy({
      by: ["repositoryId"],
      where: {
        repository: { organizationId: query.organizationId },
        committedAt: { gte: yesterday.rangeStart, lte: yesterday.rangeEnd }
      }
    })
  ]);

  const prevRankByIdentity = new Map<string, number>();
  for (const row of prevBoard) {
    prevRankByIdentity.set(identityKey(row), row.rank);
  }

  const moverRows = board.slice(0, TOP_MOVERS);
  const streaks = await computeStreaks(
    query.organizationId,
    moverRows,
    new Date(now.getTime() - STREAK_LOOKBACK_DAYS * DAY_MS),
    yesterday.periodKey
  );

  const topMovers: TopMover[] = moverRows.map((row) => {
    const key = identityKey(row);
    const prevRank = prevRankByIdentity.get(key);
    return {
      name: row.name,
      userId: row.employeeId,
      usernames: row.usernames,
      rank: row.rank,
      commits: row.commits,
      lines: row.lines,
      rankDelta: prevRank === undefined ? null : prevRank - row.rank,
      streak: streaks.get(key) ?? 0
    };
  });

  const deltaPct =
    prevTotals.commits > 0
      ? Math.round(((totals.commits - prevTotals.commits) / prevTotals.commits) * 100)
      : null;

  return {
    date: yesterday.periodKey,
    range: { from: yesterday.rangeStart, to: yesterday.rangeEnd },
    hasActivity: totals.commits > 0,
    headline: {
      commits: totals.commits,
      additions: totals.additions,
      deletions: totals.deletions,
      filesChanged: totals.filesChanged,
      contributors: board.length,
      activeRepos: repoGroups.length
    },
    trend: { commitsPrev: prevTotals.commits, deltaPct },
    topMovers,
    risks: analysis.risks,
    categories: analysis.categories
  };
}
