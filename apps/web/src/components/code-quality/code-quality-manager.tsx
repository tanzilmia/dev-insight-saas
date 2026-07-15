"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileCode2,
  Gauge,
  Info,
  Percent,
  Plug,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Timer,
  Trash2,
  Users,
  UserCheck,
  Wind,
  XCircle
} from "lucide-react";

import {
  type CodeQualityConnection,
  type CodeQualityOverview,
  type QualityGateStatus,
  type QualityRating,
  type SonarProjectSummary,
  deleteCodeQualityConnection,
  getApiErrorMessage,
  getCodeQualityConnection,
  getCodeQualityOverview,
  listSonarProjects,
  saveCodeQualityConnection,
  testCodeQualityConnection
} from "@/lib/api";
import { canManage, useSession } from "@/lib/use-session";
import { DashboardChrome, DashboardLoading } from "@/components/dashboard/dashboard-chrome";
import { StatTile } from "@/components/statistics/charts";

const DEFAULT_BASE_URL = "http://localhost:9000";

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

function formatDebt(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 8)}d`;
}

function RatingBadge({ label, rating }: { label: string; rating: QualityRating }) {
  return (
    <div className="glass flex items-center justify-between rounded-xl p-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-(--muted)">{label}</p>
        <p className="mt-0.5 text-sm text-(--muted)">Rating</p>
      </div>
      <span className={`grid h-11 w-11 place-items-center rounded-xl text-xl font-black ${ratingClass(rating)}`}>
        {rating ?? "–"}
      </span>
    </div>
  );
}

function GateBadge({ gate }: { gate: QualityGateStatus | null }) {
  if (!gate || gate.status === "NONE")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-(--surface-soft) px-3 py-1.5 text-sm font-semibold text-(--muted)">
        <ShieldQuestion size={15} /> No quality gate
      </span>
    );
  if (gate.status === "OK")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 size={15} /> Quality gate passed
      </span>
    );
  if (gate.status === "WARN")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/15 px-3 py-1.5 text-sm font-semibold text-amber-600 dark:text-amber-400">
        <AlertTriangle size={15} /> Quality gate warning
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/15 px-3 py-1.5 text-sm font-semibold text-red-600 dark:text-red-400">
      <XCircle size={15} /> Quality gate failed
    </span>
  );
}

export function CodeQualityManager() {
  const { status, activeOrganization } = useSession();
  const organizationId = activeOrganization?.id;
  const manageable = canManage(activeOrganization?.role);

  const [connection, setConnection] = useState<CodeQualityConnection | null>(null);
  const [projects, setProjects] = useState<SonarProjectSummary[]>([]);
  const [projectKey, setProjectKey] = useState("");
  const [manualKey, setManualKey] = useState("");

  const [overview, setOverview] = useState<CodeQualityOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Connection form.
  const [showConnect, setShowConnect] = useState(false);
  const [formBaseUrl, setFormBaseUrl] = useState(DEFAULT_BASE_URL);
  const [formToken, setFormToken] = useState("");
  const [formOrgKey, setFormOrgKey] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [connBusy, setConnBusy] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);

  const sonarBaseUrl =
    connection && connection.connected ? connection.baseUrl : DEFAULT_BASE_URL;

  // Load connection + projects when the org is known.
  const loadConnection = useCallback(() => {
    if (!organizationId) return;
    Promise.all([getCodeQualityConnection(organizationId), listSonarProjects(organizationId)])
      .then(([conn, projectList]) => {
        setConnection(conn);
        setProjects(projectList.projects);
        setProjectKey((current) => current || projectList.projects[0]?.key || "");
      })
      .catch(() => {
        setConnection({ connected: false });
      });
  }, [organizationId]);

  useEffect(() => {
    loadConnection();
  }, [loadConnection]);

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

  function handleTest() {
    if (!organizationId) return;
    setConnBusy(true);
    setConnError(null);
    setTestResult(null);
    testCodeQualityConnection({
      organizationId,
      baseUrl: formBaseUrl,
      token: formToken,
      organizationKey: formOrgKey.trim() || undefined
    })
      .then((result) => setTestResult(result.valid ? "Connection OK ✓" : "Invalid token or unreachable"))
      .catch((caught) => setConnError(getApiErrorMessage(caught)))
      .finally(() => setConnBusy(false));
  }

  function handleSave() {
    if (!organizationId) return;
    setConnBusy(true);
    setConnError(null);
    saveCodeQualityConnection({
      organizationId,
      baseUrl: formBaseUrl,
      token: formToken,
      organizationKey: formOrgKey.trim() || undefined
    })
      .then((conn) => {
        setConnection(conn);
        setShowConnect(false);
        setFormToken("");
        setTestResult(null);
        loadConnection();
      })
      .catch((caught) => setConnError(getApiErrorMessage(caught)))
      .finally(() => setConnBusy(false));
  }

  function handleDisconnect() {
    if (!organizationId || !window.confirm("Disconnect SonarQube for this organization?")) return;
    setConnBusy(true);
    deleteCodeQualityConnection(organizationId)
      .then((conn) => setConnection(conn))
      .catch((caught) => setConnError(getApiErrorMessage(caught)))
      .finally(() => setConnBusy(false));
  }

  if (status === "loading") {
    return <DashboardLoading />;
  }

  const measures = overview?.measures ?? null;
  const developers = overview?.developers ?? [];

  return (
    <DashboardChrome>
      <div className="mb-6">
        <h1 className="text-2xl font-black tracking-tight text-(--text)">Code Quality</h1>
        <p className="mt-1 text-sm text-(--muted)">
          Static analysis from SonarQube — bugs, vulnerabilities, coverage, and per-developer
          issue attribution.
        </p>
      </div>

      {/* Connection panel */}
      <div className="glass mb-6 rounded-xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            {connection && connection.connected ? (
              <>
                <ShieldCheck size={16} className="text-emerald-500" />
                <span className="font-semibold text-(--text)">Connected</span>
                <span className="text-(--muted)">{connection.baseUrl}</span>
              </>
            ) : connection && !connection.connected && connection.envFallback ? (
              <>
                <Plug size={16} className="text-(--muted)" />
                <span className="text-(--muted)">Using the local default (env). Connect to manage it here.</span>
              </>
            ) : (
              <>
                <Plug size={16} className="text-(--muted)" />
                <span className="text-(--muted)">No SonarQube connected for this organization.</span>
              </>
            )}
          </div>
          {manageable ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-gradient text-xs"
                onClick={() => {
                  setConnError(null);
                  setTestResult(null);
                  if (connection && connection.connected) setFormBaseUrl(connection.baseUrl);
                  setShowConnect((v) => !v);
                }}
              >
                {connection && connection.connected ? "Reconfigure" : "Connect SonarQube"}
              </button>
              {connection && connection.connected ? (
                <button
                  type="button"
                  disabled={connBusy}
                  onClick={handleDisconnect}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold text-(--muted) hover:text-red-500 disabled:opacity-50"
                >
                  <Trash2 size={14} /> Disconnect
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {showConnect && manageable ? (
          <div className="mt-4 grid gap-3 border-t border-(--border) pt-4 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-xs font-medium text-(--muted)">Base URL</span>
              <input className="field" value={formBaseUrl} onChange={(e) => setFormBaseUrl(e.target.value)} placeholder="https://sonar.example.com" />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-(--muted)">Token</span>
              <input className="field" type="password" value={formToken} onChange={(e) => setFormToken(e.target.value)} placeholder="sqp_… (never shown again)" />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-(--muted)">Organization key (SonarCloud only)</span>
              <input className="field" value={formOrgKey} onChange={(e) => setFormOrgKey(e.target.value)} placeholder="optional" />
            </label>
            <div className="flex items-end gap-2">
              <button type="button" disabled={connBusy || !formToken} onClick={handleTest} className="field font-semibold disabled:opacity-50">
                Test
              </button>
              <button type="button" disabled={connBusy || !formToken} onClick={handleSave} className="btn-gradient disabled:opacity-50">
                Save
              </button>
            </div>
            {testResult ? <p className="text-xs text-(--muted) sm:col-span-2">{testResult}</p> : null}
            {connError ? <p className="text-xs text-red-500 sm:col-span-2">{connError}</p> : null}
          </div>
        ) : null}
      </div>

      {/* Project picker + gate */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-end gap-2">
          <label className="grid gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-(--muted)">SonarQube project</span>
            {projects.length ? (
              <select
                className="field w-64"
                value={projectKey}
                onChange={(e) => {
                  setLoading(true);
                  setProjectKey(e.target.value);
                }}
              >
                {projects.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name} ({p.key})
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="field w-64"
                value={manualKey}
                onChange={(e) => setManualKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setLoading(true);
                    setProjectKey(manualKey.trim());
                  }
                }}
                placeholder="project key"
              />
            )}
          </label>
          <button
            type="button"
            className="btn-gradient flex items-center gap-2"
            onClick={() => {
              setLoading(true);
              if (!projects.length) setProjectKey(manualKey.trim());
              else void load();
            }}
          >
            <RefreshCw size={15} /> Reload
          </button>
        </div>
        {overview?.available ? <GateBadge gate={overview.qualityGate} /> : null}
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
            Connect SonarQube above (or set a token in the API environment) and run a scan. Results
            then appear here for project{" "}
            <code className="rounded bg-(--surface-soft) px-1">{overview.projectKey || "—"}</code>.
          </p>
        </div>
      ) : overview && overview.available && measures ? (
        <div className="grid gap-6">
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <RatingBadge label="Reliability" rating={measures.reliabilityRating} />
            <RatingBadge label="Security" rating={measures.securityRating} />
            <RatingBadge label="Maintainability" rating={measures.maintainabilityRating} />
          </section>

          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Bugs" value={measures.bugs ?? 0} icon={Bug} />
            <StatTile label="Vulnerabilities" value={measures.vulnerabilities ?? 0} icon={ShieldAlert} />
            <StatTile label="Code smells" value={measures.codeSmells ?? 0} icon={Wind} />
            <StatTile label="Coverage" value={measures.coverage === null ? "—" : `${measures.coverage}%`} icon={Percent} />
            <StatTile label="Duplication" value={measures.duplicatedLinesDensity === null ? "—" : `${measures.duplicatedLinesDensity}%`} icon={Copy} />
            <StatTile label="Security hotspots" value={measures.securityHotspots ?? 0} icon={ShieldQuestion} />
            <StatTile label="Tech debt" value={formatDebt(measures.techDebtMinutes)} icon={Timer} />
            <StatTile label="Lines of code" value={measures.linesOfCode ?? 0} icon={FileCode2} />
          </section>

          <div className="flex flex-wrap gap-4 text-xs">
            <a href={`${sonarBaseUrl}/dashboard?id=${encodeURIComponent(overview.projectKey)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-(--accent) hover:underline">
              Open in SonarQube <ExternalLink size={12} />
            </a>
            <a href={`${sonarBaseUrl}/project/issues?id=${encodeURIComponent(overview.projectKey)}&resolved=false`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-(--accent) hover:underline">
              View all issues <ExternalLink size={12} />
            </a>
          </div>

          <section className="glass rounded-xl p-5">
            <div className="mb-4 flex items-center gap-2">
              <Users size={18} className="text-(--accent)" />
              <h2 className="text-lg font-bold text-(--text)">By developer</h2>
              <span className="text-xs text-(--muted)">attributed via git blame — evidence, not exact fault</span>
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
                              <p className="truncate font-semibold text-(--text)">{dev.employee?.name ?? dev.author}</p>
                              <p className="truncate text-xs text-(--muted)">{dev.employee ? dev.author : "unmapped git author"}</p>
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
                                <span key={sev} className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${severityClass(sev)}`}>
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
              Community Edition analyzes the main branch only (post-merge). PR/branch analysis needs
              SonarCloud or Developer Edition.
            </p>
          ) : null}
        </div>
      ) : null}
    </DashboardChrome>
  );
}
