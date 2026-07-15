"use client";

import { useEffect, useState } from "react";
import { GitMerge, GitPullRequest, MessageSquare, UserCheck, Users } from "lucide-react";

import { type ReviewMetrics, getReviewMetrics } from "@/lib/api";

/**
 * Team collaboration/review panel for the Analysis page: per-developer PRs
 * opened/merged and reviews given, from collected pull requests. Surfaces the
 * review/mentoring work that commit counts miss. Self-contained; stays silent
 * when no PRs have been collected for the scope.
 */
export function CollaborationPanel({
  organizationId,
  projectId
}: {
  organizationId: string | undefined;
  projectId: string | undefined;
}) {
  const [metrics, setMetrics] = useState<ReviewMetrics | null>(null);

  useEffect(() => {
    if (!organizationId) {
      return;
    }
    getReviewMetrics(organizationId, projectId ? { projectId } : {})
      .then(setMetrics)
      .catch(() => setMetrics(null));
  }, [organizationId, projectId]);

  if (!metrics || metrics.developers.length === 0) {
    return null;
  }

  return (
    <div className="glass rounded-xl p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users size={18} className="text-(--accent)" />
          <h2 className="text-lg font-bold text-(--text)">Collaboration &amp; review</h2>
          <span className="text-xs text-(--muted)">review/mentoring work commits miss (last 90 days)</span>
        </div>
        <div className="flex gap-3 text-xs font-semibold text-(--muted)">
          <span className="inline-flex items-center gap-1">
            <GitPullRequest size={13} /> {metrics.totals.prsOpened} opened
          </span>
          <span className="inline-flex items-center gap-1">
            <GitMerge size={13} /> {metrics.totals.prsMerged} merged
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageSquare size={13} /> {metrics.totals.reviewsGiven} reviews
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-160 text-sm">
          <thead>
            <tr className="border-b border-(--border) text-left text-xs uppercase tracking-wide text-(--muted)">
              <th className="px-2 py-2 font-medium">Developer</th>
              <th className="px-2 py-2 text-right font-medium">PRs opened</th>
              <th className="px-2 py-2 text-right font-medium">Merged</th>
              <th className="px-2 py-2 text-right font-medium">Reviews given</th>
              <th className="px-2 py-2 text-right font-medium">Approvals</th>
            </tr>
          </thead>
          <tbody>
            {metrics.developers.map((dev) => (
              <tr key={dev.login} className="border-b border-(--border)/60">
                <td className="px-2 py-3">
                  <div className="flex items-center gap-2">
                    {dev.employee ? (
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-(--accent-soft) text-(--accent)">
                        <UserCheck size={14} />
                      </span>
                    ) : null}
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-(--text)">{dev.employee?.name ?? dev.login}</p>
                      <p className="truncate text-xs text-(--muted)">
                        {dev.employee ? `@${dev.login}` : "unmapped git author"}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-3 text-right font-semibold text-(--text)">{dev.prsOpened}</td>
                <td className="px-2 py-3 text-right text-(--muted)">{dev.prsMerged}</td>
                <td className="px-2 py-3 text-right font-semibold text-(--text)">{dev.reviewsGiven}</td>
                <td className="px-2 py-3 text-right text-(--muted)">{dev.approvals}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
