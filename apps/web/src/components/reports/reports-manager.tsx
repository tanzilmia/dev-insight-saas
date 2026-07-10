"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  FileText,
  History,
  Link2,
  Loader2,
  Share2,
  Sparkles,
  Trash2
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  type Employee,
  type GeneratedReport,
  type Project,
  type ReportDetail,
  type ReportPeriod,
  type ReportStatistics,
  type ReportSummary,
  type ReportType,
  type TrackedRepository,
  deleteReport,
  generateReport,
  getApiErrorMessage,
  getReport,
  listEmployees,
  listProjects,
  listReports,
  listRepositories,
  shareReport,
  unshareReport
} from "@/lib/api";
import { useSession } from "@/lib/use-session";
import {
  DashboardChrome,
  DashboardLoading
} from "@/components/dashboard/dashboard-chrome";

const REPORT_TYPES: { value: ReportType; label: string }[] = [
  { value: "repository", label: "Repository" },
  { value: "project", label: "Project" },
  { value: "employee", label: "Employee" },
  { value: "team", label: "Team" }
];

const PERIODS: { value: ReportPeriod; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_7_days", label: "Last 7 days" },
  { value: "last_30_days", label: "Last 30 days" },
  { value: "last_90_days", label: "Last 90 days" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "custom", label: "Custom range" }
];

const fieldClass =
  "field w-full rounded-lg px-3.5 py-2.5 text-sm font-medium text-(--text) placeholder:font-normal";

const reportMarkdownPlugins = [remarkGfm];
const emptyStats: ReportStatistics = {
  commits: 0,
  additions: 0,
  deletions: 0,
  filesChanged: 0
};

function ReportMarkdown({ markdown, expanded }: { markdown: string; expanded: boolean }) {
  return (
    <div
      className={`report-md glass-soft overflow-auto rounded-2xl p-5 ${
        expanded ? "max-h-[70vh]" : "max-h-96"
      }`}
    >
      <ReactMarkdown remarkPlugins={reportMarkdownPlugins}>{markdown}</ReactMarkdown>
    </div>
  );
}

function formatDate(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

function StatusBadge({ status }: { status: string }) {
  const generated = status === "GENERATED";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-black ${
        generated
          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
      }`}
    >
      {status}
    </span>
  );
}

export function ReportsManager() {
  const { session, status, activeOrganization, logout } = useSession();
  const organizationId = activeOrganization?.id;

  const [repos, setRepos] = useState<TrackedRepository[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [reportType, setReportType] = useState<ReportType>("repository");
  const [repositoryId, setRepositoryId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set());
  const [period, setPeriod] = useState<ReportPeriod>("last_7_days");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GeneratedReport | null>(null);
  const [history, setHistory] = useState<ReportSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<ReportDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    if (!organizationId) {
      return;
    }

    listRepositories(organizationId)
      .then((tracked) => {
        setRepos(tracked);
        setRepositoryId((current) => current || tracked[0]?.id || "");
      })
      .catch(() => setRepos([]));
    listProjects(organizationId)
      .then((list) => {
        setProjects(list);
        setProjectId((current) => current || list[0]?.id || "");
      })
      .catch(() => setProjects([]));
    listEmployees(organizationId)
      .then(setEmployees)
      .catch(() => setEmployees([]));
  }, [organizationId]);

  const refreshHistory = useCallback(() => {
    if (!organizationId) {
      return Promise.resolve().then(() => setHistoryLoading(false));
    }

    return listReports(organizationId)
      .then((reports) => {
        setHistory(reports);
        setHistoryError(null);
      })
      .catch((caught) => {
        setHistoryError(getApiErrorMessage(caught));
      })
      .finally(() => {
        setHistoryLoading(false);
      });
  }, [organizationId]);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  // Deep-link support: /dashboard/reports?report=<id> (e.g. a schedule's "view"
  // link) opens that report on load. Read from the URL on the client only.
  useEffect(() => {
    const reportId = new URLSearchParams(window.location.search).get("report");
    if (reportId) {
      void handleOpenSavedReport(reportId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Read the site origin after mount (client only) to build the share link.
  useEffect(() => {
    Promise.resolve(window.location.origin).then(setOrigin);
  }, []);

  const needsEmployees = reportType === "employee" || reportType === "team";
  const canSubmit =
    !!organizationId &&
    (reportType === "repository" ? !!repositoryId : true) &&
    (reportType === "project" ? !!projectId : true) &&
    (needsEmployees ? selectedEmployeeIds.size > 0 : true) &&
    (period === "custom" ? !!customFrom && !!customTo && customFrom <= customTo : true);

  function toggleEmployee(id: string) {
    setSelectedEmployeeIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!organizationId || !canSubmit) {
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      const report = await generateReport({
        organizationId,
        reportType,
        period,
        ...(reportType === "repository" ? { repositoryId } : {}),
        ...(reportType === "project" ? { projectId } : {}),
        ...(needsEmployees ? { employeeIds: [...selectedEmployeeIds] } : {}),
        ...(period === "custom" ? { customRange: { from: customFrom, to: customTo } } : {}),
        ...(customPrompt.trim() ? { customPrompt: customPrompt.trim() } : {})
      });
      setResult(report);
      setSelectedReport(null);
      setSelectedReportId(report.reportId);
      setShareToken(null);
      setShareCopied(false);
      setDetailError(null);
      setHistoryLoading(true);
      await refreshHistory();
    } catch (caught) {
      setError(getApiErrorMessage(caught));
    } finally {
      setGenerating(false);
    }
  }

  // Reflect an opened history report back into the form, so the selected type,
  // target, and period match what is shown. Reports store exact dates (not a
  // period keyword), so the period is shown as a custom range.
  function syncFormToReport(detail: ReportDetail) {
    setReportType(detail.reportType);
    setRepositoryId(detail.repositoryId ?? "");
    setProjectId(detail.projectId ?? "");
    setSelectedEmployeeIds(
      new Set(
        detail.contributors
          .map((contributor) => contributor.userId)
          .filter((id): id is string => Boolean(id))
      )
    );
    setPeriod("custom");
    setCustomFrom(detail.period.from.slice(0, 10));
    setCustomTo(detail.period.to.slice(0, 10));
  }

  async function handleOpenSavedReport(reportId: string) {
    setSelectedReportId(reportId);
    setSelectedReport(null);
    setResult(null);
    setShareToken(null);
    setShareCopied(false);
    setDetailLoading(true);
    setDetailError(null);

    try {
      const detail = await getReport(reportId);
      setSelectedReport(detail);
      setShareToken(detail.shareToken);
      syncFormToReport(detail);
    } catch (caught) {
      setDetailError(getApiErrorMessage(caught));
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleCopy(markdown: string) {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (e.g. an insecure context) — no-op.
    }
  }

  function handleDownload(title: string, markdown: string) {
    const slug =
      title.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "report";
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${slug}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function handleDelete(reportId: string) {
    if (!window.confirm("Delete this report? This cannot be undone.")) {
      return;
    }

    setDeleting(true);
    try {
      await deleteReport(reportId);
      setResult(null);
      setSelectedReport(null);
      setSelectedReportId(null);
      await refreshHistory();
    } catch (caught) {
      setDetailError(getApiErrorMessage(caught));
    } finally {
      setDeleting(false);
    }
  }

  async function copyShareLink(token: string) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/share/${token}`);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 1500);
    } catch {
      // Clipboard unavailable — the link stays visible for manual copy.
    }
  }

  async function handleShare(reportId: string) {
    setShareBusy(true);
    setDetailError(null);
    try {
      const token = await shareReport(reportId);
      setShareToken(token);
      await copyShareLink(token);
    } catch (caught) {
      setDetailError(getApiErrorMessage(caught));
    } finally {
      setShareBusy(false);
    }
  }

  async function handleUnshare(reportId: string) {
    setShareBusy(true);
    setDetailError(null);
    try {
      await unshareReport(reportId);
      setShareToken(null);
      setShareCopied(false);
    } catch (caught) {
      setDetailError(getApiErrorMessage(caught));
    } finally {
      setShareBusy(false);
    }
  }

  if (status === "loading") {
    return <DashboardLoading />;
  }

  if (!session) {
    return null;
  }

  const activeEmployees = employees.filter((employee) => employee.status === "ACTIVE");
  const renderedReport = selectedReport
    ? {
        reportId: selectedReport.id,
        title: selectedReport.title,
        markdown: selectedReport.markdown,
        status: selectedReport.status,
        statistics: selectedReport.statistics ?? emptyStats,
        pending: [] as string[],
        warnings: [] as string[],
        cached: false,
        savedAt: selectedReport.createdAt
      }
    : result
      ? {
          reportId: result.reportId,
          title: result.title,
          markdown: result.markdown,
          status: result.status,
          statistics: result.statistics,
          pending: result.pending,
          warnings: result.warnings ?? [],
          cached: result.cached ?? false,
          savedAt: null
        }
      : null;

  return (
    <DashboardChrome email={session.user.email} onLogout={logout}>
      <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
        <div className="grid gap-5">
          <form onSubmit={handleSubmit} className="glass animate-rise grid gap-4 rounded-xl p-5">
            <div>
              <p className="mb-2 inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.28em] text-(--accent)">
                <Sparkles size={14} />
                Reports
              </p>
              <h1 className="text-xl font-bold tracking-tight text-(--text)">
                Generate a report
              </h1>
              <p className="mt-2 text-sm leading-6 text-(--muted)">
                Requests flow through OpenClaw, which resolves the target and
                period, then orchestrates the report tools.
              </p>
            </div>

            <div className="grid gap-2">
              <span className="text-xs font-black uppercase tracking-wide text-(--muted)">
                Report type
              </span>
              <div className="glass-soft grid grid-cols-4 rounded-full p-1">
                {REPORT_TYPES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setReportType(option.value)}
                    className={`rounded-full px-2 py-2 text-xs font-bold transition ${
                      reportType === option.value
                        ? "btn-gradient"
                        : "text-(--muted) hover:text-(--text)"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {reportType === "repository" ? (
              <label className="grid gap-2 text-sm font-bold text-(--text)">
                Repository
                <select
                  value={repositoryId}
                  onChange={(event) => setRepositoryId(event.target.value)}
                  className={fieldClass}
                >
                  {repos.length === 0 ? <option value="">No repositories</option> : null}
                  {repos.map((repo) => (
                    <option key={repo.id} value={repo.id}>
                      {repo.fullName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {reportType === "project" ? (
              <label className="grid gap-2 text-sm font-bold text-(--text)">
                Project
                <select
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                  className={fieldClass}
                >
                  {projects.length === 0 ? <option value="">No projects</option> : null}
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {needsEmployees ? (
              <div className="grid gap-2">
                <span className="text-sm font-bold text-(--text)">
                  Employees ({selectedEmployeeIds.size} selected)
                </span>
                {activeEmployees.length === 0 ? (
                  <p className="glass-soft rounded-2xl px-4 py-3 text-sm font-bold text-(--muted)">
                    No employees yet.
                  </p>
                ) : (
                  <ul className="grid max-h-44 gap-1.5 overflow-y-auto pr-1">
                    {activeEmployees.map((employee) => {
                      const checked = selectedEmployeeIds.has(employee.id);
                      return (
                        <li key={employee.id}>
                          <button
                            type="button"
                            onClick={() => toggleEmployee(employee.id)}
                            className={`glass-soft glass-hover flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-bold text-(--text) ${
                              checked ? "ring-2 ring-(--accent-2)" : ""
                            }`}
                          >
                            {employee.name}
                            <span
                              className={`grid h-4 w-4 place-items-center rounded border text-[10px] ${
                                checked
                                  ? "btn-gradient border-transparent"
                                  : "border-(--field-border)"
                              }`}
                            >
                              {checked ? "✓" : ""}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ) : null}

            <label className="grid gap-2 text-sm font-bold text-(--text)">
              Period
              <select
                value={period}
                onChange={(event) => setPeriod(event.target.value as ReportPeriod)}
                className={fieldClass}
              >
                {PERIODS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            {period === "custom" ? (
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-2 text-xs font-bold uppercase tracking-wide text-(--muted)">
                  From
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(event) => setCustomFrom(event.target.value)}
                    className={fieldClass}
                  />
                </label>
                <label className="grid gap-2 text-xs font-bold uppercase tracking-wide text-(--muted)">
                  To
                  <input
                    type="date"
                    value={customTo}
                    onChange={(event) => setCustomTo(event.target.value)}
                    className={fieldClass}
                  />
                </label>
              </div>
            ) : null}

            {period === "custom" && customFrom && customTo && customFrom > customTo ? (
              <p className="-mt-1 text-xs font-bold text-red-600 dark:text-red-400">
                “From” must be on or before “To”.
              </p>
            ) : null}

            <label className="grid gap-2 text-sm font-bold text-(--text)">
              Custom prompt (optional)
              <textarea
                value={customPrompt}
                onChange={(event) => setCustomPrompt(event.target.value)}
                rows={2}
                className={`${fieldClass} resize-none`}
                placeholder="Focus areas or extra instructions"
              />
            </label>

            {error ? (
              <p className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-600 dark:text-red-400">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={generating || !canSubmit}
              className="btn-gradient inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold"
            >
              {generating ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <FileText size={16} />
              )}
              {generating ? "Generating..." : "Generate report"}
            </button>
          </form>

          <section className="glass animate-rise grid gap-4 rounded-xl p-6 [animation-delay:70ms] md:p-7">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="mb-1 inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.24em] text-(--accent)">
                  <History size={14} />
                  History
                </p>
                <h2 className="text-xl font-black tracking-tight text-(--text)">
                  Saved reports
                </h2>
              </div>
              {historyLoading ? (
                <Loader2 size={18} className="animate-spin text-(--muted)" />
              ) : null}
            </div>

            {historyError ? (
              <p className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-600 dark:text-red-400">
                {historyError}
              </p>
            ) : history.length === 0 ? (
              <div className="glass-soft rounded-2xl p-5 text-sm font-bold text-(--muted)">
                No saved reports yet.
              </div>
            ) : (
              <ul className="grid max-h-[28rem] gap-2 overflow-y-auto pr-1">
                {history.map((report) => (
                  <li key={report.id}>
                    <button
                      type="button"
                      onClick={() => void handleOpenSavedReport(report.id)}
                      className={`glass-soft glass-hover w-full rounded-2xl p-4 text-left transition ${
                        selectedReportId === report.id ? "ring-2 ring-(--accent-2)" : ""
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-(--text)">
                            {report.title}
                          </p>
                          <p className="mt-1 text-xs font-bold text-(--muted)">
                            {report.reportType} · {report.targetLabel} ·{" "}
                            {formatDate(report.createdAt)}
                          </p>
                        </div>
                        <StatusBadge status={report.status} />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="animate-rise [animation-delay:80ms] lg:sticky lg:top-6">
          {detailLoading ? (
            <div className="glass-soft grid min-h-64 place-items-center rounded-xl p-10 text-(--muted)">
              <Loader2 size={22} className="animate-spin" />
            </div>
          ) : detailError ? (
            <div className="glass rounded-xl p-6 text-sm font-bold text-red-600 dark:text-red-400">
              {detailError}
            </div>
          ) : !renderedReport ? (
            <div className="glass-soft grid min-h-64 place-items-center rounded-xl p-10 text-center text-sm font-bold text-(--muted)">
              Your generated report will appear here.
            </div>
          ) : (
            <div className="glass rounded-xl p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-black tracking-tight text-(--text)">
                  {renderedReport.title}
                </h2>
                <div className="flex items-center gap-2">
                  {renderedReport.cached ? (
                    <span className="inline-flex items-center rounded-full bg-(--surface-soft) px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-(--muted)">
                      Cached
                    </span>
                  ) : null}
                  <StatusBadge status={renderedReport.status} />
                </div>
              </div>
              {renderedReport.savedAt ? (
                <p className="mb-4 text-xs font-black uppercase tracking-wide text-(--muted)">
                  Saved {formatDate(renderedReport.savedAt)}
                </p>
              ) : null}

              <div className="mb-4 grid grid-cols-4 gap-2 text-center">
                {[
                  ["Commits", renderedReport.statistics.commits],
                  ["+Lines", renderedReport.statistics.additions],
                  ["-Lines", renderedReport.statistics.deletions],
                  ["Files", renderedReport.statistics.filesChanged]
                ].map(([label, value]) => (
                  <div key={label} className="glass-soft rounded-2xl px-2 py-3">
                    <p className="text-lg font-black text-(--text)">{value}</p>
                    <p className="text-[10px] font-black uppercase tracking-wide text-(--muted)">
                      {label}
                    </p>
                  </div>
                ))}
              </div>

              {renderedReport.warnings.length ? (
                <div className="mb-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs font-bold text-amber-700 dark:text-amber-400">
                  <p className="mb-1 uppercase tracking-wide">Heads up</p>
                  <ul className="grid gap-1">
                    {renderedReport.warnings.map((warning, index) => (
                      <li key={index}>• {warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="mb-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopy(renderedReport.markdown)}
                  className="glass-soft glass-hover inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-(--text)"
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  type="button"
                  onClick={() => handleDownload(renderedReport.title, renderedReport.markdown)}
                  className="glass-soft glass-hover inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-(--text)"
                >
                  <Download size={13} />
                  Download
                </button>
                <button
                  type="button"
                  onClick={() => void handleShare(renderedReport.reportId)}
                  disabled={shareBusy}
                  className="glass-soft glass-hover inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-(--text) disabled:opacity-50"
                >
                  {shareBusy ? <Loader2 size={13} className="animate-spin" /> : <Share2 size={13} />}
                  {shareToken ? "Shared" : "Share"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(renderedReport.reportId)}
                  disabled={deleting}
                  className="glass-soft glass-hover ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-red-600 disabled:opacity-50 dark:text-red-400"
                >
                  {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  Delete
                </button>
              </div>

              {shareToken ? (
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-(--border) bg-(--surface-soft) px-3 py-2">
                  <Link2 size={13} className="shrink-0 text-(--muted)" />
                  <input
                    readOnly
                    value={`${origin}/share/${shareToken}`}
                    onFocus={(event) => event.currentTarget.select()}
                    className="min-w-0 flex-1 bg-transparent text-xs font-medium text-(--text) outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void copyShareLink(shareToken)}
                    className="shrink-0 text-xs font-bold text-(--accent) hover:underline"
                  >
                    {shareCopied ? "Copied" : "Copy link"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleUnshare(renderedReport.reportId)}
                    disabled={shareBusy}
                    className="shrink-0 text-xs font-bold text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
                  >
                    Unshare
                  </button>
                </div>
              ) : null}

              <ReportMarkdown markdown={renderedReport.markdown} expanded={expanded} />

              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-(--accent)"
              >
                {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                {expanded ? "Collapse" : "Expand"}
              </button>

              {renderedReport.pending.length ? (
                <div className="mt-4 rounded-2xl border border-(--border) bg-(--surface-soft) p-4">
                  <p className="text-xs font-black uppercase tracking-wide text-(--muted)">
                    Notes
                  </p>
                  <ul className="mt-2 grid gap-1 text-sm font-bold text-(--muted)">
                    {renderedReport.pending.map((item) => (
                      <li key={item}>• {item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}

          <p className="mt-4 text-center text-xs font-bold text-(--muted)">
            Need data first?{" "}
            <Link href="/dashboard/repositories" className="text-(--accent) underline">
              Track repositories
            </Link>{" "}
            and{" "}
            <Link href="/dashboard/contributors" className="text-(--accent) underline">
              map contributors
            </Link>
            .
          </p>
        </section>
      </div>
    </DashboardChrome>
  );
}
