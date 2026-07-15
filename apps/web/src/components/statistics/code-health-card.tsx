"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Bug,
  CheckCircle2,
  Percent,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Wind,
  XCircle
} from "lucide-react";

import { type CodeQualitySummary, getCodeQualitySummary } from "@/lib/api";

function GateChip({ status }: { status: "OK" | "ERROR" | "WARN" | "NONE" }) {
  if (status === "OK")
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 size={12} /> Gate passed
      </span>
    );
  if (status === "ERROR")
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-600 dark:text-red-400">
        <XCircle size={12} /> Gate failed
      </span>
    );
  if (status === "WARN")
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
        <AlertTriangle size={12} /> Gate warning
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-(--surface-soft) px-2 py-0.5 text-xs font-semibold text-(--muted)">
      <ShieldQuestion size={12} /> No gate
    </span>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Bug; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="inline-grid h-8 w-8 place-items-center rounded-lg bg-(--surface-soft) text-(--muted)">
        <Icon size={15} />
      </span>
      <div>
        <p className="text-lg font-bold leading-none text-(--text)">{value}</p>
        <p className="mt-0.5 text-xs text-(--muted)">{label}</p>
      </div>
    </div>
  );
}

/**
 * Overview "Code health" card: an org-wide SonarQube rollup (bugs / vulns /
 * coverage + worst quality gate across mapped projects). Stays silent when no
 * SonarQube is connected/mapped or it can't load — the same quiet philosophy as
 * the other Overview cards.
 */
export function CodeHealthCard({
  organizationId,
  projectId
}: {
  organizationId: string | undefined;
  /** When set, the rollup is scoped to one project's repositories. */
  projectId?: string;
}) {
  const [summary, setSummary] = useState<CodeQualitySummary | null>(null);

  useEffect(() => {
    if (!organizationId) {
      return;
    }
    getCodeQualitySummary(organizationId, projectId)
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [organizationId, projectId]);

  if (!summary || !summary.available) {
    return null; // nothing mapped / not connected — stay quiet
  }

  return (
    <div className="glass rounded-xl p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-grid h-8 w-8 place-items-center rounded-lg bg-(--accent-soft) text-(--accent)">
            <ShieldCheck size={16} />
          </span>
          <div>
            <p className="text-sm font-bold text-(--text)">Code health</p>
            <p className="text-xs text-(--muted)">
              SonarQube · {summary.projectCount} project{summary.projectCount === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <GateChip status={summary.worstGate} />
          <Link
            href="/dashboard/code-quality"
            className="inline-flex items-center gap-1 text-xs font-bold text-(--accent) hover:underline"
          >
            Details <ArrowRight size={13} />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric icon={Bug} label="Bugs" value={summary.totals.bugs} />
        <Metric icon={ShieldAlert} label="Vulnerabilities" value={summary.totals.vulnerabilities} />
        <Metric icon={Percent} label="Coverage" value={summary.coverage === null ? "—" : `${summary.coverage}%`} />
        <Metric icon={Wind} label="Code smells" value={summary.totals.codeSmells} />
      </div>
    </div>
  );
}
