/**
 * Period-over-period comparison (Report advance "A"). Pure helpers: given the
 * current and previous window's totals + leaderboards, compute headline deltas
 * and per-contributor rank movement. No IO — trivially unit-testable.
 */

export type MetricDelta = {
  current: number;
  previous: number;
  /** Percent change vs the previous period; null when there is no baseline. */
  deltaPct: number | null;
};

export type RankStatus = "up" | "down" | "same" | "new" | "dropped";

export type RankMovement = {
  name: string;
  employeeId: string | null;
  currentRank: number | null; // null = dropped (absent this period)
  previousRank: number | null; // null = new this period
  status: RankStatus;
  /** Places gained (previousRank − currentRank); null for new/dropped. */
  delta: number | null;
};

export type ReportComparison = {
  previousPeriod: { from: string; to: string };
  /** False when the previous period has no stored activity (deltas suppressed). */
  hasBaseline: boolean;
  commits: MetricDelta;
  additions: MetricDelta;
  deletions: MetricDelta;
  filesChanged: MetricDelta;
  contributors: MetricDelta;
  movers: RankMovement[];
};

export type LeaderRow = {
  name: string;
  employeeId: string | null;
  rank: number;
};

export type PeriodTotals = {
  commits: number;
  additions: number;
  deletions: number;
  filesChanged: number;
  contributors: number;
};

function metricDelta(current: number, previous: number): MetricDelta {
  const deltaPct = previous > 0 ? Math.round(((current - previous) / previous) * 100) : null;
  return { current, previous, deltaPct };
}

function identityKey(row: LeaderRow): string {
  return row.employeeId ? `emp:${row.employeeId}` : `name:${row.name.toLowerCase()}`;
}

const MAX_MOVERS = 6;

/** Ranks the "notability" of a movement so the most interesting surface first. */
function movementScore(move: RankMovement): number {
  if (move.status === "new" || move.status === "dropped") {
    return 100; // entrants/exits are always notable
  }
  return Math.abs(move.delta ?? 0);
}

export function buildComparison(params: {
  previousPeriod: { from: string; to: string };
  current: PeriodTotals;
  previous: PeriodTotals;
  currentLeaders: LeaderRow[];
  previousLeaders: LeaderRow[];
}): ReportComparison {
  const { current, previous, currentLeaders, previousLeaders } = params;

  const prevRankByKey = new Map<string, number>();
  for (const row of previousLeaders) {
    prevRankByKey.set(identityKey(row), row.rank);
  }
  const currentKeys = new Set(currentLeaders.map(identityKey));

  const movers: RankMovement[] = [];
  for (const row of currentLeaders) {
    const key = identityKey(row);
    const previousRank = prevRankByKey.get(key);
    if (previousRank === undefined) {
      movers.push({
        name: row.name,
        employeeId: row.employeeId,
        currentRank: row.rank,
        previousRank: null,
        status: "new",
        delta: null
      });
    } else {
      const delta = previousRank - row.rank;
      movers.push({
        name: row.name,
        employeeId: row.employeeId,
        currentRank: row.rank,
        previousRank,
        status: delta > 0 ? "up" : delta < 0 ? "down" : "same",
        delta
      });
    }
  }
  // Contributors present last period but gone now.
  for (const row of previousLeaders) {
    if (!currentKeys.has(identityKey(row))) {
      movers.push({
        name: row.name,
        employeeId: row.employeeId,
        currentRank: null,
        previousRank: row.rank,
        status: "dropped",
        delta: null
      });
    }
  }

  const notable = movers
    .filter((move) => move.status !== "same")
    .sort((a, b) => movementScore(b) - movementScore(a))
    .slice(0, MAX_MOVERS);

  return {
    previousPeriod: params.previousPeriod,
    hasBaseline: previous.commits > 0,
    commits: metricDelta(current.commits, previous.commits),
    additions: metricDelta(current.additions, previous.additions),
    deletions: metricDelta(current.deletions, previous.deletions),
    filesChanged: metricDelta(current.filesChanged, previous.filesChanged),
    contributors: metricDelta(current.contributors, previous.contributors),
    movers: notable
  };
}
