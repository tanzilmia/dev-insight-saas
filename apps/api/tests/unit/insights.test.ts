import { describe, expect, it } from "vitest";

import type { ReportComparison } from "../../src/modules/report-engine/comparison.js";
import { buildInsights, type InsightLeader } from "../../src/modules/report-engine/insights.js";

const baseComparison = (over: Partial<ReportComparison> = {}): ReportComparison => ({
  previousPeriod: { from: "a", to: "b" },
  hasBaseline: true,
  commits: { current: 100, previous: 100, deltaPct: 0 },
  additions: { current: 0, previous: 0, deltaPct: null },
  deletions: { current: 0, previous: 0, deltaPct: null },
  filesChanged: { current: 0, previous: 0, deltaPct: null },
  contributors: { current: 0, previous: 0, deltaPct: null },
  movers: [],
  ...over
});

describe("buildInsights", () => {
  it("flags a volume swing beyond 25% (down = warn)", () => {
    const insights = buildInsights({
      activity: { commits: 60 },
      analysis: null,
      leaderboard: [],
      comparison: baseComparison({ commits: { current: 60, previous: 100, deltaPct: -40 } })
    });
    const volume = insights.find((i) => i.kind === "volume");
    expect(volume?.severity).toBe("warn");
    expect(volume?.text).toMatch(/down 40%/);
  });

  it("ignores a small volume change under the threshold", () => {
    const insights = buildInsights({
      activity: { commits: 110 },
      analysis: null,
      leaderboard: [],
      comparison: baseComparison({ commits: { current: 110, previous: 100, deltaPct: 10 } })
    });
    expect(insights.find((i) => i.kind === "volume")).toBeUndefined();
  });

  it("surfaces analysis risk signals as warnings", () => {
    const insights = buildInsights({
      activity: { commits: 10 },
      analysis: { categories: {}, risks: ["2 commits flagged by keyword", "1 large commit"] },
      leaderboard: []
    });
    expect(insights.filter((i) => i.kind === "risk")).toHaveLength(2);
  });

  it("flags work concentration (bus-factor) when the top person has >= 60% of lines", () => {
    const leaderboard: InsightLeader[] = [
      { name: "Alice", lines: 800 },
      { name: "Bob", lines: 200 }
    ];
    const insights = buildInsights({ activity: { commits: 10 }, analysis: null, leaderboard });
    expect(insights.find((i) => i.kind === "concentration")?.text).toMatch(/Alice produced 80%/);
  });

  it("flags work-type skew for a dominant category (>= 50%)", () => {
    const insights = buildInsights({
      activity: { commits: 10 },
      analysis: { categories: { Fix: 8, Feature: 2 }, risks: [] },
      leaderboard: []
    });
    expect(insights.find((i) => i.kind === "worktype")?.text).toMatch(/toward Fix \(80%/);
  });

  it("flags off-hours work (>= 30% of >= 5 analyzed commits)", () => {
    const insights = buildInsights({
      activity: { commits: 10 },
      analysis: { categories: {}, risks: [], analyzedCommits: 10, offHoursCommits: 4 },
      leaderboard: []
    });
    expect(insights.find((i) => i.kind === "off-hours")?.severity).toBe("warn");
  });

  it("flags dependency/generated churn when noise share >= 50%", () => {
    const insights = buildInsights({
      activity: { commits: 10 },
      analysis: { categories: {}, risks: [], noiseChangeShare: 0.7 },
      leaderboard: []
    });
    expect(insights.find((i) => i.kind === "dependency-churn")?.text).toMatch(/70%/);
  });

  it("caps the list at 6 insights even when everything fires", () => {
    const insights = buildInsights({
      activity: { commits: 10 },
      analysis: {
        categories: { Fix: 10 },
        risks: ["r1", "r2"],
        analyzedCommits: 10,
        offHoursCommits: 9,
        noiseChangeShare: 0.9
      },
      leaderboard: [
        { name: "Alice", lines: 900 },
        { name: "Bob", lines: 100 }
      ],
      comparison: baseComparison({
        commits: { current: 200, previous: 100, deltaPct: 100 },
        movers: [
          { name: "New1", employeeId: null, currentRank: 1, previousRank: null, status: "new", delta: null },
          { name: "Gone1", employeeId: null, currentRank: null, previousRank: 2, status: "dropped", delta: null }
        ]
      })
    });
    expect(insights.length).toBeLessThanOrEqual(6);
  });
});
