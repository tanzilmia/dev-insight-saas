import { describe, expect, it } from "vitest";

import {
  mergeIntervals,
  subtractCovered,
  type Interval
} from "../../src/modules/activity/coverage.js";

const iv = (start: number, end: number): Interval => ({
  start: new Date(start),
  end: new Date(end)
});
const ms = (i: Interval): [number, number] => [i.start.getTime(), i.end.getTime()];
const DAY = 24 * 60 * 60 * 1000;

describe("mergeIntervals", () => {
  it("returns [] for empty input", () => {
    expect(mergeIntervals([])).toEqual([]);
  });

  it("returns a copy (not the same object) for a single interval", () => {
    const input = [iv(10, 20)];
    const out = mergeIntervals(input);
    expect(out.map(ms)).toEqual([[10, 20]]);
    expect(out[0]).not.toBe(input[0]);
  });

  it("merges overlapping intervals", () => {
    expect(mergeIntervals([iv(0, 10), iv(5, 15)]).map(ms)).toEqual([[0, 15]]);
  });

  it("merges exactly-touching intervals (no true gap)", () => {
    expect(mergeIntervals([iv(0, 10), iv(10, 20)]).map(ms)).toEqual([[0, 20]]);
  });

  it("keeps disjoint intervals separate", () => {
    expect(mergeIntervals([iv(0, 10), iv(20, 30)]).map(ms)).toEqual([
      [0, 10],
      [20, 30]
    ]);
  });

  it("sorts unsorted input before merging", () => {
    expect(mergeIntervals([iv(20, 30), iv(0, 10), iv(5, 8)]).map(ms)).toEqual([
      [0, 10],
      [20, 30]
    ]);
  });

  it("absorbs a fully-contained interval", () => {
    expect(mergeIntervals([iv(0, 100), iv(20, 30)]).map(ms)).toEqual([[0, 100]]);
  });
});

describe("subtractCovered", () => {
  it("returns the whole window when nothing is covered", () => {
    expect(subtractCovered(new Date(0), new Date(100), []).map(ms)).toEqual([[0, 100]]);
  });

  it("returns [] when the window is fully covered", () => {
    expect(subtractCovered(new Date(10), new Date(20), [iv(0, 100)])).toEqual([]);
  });

  it("returns [] for a zero/negative window (start >= end)", () => {
    expect(subtractCovered(new Date(50), new Date(50), [])).toEqual([]);
    expect(subtractCovered(new Date(60), new Date(50), [])).toEqual([]);
  });

  it("returns the gap before a covered tail", () => {
    expect(subtractCovered(new Date(0), new Date(100), [iv(40, 100)]).map(ms)).toEqual([[0, 40]]);
  });

  it("returns the gap after a covered head", () => {
    expect(subtractCovered(new Date(0), new Date(100), [iv(0, 40)]).map(ms)).toEqual([[40, 100]]);
  });

  it("returns the middle gaps between two covered chunks", () => {
    expect(
      subtractCovered(new Date(0), new Date(100), [iv(0, 20), iv(60, 80)]).map(ms)
    ).toEqual([
      [20, 60],
      [80, 100]
    ]);
  });

  it("clips a covered interval that spills outside the requested window", () => {
    expect(subtractCovered(new Date(0), new Date(100), [iv(-50, 30)]).map(ms)).toEqual([[30, 100]]);
  });

  it("the ledger's headline case: ask 15 days when 30 are already collected -> no gaps", () => {
    const covered = [iv(0, 30 * DAY)];
    expect(subtractCovered(new Date(10 * DAY), new Date(25 * DAY), covered)).toEqual([]);
  });
});
