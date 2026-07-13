"use client";

import {
  AlertTriangle,
  Lightbulb,
  Minus,
  TrendingDown,
  TrendingUp,
  UserMinus,
  UserPlus
} from "lucide-react";

import type {
  ReportComparison,
  ReportInsight,
  ReportMetricDelta,
  ReportRankMovement
} from "@/lib/api";

const STRIPPED_SECTIONS = ["key insights", "trend vs previous period"];

/**
 * Removes the "## Key insights" and "## Trend vs previous period" sections from
 * report markdown for DISPLAY only — those are shown by the structured panel, so
 * keeping them in the rendered markdown would duplicate. The raw markdown still
 * carries them (Telegram / copy / download stay complete).
 */
export function stripStructuredSections(markdown: string): string {
  const out: string[] = [];
  let skipping = false;
  for (const line of markdown.split("\n")) {
    const heading = line.match(/^(#{1,2})\s+(.*)$/);
    if (heading) {
      const text = heading[2]!.trim().toLowerCase();
      skipping = STRIPPED_SECTIONS.some((title) => text.startsWith(title));
      if (skipping) {
        continue; // drop the target heading itself
      }
    }
    if (!skipping) {
      out.push(line);
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function DeltaChip({ delta }: { delta: ReportMetricDelta }) {
  if (delta.deltaPct === null) {
    return <span className="text-[11px] font-medium text-(--muted)">no prior</span>;
  }
  if (delta.deltaPct === 0) {
    return (
      <span className="inline-flex items-center text-[11px] font-bold text-(--muted)">
        <Minus size={11} /> 0%
      </span>
    );
  }
  const up = delta.deltaPct > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] font-bold ${
        up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
      }`}
    >
      {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {Math.abs(delta.deltaPct)}%
    </span>
  );
}

function TrendTile({ label, delta }: { label: string; delta: ReportMetricDelta }) {
  return (
    <div className="rounded-lg bg-(--surface-soft) px-3 py-2">
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-base font-bold text-(--text)">{delta.current.toLocaleString()}</span>
        <DeltaChip delta={delta} />
      </div>
      <p className="text-[11px] font-medium text-(--muted)">{label}</p>
      <p className="text-[10px] text-(--muted)">was {delta.previous.toLocaleString()}</p>
    </div>
  );
}

function MoverBadge({ mover }: { mover: ReportRankMovement }) {
  const base =
    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold";
  if (mover.status === "new") {
    return (
      <span className={`${base} bg-(--accent-soft) text-(--accent)`}>
        <UserPlus size={11} /> {mover.name} new
      </span>
    );
  }
  if (mover.status === "dropped") {
    return (
      <span className={`${base} bg-rose-500/15 text-rose-600 dark:text-rose-400`}>
        <UserMinus size={11} /> {mover.name} off
      </span>
    );
  }
  const up = mover.status === "up";
  return (
    <span
      className={`${base} ${
        up
          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          : "bg-(--surface-soft) text-(--muted)"
      }`}
    >
      {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {mover.name} {up ? "↑" : "↓"}
      {Math.abs(mover.delta ?? 0)}
    </span>
  );
}

export function ReportInsightsPanel({
  comparison,
  insights
}: {
  comparison?: ReportComparison | null;
  insights?: ReportInsight[] | null;
}) {
  const hasTrend = Boolean(comparison?.hasBaseline);
  const hasInsights = Boolean(insights?.length);
  if (!hasTrend && !hasInsights) {
    return null;
  }

  return (
    <div className="grid gap-3">
      {hasInsights ? (
        <div className="rounded-xl border border-(--border) bg-(--surface-soft) p-3.5">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-(--muted)">
            Key insights
          </p>
          <ul className="grid gap-1.5">
            {insights!.map((insight, index) => {
              const warn = insight.severity === "warn";
              return (
                <li key={index} className="flex items-start gap-2 text-sm">
                  {warn ? (
                    <AlertTriangle
                      size={15}
                      className="mt-0.5 shrink-0 text-amber-500"
                    />
                  ) : (
                    <Lightbulb size={15} className="mt-0.5 shrink-0 text-(--accent)" />
                  )}
                  <span
                    className={
                      warn ? "font-medium text-(--text)" : "text-(--text)"
                    }
                  >
                    {insight.text}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {hasTrend && comparison ? (
        <div className="rounded-xl border border-(--border) bg-(--surface-soft) p-3.5">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-(--muted)">
            Trend vs previous period
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <TrendTile label="Commits" delta={comparison.commits} />
            <TrendTile label="Lines added" delta={comparison.additions} />
            <TrendTile label="Lines removed" delta={comparison.deletions} />
            <TrendTile label="Files" delta={comparison.filesChanged} />
            <TrendTile label="Contributors" delta={comparison.contributors} />
          </div>
          {comparison.movers.length ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {comparison.movers.map((mover, index) => (
                <MoverBadge key={index} mover={mover} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
