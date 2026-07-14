import { describe, expect, it } from "vitest";

import {
  buildComparison,
  type LeaderRow,
  type PeriodTotals
} from "../../src/modules/report-engine/comparison.js";

const totals = (commits: number, extra: Partial<PeriodTotals> = {}): PeriodTotals => ({
  commits,
  additions: 0,
  deletions: 0,
  filesChanged: 0,
  contributors: 0,
  ...extra
});
const leader = (name: string, rank: number, employeeId: string | null = null): LeaderRow => ({
  name,
  rank,
  employeeId
});
const previousPeriod = { from: "2026-01-01", to: "2026-01-31" };

describe("buildComparison", () => {
  it("computes percentage deltas for headline metrics", () => {
    const c = buildComparison({
      previousPeriod,
      current: totals(120, { additions: 200 }),
      previous: totals(100, { additions: 100 }),
      currentLeaders: [],
      previousLeaders: []
    });
    expect(c.commits).toEqual({ current: 120, previous: 100, deltaPct: 20 });
    expect(c.additions.deltaPct).toBe(100);
  });

  it("suppresses deltaPct (null) and hasBaseline when the previous period is empty", () => {
    const c = buildComparison({
      previousPeriod,
      current: totals(10),
      previous: totals(0),
      currentLeaders: [],
      previousLeaders: []
    });
    expect(c.commits.deltaPct).toBeNull();
    expect(c.hasBaseline).toBe(false);
  });

  it("sets hasBaseline true only when the previous period had commits", () => {
    const c = buildComparison({
      previousPeriod,
      current: totals(5),
      previous: totals(3),
      currentLeaders: [],
      previousLeaders: []
    });
    expect(c.hasBaseline).toBe(true);
  });

  it("labels rank movement: up / down / new / dropped", () => {
    const c = buildComparison({
      previousPeriod,
      current: totals(10),
      previous: totals(10),
      currentLeaders: [leader("Alice", 1, "e1"), leader("Bob", 2, "e2"), leader("Carol", 3, "e3")],
      previousLeaders: [leader("Bob", 1, "e2"), leader("Alice", 2, "e1"), leader("Dan", 3, "e4")]
    });
    const byName = Object.fromEntries(c.movers.map((m) => [m.name, m]));
    expect(byName.Alice?.status).toBe("up"); // 2 -> 1
    expect(byName.Alice?.delta).toBe(1);
    expect(byName.Bob?.status).toBe("down"); // 1 -> 2
    expect(byName.Carol?.status).toBe("new"); // absent last period
    expect(byName.Dan?.status).toBe("dropped"); // gone this period
  });

  it("drops 'same' movers and caps the list at 6", () => {
    const current: LeaderRow[] = [];
    const previous: LeaderRow[] = [];
    for (let i = 1; i <= 10; i += 1) {
      current.push(leader(`p${i}`, i, `e${i}`));
      previous.push(leader(`p${i}`, i === 1 ? 10 : i - 1, `e${i}`)); // everyone moves
    }
    const c = buildComparison({
      previousPeriod,
      current: totals(10),
      previous: totals(10),
      currentLeaders: current,
      previousLeaders: previous
    });
    expect(c.movers.length).toBeLessThanOrEqual(6);
    expect(c.movers.every((m) => m.status !== "same")).toBe(true);
  });

  it("matches unmapped contributors by lower-cased name", () => {
    const c = buildComparison({
      previousPeriod,
      current: totals(5),
      previous: totals(5),
      currentLeaders: [leader("Rahim", 1, null)],
      previousLeaders: [leader("rahim", 2, null)]
    });
    expect(c.movers[0]?.status).toBe("up");
  });
});
