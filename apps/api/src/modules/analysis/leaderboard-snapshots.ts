import type { SnapshotGranularity } from "@prisma/client";

import { prisma } from "../../config/database.js";
import { requireOrganizationMember } from "../../common/access/organization-access.js";
import { buildEmployeeLeaderboard } from "../activity/activity.service.js";
import { toLocalDateKey } from "../statistics/statistics.service.js";
import type { LeaderboardHistoryQuery } from "./analysis.schemas.js";

/** A concrete, completed period to snapshot. */
export type PeriodTarget = {
  granularity: SnapshotGranularity;
  periodKey: string;
  rangeStart: Date;
  rangeEnd: Date;
};

/* ----------------------------- period helpers ----------------------------- */
// All ranges are computed in the server's local time (consistent with
// `toLocalDateKey` and the coverage/analysis code). `rangeEnd` is the last
// millisecond of the period so a `committedAt <= rangeEnd` filter is inclusive.

export function dayRange(date: Date): PeriodTarget {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 0, 0);
  return {
    granularity: "DAILY",
    periodKey: toLocalDateKey(start),
    rangeStart: start,
    rangeEnd: new Date(next.getTime() - 1)
  };
}

/** ISO week: weeks start Monday; week 1 holds the year's first Thursday. */
function isoWeekKey(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  d.setDate(d.getDate() - dow + 3); // Thursday of this week decides the ISO year
  const isoYear = d.getFullYear();
  const firstThursday = new Date(isoYear, 0, 4);
  const firstDow = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDow + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

export function weekRange(date: Date): PeriodTarget {
  const dow = (date.getDay() + 6) % 7; // Mon=0 … Sun=6
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - dow, 0, 0, 0, 0);
  const nextMonday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7, 0, 0, 0, 0);
  return {
    granularity: "WEEKLY",
    periodKey: isoWeekKey(monday),
    rangeStart: monday,
    rangeEnd: new Date(nextMonday.getTime() - 1)
  };
}

export function monthRange(date: Date): PeriodTarget {
  const start = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1, 0, 0, 0, 0);
  return {
    granularity: "MONTHLY",
    periodKey: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
    rangeStart: start,
    rangeEnd: new Date(nextMonth.getTime() - 1)
  };
}

const DAY_MS = 86_400_000;
// Bounded backfill so a first sweep (or one after downtime) fills recent gaps
// without unbounded work; steady state writes one new period per granularity.
const BACKFILL_DAYS = 14;
const BACKFILL_WEEKS = 4;
const BACKFILL_MONTHS = 3;
const MAX_SNAPSHOT_ROWS = 50;

/** Completed periods (rangeEnd < now) we want a snapshot for, newest first. */
export function dueTargets(now: Date): PeriodTarget[] {
  const targets: PeriodTarget[] = [];
  const seen = new Set<string>();
  const push = (t: PeriodTarget) => {
    const key = `${t.granularity}|${t.periodKey}`;
    if (t.rangeEnd < now && !seen.has(key)) {
      seen.add(key);
      targets.push(t);
    }
  };

  for (let i = 1; i <= BACKFILL_DAYS; i += 1) {
    push(dayRange(new Date(now.getTime() - i * DAY_MS)));
  }
  for (let i = 1; i <= BACKFILL_WEEKS; i += 1) {
    push(weekRange(new Date(now.getTime() - i * 7 * DAY_MS)));
  }
  for (let i = 1; i <= BACKFILL_MONTHS; i += 1) {
    push(monthRange(new Date(now.getFullYear(), now.getMonth() - i, 15)));
  }
  return targets;
}

type Scope = { scope: string; projectId?: string; projectName: string | null };

async function writeSnapshot(
  organizationId: string,
  scope: Scope,
  target: PeriodTarget
): Promise<boolean> {
  const leaderboard = await buildEmployeeLeaderboard(
    {
      organizationId,
      projectId: scope.projectId,
      since: target.rangeStart,
      until: target.rangeEnd
    },
    0 // no sample messages needed for a snapshot
  );

  const rows = leaderboard.slice(0, MAX_SNAPSHOT_ROWS);
  const totalCommits = rows.reduce((sum, row) => sum + row.commits, 0);
  const totalLines = rows.reduce((sum, row) => sum + row.lines, 0);

  try {
    await prisma.leaderboardSnapshot.create({
      data: {
        organizationId,
        scope: scope.scope,
        projectName: scope.projectName,
        granularity: target.granularity,
        periodKey: target.periodKey,
        rangeStart: target.rangeStart,
        rangeEnd: target.rangeEnd,
        totalCommits,
        totalLines,
        contributors: rows.length,
        rows: {
          create: rows.map((row) => ({
            userId: row.employeeId,
            name: row.name,
            usernames: row.usernames,
            rank: row.rank,
            commits: row.commits,
            additions: row.additions,
            deletions: row.deletions,
            lines: row.lines,
            filesChanged: row.filesChanged
          }))
        }
      }
    });
    return true;
  } catch (error) {
    // Unique-constraint race (another instance wrote the same snapshot) → skip.
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return false;
    }
    throw error;
  }
}

/**
 * Idempotent leaderboard-snapshot sweep (Phase 3a). For each organization and
 * scope (org-wide + each active project), ensures a snapshot exists for every
 * recently-completed day/week/month. Existing snapshots are skipped, so this is
 * cheap to run repeatedly; the first run backfills a bounded window. Returns the
 * number of snapshots written.
 */
export async function writeDueSnapshots(now: Date = new Date()): Promise<number> {
  const targets = dueTargets(now);
  if (!targets.length) {
    return 0;
  }
  const targetKeys = targets.map((t) => t.periodKey);

  const organizations = await prisma.organization.findMany({ select: { id: true } });
  let written = 0;

  for (const org of organizations) {
    const projects = await prisma.project.findMany({
      where: { organizationId: org.id, status: "ACTIVE" },
      select: { id: true, name: true }
    });
    const scopes: Scope[] = [
      { scope: "org", projectId: undefined, projectName: null },
      ...projects.map((p) => ({ scope: p.id, projectId: p.id, projectName: p.name }))
    ];

    const existing = await prisma.leaderboardSnapshot.findMany({
      where: { organizationId: org.id, periodKey: { in: targetKeys } },
      select: { scope: true, granularity: true, periodKey: true }
    });
    const have = new Set(existing.map((s) => `${s.scope}|${s.granularity}|${s.periodKey}`));

    for (const scope of scopes) {
      for (const target of targets) {
        if (have.has(`${scope.scope}|${target.granularity}|${target.periodKey}`)) {
          continue;
        }
        if (await writeSnapshot(org.id, scope, target)) {
          written += 1;
        }
      }
    }
  }

  return written;
}

const HISTORY_ROWS_PER_SNAPSHOT = 10;

/**
 * Leaderboard-snapshot history for a scope (org-wide or a project), newest
 * first — the data behind trend/history views. Read-only, org-member gated.
 */
export async function getLeaderboardHistory(actorId: string, query: LeaderboardHistoryQuery) {
  await requireOrganizationMember(actorId, query.organizationId);

  const snapshots = await prisma.leaderboardSnapshot.findMany({
    where: {
      organizationId: query.organizationId,
      scope: query.scope,
      granularity: query.granularity
    },
    orderBy: { rangeStart: "desc" },
    take: query.limit,
    include: {
      rows: {
        orderBy: { rank: "asc" },
        take: HISTORY_ROWS_PER_SNAPSHOT
      }
    }
  });

  return snapshots.map((snapshot) => ({
    id: snapshot.id,
    scope: snapshot.scope,
    projectName: snapshot.projectName,
    granularity: snapshot.granularity,
    periodKey: snapshot.periodKey,
    rangeStart: snapshot.rangeStart,
    rangeEnd: snapshot.rangeEnd,
    totalCommits: snapshot.totalCommits,
    totalLines: snapshot.totalLines,
    contributors: snapshot.contributors,
    rows: snapshot.rows.map((row) => ({
      userId: row.userId,
      name: row.name,
      usernames: row.usernames,
      rank: row.rank,
      commits: row.commits,
      lines: row.lines,
      filesChanged: row.filesChanged
    }))
  }));
}
