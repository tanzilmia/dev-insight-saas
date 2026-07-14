import { describe, expect, it } from "vitest";

import { computeNextRun, type NextRunSpec } from "../../src/modules/schedules/schedules.service.js";

/** The HH:MM wall-clock an instant shows in a given IANA zone. */
const wallClock = (date: Date, timeZone: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date);

const spec = (over: Partial<NextRunSpec> = {}): NextRunSpec => ({
  cadence: "DAILY",
  runHour: 9,
  runMinute: 0,
  timeZone: "UTC",
  ...over
});

describe("computeNextRun", () => {
  it("returns today's target time when it is still in the future", () => {
    const from = new Date(Date.UTC(2026, 5, 1, 6, 0, 0)); // 06:00 UTC, target 09:00 later today
    expect(computeNextRun(from, spec()).toISOString()).toBe("2026-06-01T09:00:00.000Z");
  });

  it("advances to tomorrow (DAILY) once today's target has passed", () => {
    const from = new Date(Date.UTC(2026, 5, 1, 10, 0, 0)); // 10:00 UTC, past 09:00
    expect(computeNextRun(from, spec()).toISOString()).toBe("2026-06-02T09:00:00.000Z");
  });

  it("advances 7 days for WEEKLY", () => {
    const from = new Date(Date.UTC(2026, 5, 1, 10, 0, 0));
    expect(computeNextRun(from, spec({ cadence: "WEEKLY" })).toISOString()).toBe(
      "2026-06-08T09:00:00.000Z"
    );
  });

  it("clamps a MONTHLY Jan-31 schedule to Feb-28 instead of skipping February", () => {
    const from = new Date(Date.UTC(2026, 0, 31, 10, 0, 0)); // Jan 31 2026 (not a leap year)
    expect(computeNextRun(from, spec({ cadence: "MONTHLY" })).toISOString()).toBe(
      "2026-02-28T09:00:00.000Z"
    );
  });

  it("keeps a stable local wall clock across a US spring-forward DST boundary", () => {
    // US DST 2026 begins Sun Mar 8. A daily 09:00 America/New_York schedule the
    // day before must still fire at 09:00 local the next day, despite the offset
    // shifting EST(-5) -> EDT(-4).
    const tz = "America/New_York";
    const from = new Date(Date.UTC(2026, 2, 7, 20, 0, 0)); // Mar 7, after 09:00 EST
    expect(wallClock(computeNextRun(from, spec({ timeZone: tz })), tz)).toBe("09:00");
  });

  it("respects a non-DST zone (Asia/Dhaka, always +06:00)", () => {
    const tz = "Asia/Dhaka";
    const from = new Date(Date.UTC(2026, 5, 1, 5, 0, 0)); // 11:00 Dhaka, past 09:00
    const next = computeNextRun(from, spec({ timeZone: tz }));
    expect(wallClock(next, tz)).toBe("09:00");
    expect(next.toISOString()).toBe("2026-06-02T03:00:00.000Z"); // 09:00 Dhaka == 03:00 UTC
  });
});
