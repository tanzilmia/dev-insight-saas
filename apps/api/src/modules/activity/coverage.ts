/**
 * Pure interval math for the coverage ledger (Phase B). Kept free of Prisma so
 * it is trivially testable. An {@link Interval} is a closed [start, end] window.
 */
export type Interval = { start: Date; end: Date };

/**
 * Merges overlapping (or exactly touching) intervals into a minimal sorted set.
 * Two intervals merge when the later one starts at or before the earlier one's
 * end — i.e. there is no true gap between them.
 */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length <= 1) {
    return intervals.map((interval) => ({ ...interval }));
  }

  const sorted = [...intervals].sort(
    (a, b) => a.start.getTime() - b.start.getTime()
  );

  const merged: Interval[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i]!;
    const last = merged[merged.length - 1]!;
    if (current.start.getTime() <= last.end.getTime()) {
      // Overlap or touch → extend the running interval.
      if (current.end.getTime() > last.end.getTime()) {
        last.end = current.end;
      }
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

/**
 * Returns the sub-intervals of [from, to] that are NOT covered by `covered`.
 * These are the ranges the report engine (Phase C) still has to fetch from Git;
 * an empty result means the whole window is already in the DB.
 */
export function subtractCovered(from: Date, to: Date, covered: Interval[]): Interval[] {
  const start = from.getTime();
  const end = to.getTime();
  if (start >= end) {
    return [];
  }

  const gaps: Interval[] = [];
  let cursor = start;

  const relevant = mergeIntervals(covered)
    .filter((interval) => interval.end.getTime() > start && interval.start.getTime() < end)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  for (const interval of relevant) {
    const intervalStart = interval.start.getTime();
    const intervalEnd = interval.end.getTime();
    if (intervalStart > cursor) {
      gaps.push({ start: new Date(cursor), end: new Date(Math.min(intervalStart, end)) });
    }
    if (intervalEnd > cursor) {
      cursor = intervalEnd;
    }
    if (cursor >= end) {
      break;
    }
  }

  if (cursor < end) {
    gaps.push({ start: new Date(cursor), end: new Date(end) });
  }

  return gaps;
}
