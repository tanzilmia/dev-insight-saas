"use client";

import { useEffect, useState } from "react";
import { History, Loader2 } from "lucide-react";

import {
  type LeaderboardSnapshot,
  type SnapshotGranularity,
  getApiErrorMessage,
  getLeaderboardHistory
} from "@/lib/api";
import { AreaChart, BarList } from "./charts";

const GRANULARITIES: { value: SnapshotGranularity; label: string }[] = [
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" }
];

const METRICS = [
  { value: "commits", label: "Commits" },
  { value: "lines", label: "Lines" }
] as const;

type Metric = (typeof METRICS)[number]["value"];

/**
 * Team-output trend over completed periods, read from the leaderboard snapshots
 * the scheduler writes. Self-loading; `scope` is "org" (default) or a projectId.
 */
export function LeaderboardHistoryPanel({
  organizationId,
  scope = "org",
  title = "Team output over time"
}: {
  organizationId: string | undefined;
  scope?: string;
  title?: string;
}) {
  const [granularity, setGranularity] = useState<SnapshotGranularity>("MONTHLY");
  const [metric, setMetric] = useState<Metric>("commits");
  const [snapshots, setSnapshots] = useState<LeaderboardSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // setState only inside .then/.catch/.finally (deferred) so this is safe to call
  // from an effect (react-hooks/set-state-in-effect). `loading` starts true; a
  // granularity change resets it in the button handler (an event, not the effect).
  useEffect(() => {
    if (!organizationId) {
      return;
    }
    getLeaderboardHistory(organizationId, scope, granularity, granularity === "DAILY" ? 30 : 12)
      .then((data) => {
        setSnapshots(data);
        setError(null);
      })
      .catch((caught) => setError(getApiErrorMessage(caught)))
      .finally(() => setLoading(false));
  }, [organizationId, scope, granularity]);

  function changeGranularity(value: SnapshotGranularity) {
    if (value === granularity) return;
    setLoading(true);
    setGranularity(value);
  }

  // Snapshots arrive newest-first; a trend chart reads oldest → newest.
  const ordered = [...snapshots].reverse();
  const series = ordered.map((snapshot) => ({
    date: snapshot.periodKey,
    value: metric === "commits" ? snapshot.totalCommits : snapshot.totalLines
  }));
  const latest = snapshots[0];
  const latestRows = (latest?.rows ?? []).map((row) => ({
    label: row.name,
    value: metric === "commits" ? row.commits : row.lines,
    sub: `#${row.rank}`
  }));

  return (
    <div className="glass rounded-xl p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <History size={16} className="text-(--accent)" />
          <h2 className="text-sm font-bold text-(--text)">{title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-(--border) bg-(--surface-soft) p-0.5 text-xs font-bold">
            {METRICS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setMetric(option.value)}
                className={`rounded-md px-2 py-1 transition ${
                  metric === option.value
                    ? "bg-(--accent) text-white"
                    : "text-(--muted) hover:text-(--text)"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-lg border border-(--border) bg-(--surface-soft) p-0.5 text-xs font-bold">
            {GRANULARITIES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => changeGranularity(option.value)}
                className={`rounded-md px-2 py-1 transition ${
                  granularity === option.value
                    ? "bg-(--accent) text-white"
                    : "text-(--muted) hover:text-(--text)"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error ? (
        <p className="mb-3 text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
      ) : null}

      {loading ? (
        <div className="grid place-items-center py-10 text-(--muted)">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : series.length ? (
        <>
          <AreaChart data={series} unit={metric === "lines" ? " lines" : " commits"} />
          {latestRows.length ? (
            <div className="mt-4">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-(--muted)">
                Leaders · {latest?.periodKey}
              </p>
              <BarList items={latestRows} unit={metric === "lines" ? "" : ""} />
            </div>
          ) : null}
        </>
      ) : (
        <p className="py-6 text-center text-sm text-(--muted)">
          No snapshot history yet. Snapshots are recorded automatically once a period completes —
          check back later.
        </p>
      )}
    </div>
  );
}
