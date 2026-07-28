"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ClipboardList, Clock3, UserRound } from "lucide-react";

import { type IssueMetrics, getIssueMetrics } from "@/lib/api";
import { BarList, StatTile } from "@/components/statistics/charts";

/**
 * Read-only GitHub Issue workflow signals. Issue volume is deliberately shown
 * as operational workload, not as an employee-performance verdict.
 */
export function IssuesPanel({
  organizationId,
  projectId
}: {
  organizationId: string | undefined;
  projectId: string | undefined;
}) {
  const [metrics, setMetrics] = useState<IssueMetrics | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    getIssueMetrics(organizationId, projectId ? { projectId } : {})
      .then(setMetrics)
      .catch(() => setMetrics(null));
  }, [organizationId, projectId]);

  if (!metrics || (metrics.totals.open === 0 && metrics.totals.opened === 0 && metrics.totals.closed === 0)) {
    return null;
  }

  return (
    <section className="glass rounded-xl p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-grid h-8 w-8 place-items-center rounded-lg bg-(--accent-soft) text-(--accent)">
            <ClipboardList size={16} />
          </span>
          <div>
            <h2 className="text-lg font-bold text-(--text)">GitHub work items</h2>
            <p className="text-xs text-(--muted)">
              Issue workflow signals · last 90 days · read-only from GitHub
            </p>
          </div>
        </div>
        <span className="text-xs font-semibold text-(--muted)">
          {metrics.truncated ? "Showing capped history" : "Synced issue history"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Open backlog" value={metrics.totals.open} icon={ClipboardList} />
        <StatTile label="Opened" value={metrics.totals.opened} icon={Clock3} />
        <StatTile label="Closed" value={metrics.totals.closed} icon={UserRound} />
        <StatTile label="Unassigned" value={metrics.totals.unassignedOpen} icon={AlertTriangle} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-bold text-(--text)">Open workload by employee</h3>
            <span className="text-xs text-(--muted)">{metrics.totals.overdueOpen} overdue</span>
          </div>
          <BarList
            items={metrics.developers
              .filter((developer) => developer.assignedOpen > 0)
              .slice(0, 6)
              .map((developer) => ({
                label: developer.employee?.name ?? `@${developer.login}`,
                value: developer.assignedOpen
              }))}
            unit=" issues"
          />
        </div>
        <div>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-bold text-(--text)">Most-used labels</h3>
            <span className="text-xs text-(--muted)">
              Avg age {metrics.totals.avgAgeDays}d · cycle {metrics.totals.avgCycleDays}d
            </span>
          </div>
          <BarList
            items={metrics.labels.slice(0, 6).map((label) => ({ label: label.label, value: label.count }))}
            unit=" issues"
          />
        </div>
      </div>

      <p className="mt-5 border-t border-(--border) pt-3 text-xs leading-relaxed text-(--muted)">
        These are workflow signals from GitHub Issues, not a standalone performance score.
      </p>
    </section>
  );
}
