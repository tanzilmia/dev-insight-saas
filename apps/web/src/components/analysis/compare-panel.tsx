"use client";

import { AlertTriangle, X } from "lucide-react";

import type { AnalysisEmployee } from "@/lib/api";
import { BarList } from "@/components/statistics/charts";

/**
 * Neutral magnitude row: the larger value reads stronger, but nothing is
 * colored "good/bad" — these are activity signals, not verdicts.
 */
function MetricRow({
  label,
  left,
  right,
  leftDisplay,
  rightDisplay
}: {
  label: string;
  left: number;
  right: number;
  leftDisplay?: string;
  rightDisplay?: string;
}) {
  const max = Math.max(left, right, 1);
  const pct = (value: number) => (value > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0);
  const emphasis = (mine: number, other: number) =>
    mine >= other ? "font-black text-(--text)" : "font-semibold text-(--muted)";

  return (
    <div className="grid grid-cols-[1fr_7.5rem_1fr] items-center gap-3 py-1.5">
      <div className="flex items-center justify-end gap-2.5">
        <span className={`text-sm ${emphasis(left, right)}`}>
          {leftDisplay ?? left.toLocaleString()}
        </span>
        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-(--surface-soft) sm:w-28">
          <div
            className="ml-auto h-full rounded-full bg-(--accent)"
            style={{ width: `${pct(left)}%` }}
          />
        </div>
      </div>
      <p className="text-center text-[10px] font-bold uppercase tracking-wide text-(--muted)">
        {label}
      </p>
      <div className="flex items-center gap-2.5">
        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-(--surface-soft) sm:w-28">
          <div className="h-full rounded-full bg-(--accent-2)" style={{ width: `${pct(right)}%` }} />
        </div>
        <span className={`text-sm ${emphasis(right, left)}`}>
          {rightDisplay ?? right.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

function PersonHeader({
  employee,
  align
}: {
  employee: AnalysisEmployee;
  align: "left" | "right";
}) {
  const alignment = align === "left" ? "items-start text-left" : "items-end text-right";
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${alignment}`}>
      <p className="w-full truncate text-sm font-bold text-(--text)">
        <span className="mr-1.5 text-(--muted)">#{employee.rank}</span>
        {employee.name}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-(--surface-soft) px-2 py-0.5 text-[10px] font-bold text-(--muted)">
          {employee.projectRole}
        </span>
        <span className="truncate text-[11px] text-(--muted)">
          {employee.usernames.length
            ? employee.usernames.map((name) => `@${name}`).join(", ")
            : "no git identity"}
        </span>
      </div>
    </div>
  );
}

function AreaChips({
  modules,
  shared,
  align
}: {
  modules: string[];
  shared: Set<string>;
  align: "left" | "right";
}) {
  if (!modules.length) {
    return <p className={`text-xs text-(--muted) ${align === "right" ? "text-right" : ""}`}>—</p>;
  }
  return (
    <div className={`flex flex-wrap gap-1.5 ${align === "right" ? "justify-end" : ""}`}>
      {modules.map((module) => (
        <span
          key={module}
          className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
            shared.has(module)
              ? "bg-(--accent-soft) text-(--accent)"
              : "bg-(--surface-soft) text-(--muted)"
          }`}
        >
          {module}
          {shared.has(module) ? " · shared" : ""}
        </span>
      ))}
    </div>
  );
}

export function ComparePanel({
  left,
  right,
  daysInPeriod,
  onClose
}: {
  left: AnalysisEmployee;
  right: AnalysisEmployee;
  daysInPeriod: number;
  onClose: () => void;
}) {
  const category = (employee: AnalysisEmployee, name: string) => employee.categories[name] ?? 0;
  const sharedModules = new Set(
    left.topModules.filter((module) => right.topModules.includes(module))
  );
  const categoryItems = (employee: AnalysisEmployee) =>
    Object.entries(employee.categories)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([label, value]) => ({ label, value }));

  return (
    <div className="glass rounded-xl p-5">
      <div className="mb-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <PersonHeader employee={left} align="left" />
        <div className="flex flex-col items-center gap-1">
          <span className="rounded-full bg-(--surface-soft) px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-(--muted)">
            vs
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close comparison"
            className="grid h-6 w-6 place-items-center rounded-full text-(--muted) transition hover:bg-(--surface-soft) hover:text-(--text)"
          >
            <X size={13} />
          </button>
        </div>
        <PersonHeader employee={right} align="right" />
      </div>

      <div className="grid gap-0.5 border-t border-(--border) pt-3">
        <MetricRow label="Commits" left={left.commits} right={right.commits} />
        <MetricRow
          label="Lines (filtered)"
          left={left.filteredLines}
          right={right.filteredLines}
        />
        <MetricRow
          label="Active days"
          left={left.activeDays}
          right={right.activeDays}
          leftDisplay={`${left.activeDays}/${daysInPeriod}`}
          rightDisplay={`${right.activeDays}/${daysInPeriod}`}
        />
        <MetricRow label="Areas touched" left={left.moduleCount} right={right.moduleCount} />
        <MetricRow
          label="Feature commits"
          left={category(left, "Feature")}
          right={category(right, "Feature")}
        />
        <MetricRow label="Fix commits" left={category(left, "Fix")} right={category(right, "Fix")} />
      </div>

      {left.riskyCommits + right.riskyCommits + left.largeCommits + right.largeCommits > 0 ? (
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-lg bg-(--surface-soft) px-3 py-2">
          <p className="text-right text-xs text-(--text)">
            {left.riskyCommits} risky · {left.largeCommits} very large
          </p>
          <AlertTriangle size={13} className="text-amber-500" />
          <p className="text-xs text-(--text)">
            {right.riskyCommits} risky · {right.largeCommits} very large
          </p>
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-(--muted)">
            Work breakdown
          </p>
          <BarList items={categoryItems(left)} />
        </div>
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-(--muted) sm:text-right">
            Work breakdown
          </p>
          <BarList items={categoryItems(right)} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <AreaChips modules={left.topModules} shared={sharedModules} align="left" />
        <AreaChips modules={right.topModules} shared={sharedModules} align="right" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 border-t border-(--border) pt-3">
        <div>
          {left.sampleMessages.slice(0, 3).map((message, index) => (
            <p key={index} className="truncate text-xs text-(--muted)">
              “{message}”
            </p>
          ))}
          {left.lastCommitAt ? (
            <p className="mt-1 text-[11px] text-(--muted)">
              Last commit {new Date(left.lastCommitAt).toLocaleDateString()}
            </p>
          ) : null}
        </div>
        <div className="text-right">
          {right.sampleMessages.slice(0, 3).map((message, index) => (
            <p key={index} className="truncate text-xs text-(--muted)">
              “{message}”
            </p>
          ))}
          {right.lastCommitAt ? (
            <p className="mt-1 text-[11px] text-(--muted)">
              Last commit {new Date(right.lastCommitAt).toLocaleDateString()}
            </p>
          ) : null}
        </div>
      </div>

      <p className="mt-4 text-center text-[11px] text-(--muted)">
        Activity signals from Git history — volume is not the same as impact.
      </p>
    </div>
  );
}
