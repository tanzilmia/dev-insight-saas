import { describe, expect, it } from "vitest";

import {
  activityLevel,
  buildCaveats,
  buildPlainSummary,
  humanizeArea,
  humanizeAreas,
  humanizeWorkMix
} from "../../src/modules/report-engine/plain-language.js";

describe("activityLevel", () => {
  it("returns quiet for no commits", () => {
    expect(activityLevel(0, 30)).toEqual({ level: "quiet", label: "No activity" });
  });

  it("scales by updates-per-day, not by raw count", () => {
    expect(activityLevel(15, 30).level).toBe("light"); // 0.5/day
    expect(activityLevel(60, 30).level).toBe("steady"); // 2/day
    expect(activityLevel(180, 30).level).toBe("busy"); // 6/day
    expect(activityLevel(15, 1).level).toBe("very-busy"); // 15/day
  });
});

describe("humanizeWorkMix", () => {
  it("prefixes 'mostly' when the leader is >= 50%", () => {
    const mix = humanizeWorkMix({ Fix: 6, Feature: 4 });
    expect(mix.text).toBe("mostly bug fixes (60%), new features (40%)");
    expect(mix.top).toHaveLength(2);
  });

  it("omits 'mostly' when the leader is under 50%", () => {
    expect(humanizeWorkMix({ Fix: 4, Feature: 3, Refactor: 3 }).text.startsWith("mostly")).toBe(false);
  });

  it("keeps only the top 3 categories by share", () => {
    expect(humanizeWorkMix({ Fix: 5, Feature: 4, Refactor: 3, Docs: 2, Test: 1 }).top).toHaveLength(3);
  });

  it("returns empty for no activity", () => {
    expect(humanizeWorkMix({}).text).toBe("");
    expect(humanizeWorkMix({ Fix: 0 }).top).toEqual([]);
  });
});

describe("humanizeArea / humanizeAreas", () => {
  it("maps known directories to business names", () => {
    expect(humanizeArea("api")).toBe("Backend");
    expect(humanizeArea("prisma")).toBe("Database");
    expect(humanizeArea("components")).toBe("UI components");
  });

  it("title-cases unknown directories", () => {
    expect(humanizeArea("billing")).toBe("Billing");
  });

  it("de-duplicates areas mapping to the same label, preserving first-seen order", () => {
    expect(
      humanizeAreas([{ module: "api" }, { module: "server" }, { module: "web" }])
    ).toEqual(["Backend", "Frontend"]);
  });
});

describe("buildPlainSummary", () => {
  it("handles zero activity with actionable guidance", () => {
    const summary = buildPlainSummary({
      commits: 0,
      days: 30,
      contributors: 0,
      workMixText: "",
      topAreas: [],
      topContributor: null,
      commitsDeltaPct: null,
      attentionCount: 0
    });
    expect(summary).toMatch(/No development activity/);
  });

  it("weaves people / updates / mix / leader / trend / attention together", () => {
    const summary = buildPlainSummary({
      commits: 127,
      days: 31,
      contributors: 3,
      workMixText: "mostly bug fixes (45%)",
      topAreas: ["Backend"],
      topContributor: "Rahim",
      commitsDeltaPct: 20,
      attentionCount: 2
    });
    expect(summary).toMatch(/3 people made 127 updates over 31 days/);
    expect(summary).toMatch(/Rahim was the most active/);
    expect(summary).toMatch(/up 20%/);
    expect(summary).toMatch(/2 items may need a closer look/);
  });

  it("uses singular grammar for one person / day / item", () => {
    const summary = buildPlainSummary({
      commits: 1,
      days: 1,
      contributors: 1,
      workMixText: "",
      topAreas: [],
      topContributor: null,
      commitsDeltaPct: null,
      attentionCount: 1
    });
    expect(summary).toMatch(/1 person made 1 update over 1 day\./);
    expect(summary).toMatch(/1 item may need/);
  });
});

describe("buildCaveats", () => {
  it("notes a missing baseline, unlinked contributors and skipped repos", () => {
    const caveats = buildCaveats({
      hasBaseline: false,
      unmappedContributors: 2,
      skippedRepositories: 1
    });
    expect(caveats).toHaveLength(3);
    expect(caveats[0]).toMatch(/previous period/);
    expect(caveats[1]).toMatch(/2 contributors aren't linked/);
    expect(caveats[2]).toMatch(/1 repository couldn't be read/);
  });

  it("is empty when everything is clean", () => {
    expect(
      buildCaveats({ hasBaseline: true, unmappedContributors: 0, skippedRepositories: 0 })
    ).toEqual([]);
  });
});
