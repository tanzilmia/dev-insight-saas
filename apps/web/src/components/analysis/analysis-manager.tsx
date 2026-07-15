"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarDays,
  FileDiff,
  FileText,
  GitCompareArrows,
  Loader2,
  Sparkles,
  Users,
  X
} from "lucide-react";

import {
  type AnalysisCommit,
  type AnalysisPeriod,
  type GeneratedReport,
  type Project,
  type ProjectAnalysis,
  type ProjectBranch,
  generateReport,
  getApiErrorMessage,
  getEmployeeCommits,
  getProjectAnalysis,
  listProjectBranches,
  listProjects
} from "@/lib/api";
import { canManage, useSession } from "@/lib/use-session";
import {
  DashboardChrome,
  DashboardLoading
} from "@/components/dashboard/dashboard-chrome";
import { BarList, StatTile } from "@/components/statistics/charts";
import { CodeHealthCard } from "@/components/statistics/code-health-card";
import { CollaborationPanel } from "./collaboration-panel";
import { ComparePanel } from "./compare-panel";
import { AwardsPanel } from "./awards-panel";
import {
  ReportInsightsPanel,
  ReportThemesPanel,
  stripStructuredSections,
  stripThemesSection
} from "@/components/reports/report-insights-panel";

const PERIODS: { value: AnalysisPeriod; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_7_days", label: "Last 7 days" },
  { value: "last_30_days", label: "Last 30 days" },
  { value: "last_90_days", label: "Last 90 days" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "custom", label: "Custom range" }
];

const markdownPlugins = [remarkGfm];

function roleChip(role: string) {
  return role === "LEAD"
    ? "bg-(--accent-soft) text-(--accent)"
    : "bg-(--surface-soft) text-(--muted)";
}

function categoryPill(category: string) {
  if (category === "Feature") return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
  if (category === "Fix") return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  return "bg-(--surface-soft) text-(--muted)";
}

export function AnalysisManager({
  initialProjectId,
  hideProjectSelector = false,
  embedded = false
}: {
  /** Lock the analysis to one project (the project details page). */
  initialProjectId?: string;
  hideProjectSelector?: boolean;
  /** Render without the dashboard chrome so it nests inside another page. */
  embedded?: boolean;
} = {}) {
  const { session, status, activeOrganization, logout } = useSession();
  const organizationId = activeOrganization?.id;
  const manageable = canManage(activeOrganization?.role);

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(initialProjectId ?? "");
  const [branches, setBranches] = useState<ProjectBranch[]>([]);
  const [branch, setBranch] = useState(""); // "" = all branches
  const [period, setPeriod] = useState<AnalysisPeriod>("last_30_days");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [analysis, setAnalysis] = useState<ProjectAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [detailUserId, setDetailUserId] = useState<string | null>(null);
  const [detailCommits, setDetailCommits] = useState<AnalysisCommit[] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Compare selection: up to two members from the SAME loaded window, so the
  // fairness guard (same project + same period) holds by construction.
  const [compareIds, setCompareIds] = useState<string[]>([]);

  const [aiReport, setAiReport] = useState<GeneratedReport | null>(null);
  const [generating, setGenerating] = useState(false);

  // Custom range is ready when both dates are set and not inverted
  // (YYYY-MM-DD strings compare correctly).
  const customInvalid = period === "custom" && Boolean(customFrom && customTo) && customFrom > customTo;
  const rangeReady =
    period !== "custom" || (Boolean(customFrom && customTo) && customFrom <= customTo);
  const customRange =
    period === "custom" && rangeReady ? { from: customFrom, to: customTo } : undefined;

  useEffect(() => {
    // With a locked project there is no selector, so the project list (used
    // only for option labels + auto-pick) is not needed.
    if (!organizationId || !manageable || hideProjectSelector) {
      return;
    }

    listProjects(organizationId)
      .then((rows) => {
        setProjects(rows);
        setProjectId((current) => current || rows[0]?.id || "");
        if (!rows.length) {
          setLoading(false);
        }
      })
      .catch((caught) => {
        setError(getApiErrorMessage(caught));
        setLoading(false);
      });
  }, [organizationId, manageable, hideProjectSelector]);

  // Branch selector options for the picked project ("" = all branches).
  useEffect(() => {
    if (!organizationId || !projectId || !manageable) {
      return;
    }

    listProjectBranches(organizationId, projectId)
      .then((rows) => {
        setBranches(rows);
        setBranch("");
      })
      .catch(() => {
        setBranches([]);
        setBranch("");
      });
  }, [organizationId, projectId, manageable]);

  // State is set only inside .then/.catch/.finally callbacks (deferred), so
  // this is safe to call from an effect (react-hooks/set-state-in-effect).
  const load = useCallback(() => {
    if (!organizationId || !projectId || !manageable || !rangeReady) {
      return Promise.resolve();
    }
    return getProjectAnalysis(
      organizationId,
      projectId,
      period,
      period === "custom" ? { from: customFrom, to: customTo } : undefined,
      branch || undefined
    )
      .then((data) => {
        setAnalysis(data);
        setError(null);
        setDetailUserId(null);
        setDetailCommits(null);
        setCompareIds([]);
      })
      .catch((caught) => {
        setError(getApiErrorMessage(caught));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [organizationId, projectId, manageable, period, customFrom, customTo, rangeReady, branch]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openDetails(userId: string) {
    if (detailUserId === userId) {
      setDetailUserId(null);
      setDetailCommits(null);
      return;
    }
    if (!organizationId || !projectId) {
      return;
    }

    setDetailUserId(userId);
    setDetailCommits(null);
    setDetailLoading(true);

    try {
      const rows = await getEmployeeCommits(
        organizationId,
        projectId,
        userId,
        period,
        customRange,
        branch || undefined
      );
      setDetailCommits(rows);
    } catch (caught) {
      setError(getApiErrorMessage(caught));
      setDetailUserId(null);
    } finally {
      setDetailLoading(false);
    }
  }

  function toggleCompare(userId: string) {
    setCompareIds((current) => {
      if (current.includes(userId)) {
        return current.filter((id) => id !== userId);
      }
      return current.length >= 2 ? current : [...current, userId];
    });
  }

  async function handleAiReport() {
    if (!organizationId || !projectId || !rangeReady) {
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      const report = await generateReport({
        organizationId,
        reportType: "project",
        projectId,
        period,
        ...(period === "custom" ? { customRange: { from: customFrom, to: customTo } } : {}),
        ...(branch ? { branch } : {})
      });
      setAiReport(report);
    } catch (caught) {
      setError(getApiErrorMessage(caught));
    } finally {
      setGenerating(false);
    }
  }

  if (status === "loading") {
    return <DashboardLoading />;
  }

  if (!session) {
    return null;
  }

  const withChrome = (node: React.ReactNode) =>
    embedded ? (
      <>{node}</>
    ) : (
      <DashboardChrome email={session.user.email} onLogout={logout}>
        {node}
      </DashboardChrome>
    );

  if (!manageable) {
    return withChrome(
      <div className="glass rounded-xl p-8 text-center text-sm font-bold text-(--muted)">
        This area is available to owners and managers.
      </div>
    );
  }

  const hasActivity = analysis !== null && analysis.totals.commits > 0;
  const detailEmployee = detailUserId
    ? analysis?.employees.find((employee) => employee.userId === detailUserId)
    : undefined;

  return withChrome(
    <div className="grid gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="mb-1 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-(--accent)">
              <BarChart3 size={14} />
              Analysis
            </p>
            <h1 className="text-lg font-bold tracking-tight text-(--text)">
              Who is working on what
            </h1>
            <p className="text-sm text-(--muted)">
              Per-employee activity signals for one project, from collected Git history.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {loading && analysis ? (
              <Loader2 size={16} className="animate-spin text-(--muted)" aria-label="Loading" />
            ) : null}
            {!hideProjectSelector ? (
              <select
                value={projectId}
                onChange={(event) => {
                  setProjectId(event.target.value);
                  setLoading(true);
                  setAiReport(null);
                }}
                aria-label="Project"
                className="field rounded-lg px-3 py-2 text-sm font-medium text-(--text)"
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            ) : null}
            <select
              value={branch}
              onChange={(event) => {
                setBranch(event.target.value);
                setLoading(true);
              }}
              aria-label="Branch"
              className="field rounded-lg px-3 py-2 text-sm font-medium text-(--text)"
            >
              <option value="">All branches</option>
              {branches.map((option) => (
                <option key={option.name} value={option.name}>
                  {option.name}
                  {option.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
            <select
              value={period}
              onChange={(event) => {
                setPeriod(event.target.value as AnalysisPeriod);
                if (event.target.value !== "custom") {
                  setLoading(true);
                }
                setAiReport(null);
              }}
              aria-label="Analysis period"
              className="field rounded-lg px-3 py-2 text-sm font-medium text-(--text)"
            >
              {PERIODS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleAiReport}
              disabled={generating || !rangeReady || !projectId}
              title={
                branch
                  ? `Ask the AI to write a narrative report for this window on “${branch}”`
                  : "Ask the AI to write a narrative report for this exact window"
              }
              className="btn-gradient inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-bold"
            >
              {generating ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Sparkles size={15} />
              )}
              AI report
            </button>
          </div>
        </div>

        {period === "custom" ? (
          <div className="glass flex flex-wrap items-end gap-3 rounded-xl p-4">
            <label className="grid gap-1.5 text-xs font-bold uppercase tracking-wide text-(--muted)">
              From
              <input
                type="date"
                value={customFrom}
                onChange={(event) => setCustomFrom(event.target.value)}
                className="field rounded-lg px-3 py-2 text-sm font-medium text-(--text)"
              />
            </label>
            <label className="grid gap-1.5 text-xs font-bold uppercase tracking-wide text-(--muted)">
              To
              <input
                type="date"
                value={customTo}
                onChange={(event) => setCustomTo(event.target.value)}
                className="field rounded-lg px-3 py-2 text-sm font-medium text-(--text)"
              />
            </label>
            {customInvalid ? (
              <p className="pb-2 text-xs font-bold text-red-600 dark:text-red-400">
                “From” must be on or before “To”.
              </p>
            ) : !rangeReady ? (
              <p className="pb-2 text-xs text-(--muted)">
                Pick both dates to load the analysis.
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <div className="glass rounded-xl p-5 text-sm font-medium text-red-600 dark:text-red-400">
            {error}
          </div>
        ) : null}

        {aiReport ? (
          <div className="glass rounded-xl p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-bold text-(--text)">{aiReport.title}</h2>
                {aiReport.cached ? (
                  <span className="rounded-full bg-(--surface-soft) px-2.5 py-0.5 text-[11px] font-bold text-(--muted)">
                    Cached
                  </span>
                ) : null}
                {aiReport.status === "PARTIAL" ? (
                  <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-bold text-amber-600 dark:text-amber-400">
                    Template (no AI configured)
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/dashboard/reports?report=${aiReport.reportId}`}
                  className="text-xs font-bold text-(--accent) hover:underline"
                >
                  View in Reports →
                </Link>
                <button
                  type="button"
                  onClick={() => setAiReport(null)}
                  aria-label="Dismiss report"
                  className="grid h-6 w-6 place-items-center rounded-full text-(--muted) transition hover:bg-(--surface-soft) hover:text-(--text)"
                >
                  <X size={13} />
                </button>
              </div>
            </div>
            <div className="mb-3">
              <ReportInsightsPanel comparison={aiReport.comparison} insights={aiReport.insights} />
            </div>
            {aiReport.themes?.length ? (
              <div className="mb-3">
                <ReportThemesPanel themes={aiReport.themes} />
              </div>
            ) : null}
            <div className="report-md glass-soft max-h-128 overflow-y-auto rounded-lg px-4 py-3 text-sm">
              <ReactMarkdown remarkPlugins={markdownPlugins}>
                {(() => {
                  let md =
                    aiReport.comparison || aiReport.insights
                      ? stripStructuredSections(aiReport.markdown)
                      : aiReport.markdown;
                  if (aiReport.themes?.length) {
                    md = stripThemesSection(md);
                  }
                  return md;
                })()}
              </ReactMarkdown>
            </div>
          </div>
        ) : null}

        {!projects.length && !loading ? (
          <div className="glass rounded-xl p-10 text-center">
            <p className="text-sm font-semibold text-(--text)">No projects yet.</p>
            <p className="mt-1 text-sm text-(--muted)">
              Create a project and assign repositories + a team first.
            </p>
          </div>
        ) : loading && !analysis ? (
          <div className="glass grid place-items-center rounded-xl p-16 text-(--muted)">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : analysis ? (
          <>
            {analysis.truncated ? (
              <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs font-bold text-amber-600 dark:text-amber-400">
                Large period — showing signals from the most recent commits only.
              </p>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile label="Commits" value={analysis.totals.commits} icon={Activity} />
              <StatTile
                label="Lines changed (filtered)"
                value={analysis.totals.filteredLines}
                icon={FileDiff}
              />
              <StatTile
                label="Active contributors"
                value={analysis.totals.activeContributors}
                icon={Users}
              />
              <StatTile
                label="Team members"
                value={analysis.totals.members}
                icon={CalendarDays}
              />
            </div>

            {/* Team-level codebase health (per-project, not per-person) — reduces
                the "blame one person" risk. Skipped when embedded, since the
                project-detail page already shows this card. */}
            {!embedded && organizationId && projectId ? (
              <CodeHealthCard organizationId={organizationId} projectId={projectId} />
            ) : null}

            {!embedded ? (
              <CollaborationPanel organizationId={organizationId} projectId={projectId} />
            ) : null}

            {organizationId && projectId ? (
              <AwardsPanel
                organizationId={organizationId}
                scope={projectId}
                projectName={projects.find((project) => project.id === projectId)?.name ?? null}
                canManage={manageable}
              />
            ) : null}

            {compareIds.length === 1 ? (
              <div className="glass flex items-center justify-between rounded-xl px-4 py-2.5">
                <p className="inline-flex items-center gap-2 text-xs font-bold text-(--muted)">
                  <GitCompareArrows size={14} className="text-(--accent)" />
                  Select one more member to compare.
                </p>
                <button
                  type="button"
                  onClick={() => setCompareIds([])}
                  aria-label="Clear selection"
                  className="grid h-6 w-6 place-items-center rounded-full text-(--muted) transition hover:bg-(--surface-soft) hover:text-(--text)"
                >
                  <X size={13} />
                </button>
              </div>
            ) : null}

            {compareIds.length === 2
              ? (() => {
                  const compareLeft = analysis.employees.find(
                    (employee) => employee.userId === compareIds[0]
                  );
                  const compareRight = analysis.employees.find(
                    (employee) => employee.userId === compareIds[1]
                  );
                  return compareLeft && compareRight ? (
                    <ComparePanel
                      left={compareLeft}
                      right={compareRight}
                      daysInPeriod={analysis.daysInPeriod}
                      onClose={() => setCompareIds([])}
                    />
                  ) : null;
                })()
              : null}

            {analysis.employees.length ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {analysis.employees.map((employee) => (
                  <div key={employee.userId} className="glass rounded-xl p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-(--text)">
                          <span className="mr-1.5 text-(--muted)">#{employee.rank}</span>
                          {employee.name}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-(--muted)">
                          {employee.usernames.length
                            ? employee.usernames.map((name) => `@${name}`).join(", ")
                            : employee.email}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${roleChip(employee.projectRole)}`}
                      >
                        {employee.projectRole}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-(--surface-soft) px-2 py-2">
                        <p className="text-base font-black text-(--text)">
                          {employee.commits.toLocaleString()}
                        </p>
                        <p className="text-[10px] font-bold uppercase tracking-wide text-(--muted)">
                          Commits
                        </p>
                      </div>
                      <div className="rounded-lg bg-(--surface-soft) px-2 py-2">
                        <p className="text-base font-black text-(--text)">
                          {employee.filteredLines.toLocaleString()}
                        </p>
                        <p className="text-[10px] font-bold uppercase tracking-wide text-(--muted)">
                          Lines
                        </p>
                      </div>
                      <div className="rounded-lg bg-(--surface-soft) px-2 py-2">
                        <p className="text-base font-black text-(--text)">
                          {employee.activeDays}
                          <span className="text-xs font-bold text-(--muted)">
                            /{analysis.daysInPeriod}
                          </span>
                        </p>
                        <p className="text-[10px] font-bold uppercase tracking-wide text-(--muted)">
                          Active days
                        </p>
                      </div>
                    </div>

                    {employee.commits > 0 ? (
                      <>
                        <div className="mt-3">
                          <BarList
                            items={Object.entries(employee.categories)
                              .sort((a, b) => b[1] - a[1])
                              .slice(0, 4)
                              .map(([category, count]) => ({ label: category, value: count }))}
                          />
                        </div>

                        <p className="mt-3 text-xs text-(--muted)">
                          {employee.moduleCount} area{employee.moduleCount === 1 ? "" : "s"}
                          {employee.topModules.length
                            ? ` · ${employee.topModules.join(", ")}`
                            : ""}
                        </p>

                        {employee.riskyCommits > 0 || employee.largeCommits > 0 ? (
                          <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-amber-600 dark:text-amber-400">
                            <AlertTriangle size={13} />
                            {[
                              employee.riskyCommits > 0
                                ? `${employee.riskyCommits} risky commit${employee.riskyCommits === 1 ? "" : "s"}`
                                : null,
                              employee.largeCommits > 0
                                ? `${employee.largeCommits} very large`
                                : null
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        ) : null}

                        <div className="mt-3 flex items-center justify-between gap-2 border-t border-(--border) pt-3">
                          <span className="min-w-0 truncate text-[11px] text-(--muted)">
                            {employee.lastCommitAt
                              ? `Last commit ${new Date(employee.lastCommitAt).toLocaleDateString()}`
                              : ""}
                          </span>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void openDetails(employee.userId)}
                              className={`inline-flex items-center gap-1.5 rounded-md border border-(--border) px-2.5 py-1 text-[11px] font-bold transition hover:bg-(--surface) ${
                                detailUserId === employee.userId
                                  ? "text-(--accent)"
                                  : "text-(--text)"
                              }`}
                            >
                              <FileText size={12} />
                              {detailUserId === employee.userId ? "Hide details" : "Details"}
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleCompare(employee.userId)}
                              disabled={
                                compareIds.length >= 2 && !compareIds.includes(employee.userId)
                              }
                              className={`inline-flex items-center gap-1.5 rounded-md border border-(--border) px-2.5 py-1 text-[11px] font-bold transition hover:bg-(--surface) disabled:cursor-not-allowed disabled:opacity-50 ${
                                compareIds.includes(employee.userId)
                                  ? "text-(--accent)"
                                  : "text-(--text)"
                              }`}
                            >
                              <GitCompareArrows size={12} />
                              Compare
                            </button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <p className="text-xs text-(--muted)">No commits in this period.</p>
                        <button
                          type="button"
                          onClick={() => toggleCompare(employee.userId)}
                          disabled={
                            compareIds.length >= 2 && !compareIds.includes(employee.userId)
                          }
                          className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border border-(--border) px-2.5 py-1 text-[11px] font-bold transition hover:bg-(--surface) disabled:cursor-not-allowed disabled:opacity-50 ${
                            compareIds.includes(employee.userId)
                              ? "text-(--accent)"
                              : "text-(--text)"
                          }`}
                        >
                          <GitCompareArrows size={12} />
                          Compare
                        </button>
                      </div>
                    )}

                    {!employee.hasGitIdentity ? (
                      <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] font-bold text-amber-600 dark:text-amber-400">
                        No GitHub identity linked — add one on the Employees page.
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="glass rounded-xl p-10 text-center">
                <p className="text-sm font-semibold text-(--text)">
                  This project has no team members yet.
                </p>
                <p className="mt-1 text-sm text-(--muted)">
                  Assign employees to the project to see their activity here.
                </p>
              </div>
            )}

            {detailUserId && detailEmployee ? (
              <div className="glass rounded-xl p-5">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-bold text-(--text)">
                    Commits — {detailEmployee.name}
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      setDetailUserId(null);
                      setDetailCommits(null);
                    }}
                    aria-label="Close details"
                    className="grid h-6 w-6 place-items-center rounded-full text-(--muted) transition hover:bg-(--surface-soft) hover:text-(--text)"
                  >
                    <X size={13} />
                  </button>
                </div>
                {detailLoading ? (
                  <div className="grid place-items-center py-8 text-(--muted)">
                    <Loader2 size={18} className="animate-spin" />
                  </div>
                ) : detailCommits && detailCommits.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-(--border) text-left text-[11px] uppercase tracking-wide text-(--muted)">
                          <th className="px-3 py-2 font-semibold">Date</th>
                          <th className="px-3 py-2 font-semibold">Commit</th>
                          <th className="px-3 py-2 font-semibold">Category</th>
                          <th className="px-3 py-2 text-right font-semibold">+/-</th>
                          <th className="px-3 py-2 text-right font-semibold">Files</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailCommits.map((commit) => (
                          <tr
                            key={commit.sha}
                            className="border-b border-(--border) last:border-0 hover:bg-(--surface-soft)"
                          >
                            <td className="whitespace-nowrap px-3 py-2 text-xs text-(--muted)">
                              {new Date(commit.committedAt).toLocaleDateString()}
                            </td>
                            <td className="max-w-md px-3 py-2">
                              <p className="truncate text-(--text)">{commit.message}</p>
                              <p className="font-mono text-[11px] text-(--muted)">{commit.sha}</p>
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${categoryPill(commit.category)}`}
                              >
                                {commit.category}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                              <span className="text-emerald-600 dark:text-emerald-400">
                                +{commit.additions}
                              </span>{" "}
                              <span className="text-red-600 dark:text-red-400">
                                -{commit.deletions}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right text-xs text-(--muted)">
                              {commit.changedFilesCount}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="py-4 text-center text-sm text-(--muted)">
                    No commits found for this member in the selected window.
                  </p>
                )}
              </div>
            ) : null}

            {analysis.unmapped.length ? (
              <div className="glass rounded-xl p-5">
                <h2 className="mb-1 text-sm font-bold text-(--text)">
                  Unattributed activity
                </h2>
                <p className="mb-3 text-xs text-(--muted)">
                  Commits in this project by Git identities that are not linked to a
                  team member.{" "}
                  <Link href="/dashboard/contributors" className="underline">
                    Map them on the Contributors page →
                  </Link>
                </p>
                <BarList
                  items={analysis.unmapped.slice(0, 8).map((row) => ({
                    label: row.name,
                    value: row.commits,
                    sub: `${row.filteredLines.toLocaleString()} lines`
                  }))}
                  unit=" commits"
                />
              </div>
            ) : null}

            {!hasActivity ? (
              <div className="glass rounded-xl p-10 text-center">
                <p className="text-sm font-semibold text-(--text)">
                  No activity in this period.
                </p>
                <p className="mt-1 text-sm text-(--muted)">
                  Make sure the project has repositories assigned and activity collected.
                </p>
              </div>
            ) : null}

            <p className="text-center text-[11px] text-(--muted)">
              Activity signals from Git history — volume is not the same as impact.
            </p>
          </>
        ) : null}
      </div>
  );
}
