"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, UserPlus } from "lucide-react";

import { type UnmappedSummary, getUnmappedSummary } from "@/lib/api";

/**
 * A quiet Overview nudge: how many contributors are committing but not yet
 * linked to an employee (so they are invisible in per-person reports). Stays
 * silent when everyone is mapped or it can't load.
 */
export function UnmappedNudge({ organizationId }: { organizationId: string | undefined }) {
  const [summary, setSummary] = useState<UnmappedSummary | null>(null);

  // setState only inside .then/.catch (deferred) so this is safe to call from an
  // effect (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!organizationId) {
      return;
    }
    getUnmappedSummary(organizationId)
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [organizationId]);

  if (!summary || summary.count === 0) {
    return null; // nothing to nudge about
  }

  const names = summary.sample
    .map((person) => (person.username ? `@${person.username}` : "an unnamed author"))
    .slice(0, 4);

  return (
    <div className="glass rounded-xl border-l-2 border-l-amber-500 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <UserPlus size={16} />
          </span>
          <div>
            <p className="text-sm font-bold text-(--text)">
              {summary.count} contributor{summary.count === 1 ? "" : "s"} not linked to an employee
            </p>
            <p className="mt-0.5 text-xs text-(--muted)">
              {names.join(", ")}
              {summary.count > names.length ? ", and others" : ""} are committing but won’t appear
              in per-person reports until they’re mapped.
            </p>
          </div>
        </div>
        <Link
          href="/dashboard/contributors"
          className="btn-gradient inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-bold"
        >
          Map contributors
          <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}
