"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bug,
  Copy,
  FileCode2,
  Gauge,
  Info,
  Percent,
  RefreshCw,
  ShieldAlert,
  ShieldQuestion,
  Timer,
  UserCheck,
  Users,
  Wind
} from "lucide-react";

import {
  type CodeQualityOverview,
  type QualityRating,
  getApiErrorMessage,
  getCodeQualityOverview
} from "@/lib/api";
import { useSession } from "@/lib/use-session";
import { DashboardChrome, DashboardLoading } from "@/components/dashboard/dashboard-chrome";
import { StatTile } from "@/components/statistics/charts";

const DEFAULT_PROJECT_KEY = "devinsight";

/** A-E letter grade → colour (A best, E worst). Neutral when unmeasured. */
function ratingClass(rating: QualityRating): string {
  switch (rating) {
    case "A":
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
    case "B":
      return "bg-lime-500/15 text-lime-600 dark:text-lime-400";
    case "C":
      return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
    case "D":
      return "bg-orange-500/15 text-orange-600 dark:text-orange-400";
    case "E":
      return "bg-red-500/15 text-red-600 dark:text-red-400";
    default:
      return "bg-(--surface-soft) text-(--muted)";
  }
}

function severityClass(severity: string): string {
  if (severity === "BLOCKER" || severity === "CRITICAL")
    return "bg-red-500/15 text-red-600 dark:text-red-400";
  if (severity === "MAJOR") return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  return "bg-(--surface-soft) text-(--muted)";
}

/** SonarQube tech-debt is in minutes; show it as human hours/days. */
function formatDebt(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 8); // an 8h working day
  return `${days}d`;
}

function RatingBadge({ label, rating }: { label: string; rating: QualityRating }) {
  return (
    <div className="glass flex items-center justify-between rounded-xl p-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-(--muted)">{label}</p>
        <p className="mt-0.5 text-sm text-(--muted)">Rating</p>
      </div>
      <span
        className={`grid h-11 w-11 place-items-center rounded-xl text-xl font-black ${ratingClass(rating)}`}
      >
        {rating ?? "–"}
      </span>
    </div>
  );
}

export function CodeQualityManager() {
  const { status, activeOrganization } = useSession();
  const organizationId = activeOrganization?.id;

  const [projectKeyInput, setProjectKeyInput] = useState(DEFAULT_PROJECT_KEY);
  const [projectKey, setProjectKey] = useState(DEFAULT_PROJECT_KEY);
  const [overview, setOverview] = useState<CodeQualityOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // State is set only inside .then/.catch/.finally (deferred), so this is safe
  // to call from an effect (react-hooks/set-state-in-effect).
  const load = useCallback(() => {
    if (!organizationId || !projectKey) {
      return Promise.resolve();
    }
    return getCodeQualityOverview(organizationId, projectKey)
      .then((data) => {
        setOverview(data);
        setError(null);
      })
      .catch((caught) => {
        setError(getApiErrorMessage(caught));
        setOverview(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [organizationId, projectKey]);

  useEffect(() => {
    void load();
  }, [load]);

  if (status === "loading") {
    return <DashboardLoading />;
  }

  const measures = overview?.measures ?? null;
  const developers = overview?.developers ?? [];

  return (
    <DashboardChrome>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-(--text)">Code Quality</h1>
          <p className="mt-1 text-sm text-(--muted)">
            Static analysis from SonarQube — bugs, vulnerabilities, coverage, and per-developer
            issue attribution.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="grid gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-(--muted)">
              SonarQube project key
            </span>
            <input
              className="field w-52"
              value={projectKeyInput}
              onChange={(event) => setProjectKeyInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  setLoading(true);
                  setProjectKey(projectKeyInput.trim());
                }
              }}
              placeholder="project key"
            />
          </label>
          <button
            type="button"
            className="btn-gradient flex items-center gap-2"
            onClick={() => {
              const next = projectKeyInput.trim();
              setLoading(true);
              if (next === projectKey) void load();
              else setProjectKey(next);
            }}
          >
            <RefreshCw size={15} />
            Load
          </button>
        </div>
      </div>

      {error ? (
        <div className="glass mb-6 flex items-start gap-3 rounded-xl border border-red-500/30 p-4 text-sm text-red-600 dark:text-red-400">
          <Info size={18} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {loading ? (
        <DashboardLoading />
      ) : overview && !overview.available ? (
        <div className="glass rounded-xl p-6">
          <div className="mb-2 flex items-center gap-2 text-(--text)">
            <ShieldQuestion size={18} className="text-(--accent)" />
            <p className="font-bold">SonarQube not connected</p>
          </div>
          <p className="text-sm text-(--muted)">
            Set <code className="rounded bg-(--surface-soft) px-1">SONAR_TOKEN</code> in the API
            environment and restart the server, then run a scan. Once results exist, they appear
            here for project <code className="rounded bg-(--surface-soft) px-1">{overview.projectKey}</code>.
          </p>
        </div>
      ) : overview && overview.available && measures ? (
        <div className="grid gap-6">
          {/* Ratings */}
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <RatingBadge label="Reliability" rating={measures.reliabilityRating} />
            <RatingBadge label="Security" rating={measures.securityRating} />
            <RatingBadge label="Maintainability" rating={measures.maintainabilityRating} />
          </section>

          {/* Headline measures */}
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Bugs" value={measures.bugs ?? 0} icon={Bug} />
            <StatTile label="Vulnerabilities" value={measures.vulnerabilities ?? 0} icon={ShieldAlert} />
            <StatTile label="Code smells" value={measures.codeSmells ?? 0} icon={Wind} />
            <StatTile
              label="Coverage"
              value={measures.coverage === null ? "—" : `${measures.coverage}%`}
              icon={Percent}
            />
            <StatTile
              label="Duplication"
              value={measures.duplicatedLinesDensity === null ? "—" : `${measures.duplicatedLinesDensity}%`}
              icon={Copy}
            />
            <StatTile label="Security hotspots" value={measures.securityHotspots ?? 0} icon={ShieldQuestion} />
            <StatTile label="Tech debt" value={formatDebt(measures.techDebtMinutes)} icon={Timer} />
            <StatTile label="Lines of code" value={measures.linesOfCode ?? 0} icon={FileCode2} />
          </section>

          {/* Per-developer breakdown */}
          <section className="glass rounded-xl p-5">
            <div className="mb-4 flex items-center gap-2">
              <Users size={18} className="text-(--accent)" />
              <h2 className="text-lg font-bold text-(--text)">By developer</h2>
              <span className="text-xs text-(--muted)">
                attributed via git blame — evidence, not exact fault
              </span>
            </div>

            {developers.length === 0 ? (
              <p className="py-6 text-center text-sm text-(--muted)">No open issues found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-160 text-sm">
                  <thead>
                    <tr className="border-b border-(--border) text-left text-xs uppercase tracking-wide text-(--muted)">
                      <th className="px-2 py-2 font-medium">Developer</th>
                      <th className="px-2 py-2 text-right font-medium">Total</th>
                      <th className="px-2 py-2 text-right font-medium">Bugs</th>
                      <th className="px-2 py-2 text-right font-medium">Vulns</th>
                      <th className="px-2 py-2 text-right font-medium">Smells</th>
                      <th className="px-2 py-2 font-medium">Severity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {developers.map((dev) => (
                      <tr key={dev.author} className="border-b border-(--border)/60">
                        <td className="px-2 py-3">
                          <div className="flex items-center gap-2">
                            {dev.employee ? (
                              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-(--accent-soft) text-(--accent)">
                                <UserCheck size={14} />
                              </span>
                            ) : null}
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-(--text)">
                                {dev.employee?.name ?? dev.author}
                              </p>
                              <p className="truncate text-xs text-(--muted)">
                                {dev.employee ? dev.author : "unmapped git author"}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-3 text-right font-semibold text-(--text)">{dev.total}</td>
                        <td className="px-2 py-3 text-right text-(--muted)">{dev.bugs}</td>
                        <td className="px-2 py-3 text-right text-(--muted)">{dev.vulnerabilities}</td>
                        <td className="px-2 py-3 text-right text-(--muted)">{dev.codeSmells}</td>
                        <td className="px-2 py-3">
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(dev.bySeverity)
                              .sort((a, b) => b[1] - a[1])
                              .map(([sev, count]) => (
                                <span
                                  key={sev}
                                  className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${severityClass(sev)}`}
                                >
                                  {sev.toLowerCase()} {count}
                                </span>
                              ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {!overview.capabilities.pullRequestAnalysis ? (
            <p className="flex items-center gap-2 text-xs text-(--muted)">
              <Gauge size={14} />
              Community Edition analyzes the main branch only (post-merge). PR/branch analysis
              needs SonarCloud or Developer Edition.
            </p>
          ) : null}
        </div>
      ) : null}
    </DashboardChrome>
  );
}
