"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarCheck,
  Flame,
  Loader2,
  Minus,
  TrendingDown,
  TrendingUp
} from "lucide-react";

import { type DailyDigest, getApiErrorMessage, getDailyDigest } from "@/lib/api";

function RankDelta({ delta }: { delta: number | null }) {
  if (delta === null) {
    return (
      <span className="rounded-full bg-(--accent-soft) px-1.5 py-0.5 text-[10px] font-bold text-(--accent)">
        new
      </span>
    );
  }
  if (delta === 0) {
    return (
      <span className="inline-flex items-center text-[11px] font-bold text-(--muted)">
        <Minus size={11} />
      </span>
    );
  }
  const up = delta > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] font-bold ${
        up ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
      }`}
    >
      {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {Math.abs(delta)}
    </span>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-(--surface-soft) px-3 py-2">
      <p className="text-base font-bold text-(--text)">{value.toLocaleString()}</p>
      <p className="text-[11px] font-medium text-(--muted)">{label}</p>
    </div>
  );
}

export function DailyDigestCard({ organizationId }: { organizationId: string | undefined }) {
  const [digest, setDigest] = useState<DailyDigest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // setState only inside .then/.catch/.finally (deferred) so this is safe to call
  // from an effect (react-hooks/set-state-in-effect). `loading` starts true.
  useEffect(() => {
    if (!organizationId) {
      return;
    }
    getDailyDigest(organizationId)
      .then((data) => {
        setDigest(data);
        setError(null);
      })
      .catch((caught) => setError(getApiErrorMessage(caught)))
      .finally(() => setLoading(false));
  }, [organizationId]);

  if (loading) {
    return (
      <div className="glass grid place-items-center rounded-xl p-8 text-(--muted)">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }
  if (error || !digest) {
    return null; // digest is a nice-to-have; stay quiet if it can't load
  }

  const { headline, trend, topMovers } = digest;
  const trendUp = (trend.deltaPct ?? 0) >= 0;

  return (
    <div className="glass rounded-xl p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarCheck size={16} className="text-(--accent)" />
          <h2 className="text-sm font-bold text-(--text)">Yesterday in review</h2>
          <span className="text-xs font-medium text-(--muted)">{digest.date}</span>
        </div>
        {trend.deltaPct !== null ? (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
              trendUp
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-red-500/15 text-red-600 dark:text-red-400"
            }`}
          >
            {trendUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {Math.abs(trend.deltaPct)}% vs prior day
          </span>
        ) : null}
      </div>

      {digest.hasActivity ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <MiniStat label="Commits" value={headline.commits} />
            <MiniStat label="Contributors" value={headline.contributors} />
            <MiniStat label="Active repos" value={headline.activeRepos} />
            <MiniStat label="Lines +" value={headline.additions} />
            <MiniStat label="Files" value={headline.filesChanged} />
          </div>

          {topMovers.length ? (
            <div className="mt-4">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-(--muted)">
                Top movers
              </p>
              <ul className="grid gap-1.5">
                {topMovers.map((mover) => (
                  <li
                    key={`${mover.userId ?? mover.name}-${mover.rank}`}
                    className="flex items-center justify-between gap-3 rounded-lg bg-(--surface-soft) px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="w-5 shrink-0 text-xs font-bold text-(--muted)">
                        #{mover.rank}
                      </span>
                      <span className="truncate text-sm font-semibold text-(--text)">
                        {mover.name}
                      </span>
                      {mover.streak >= 2 ? (
                        <span
                          className="inline-flex items-center gap-0.5 text-[11px] font-bold text-amber-600 dark:text-amber-400"
                          title={`${mover.streak}-day active streak`}
                        >
                          <Flame size={11} />
                          {mover.streak}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-xs text-(--muted)">
                        {mover.commits} commit{mover.commits === 1 ? "" : "s"} ·{" "}
                        {mover.lines.toLocaleString()} lines
                      </span>
                      <RankDelta delta={mover.rankDelta} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {digest.risks.length ? (
            <div className="mt-3 flex flex-col gap-1">
              {digest.risks.slice(0, 3).map((risk, index) => (
                <p
                  key={index}
                  className="flex items-start gap-1.5 text-xs text-(--muted)"
                >
                  <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-500" />
                  {risk}
                </p>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <p className="py-2 text-sm text-(--muted)">No commits were recorded yesterday.</p>
      )}
    </div>
  );
}
