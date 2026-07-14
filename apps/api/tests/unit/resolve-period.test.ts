import { describe, expect, it } from "vitest";

import { resolvePeriod } from "../../src/modules/openclaw/openclaw.tools.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const hms = (d: Date): [number, number, number, number] => [
  d.getHours(),
  d.getMinutes(),
  d.getSeconds(),
  d.getMilliseconds()
];

describe("resolvePeriod", () => {
  it("parses a custom range as inclusive whole LOCAL days", () => {
    const { from, to } = resolvePeriod("custom", { from: "2026-03-01", to: "2026-03-31" });
    expect(from.getFullYear()).toBe(2026);
    expect(from.getMonth()).toBe(2); // March (0-based)
    expect(from.getDate()).toBe(1);
    expect(hms(from)).toEqual([0, 0, 0, 0]); // start of day
    expect(to.getDate()).toBe(31);
    expect(hms(to)).toEqual([23, 59, 59, 999]); // inclusive end of day
  });

  it("throws when a custom range is missing", () => {
    expect(() => resolvePeriod("custom")).toThrow(/Custom range is required/);
  });

  it("throws when the custom range is inverted (from > to)", () => {
    expect(() => resolvePeriod("custom", { from: "2026-03-31", to: "2026-03-01" })).toThrow(
      /on or before/
    );
  });

  it("today starts at local midnight on the current date", () => {
    const { from } = resolvePeriod("today");
    expect(hms(from)).toEqual([0, 0, 0, 0]);
    expect(from.getDate()).toBe(new Date().getDate());
  });

  it("last_month spans the full previous calendar month", () => {
    const now = new Date();
    const { from, to } = resolvePeriod("last_month");
    expect(from.getTime()).toBe(new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime());
    expect(from.getDate()).toBe(1);
    // `to` is the last millisecond before this month begins
    expect(to.getTime()).toBe(new Date(now.getFullYear(), now.getMonth(), 1).getTime() - 1);
  });

  it("this_month starts on the 1st at local midnight", () => {
    const now = new Date();
    expect(resolvePeriod("this_month").from.getTime()).toBe(
      new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    );
  });

  it("relative windows look back the right number of days", () => {
    const spanDays = (period: Parameters<typeof resolvePeriod>[0]): number => {
      const { from, to } = resolvePeriod(period);
      return Math.round((to.getTime() - from.getTime()) / DAY_MS);
    };
    expect(spanDays("last_7_days")).toBe(7);
    expect(spanDays("last_30_days")).toBe(30);
    expect(spanDays("last_90_days")).toBe(90);
  });
});
