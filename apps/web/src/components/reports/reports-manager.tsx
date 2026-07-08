"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileText, Loader2, Sparkles } from "lucide-react";

import {
  type Employee,
  type GeneratedReport,
  type Project,
  type ReportPeriod,
  type ReportType,
  type TrackedRepository,
  generateReport,
  getApiErrorMessage,
  listEmployees,
  listProjects,
  listRepositories
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
  { value: "last_7_days", label: "Last 7 days" },
  { value: "last_30_days", label: "Last 30 days" },
  { value: "custom", label: "Custom range" }
];

const fieldClass =
  "field w-full rounded-2xl px-4 py-3 text-sm font-medium text-(--text) placeholder:font-normal";

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

  const needsEmployees = reportType === "employee" || reportType === "team";
  const canSubmit =
    !!organizationId &&
    (reportType === "repository" ? !!repositoryId : true) &&
    (reportType === "project" ? !!projectId : true) &&
    (needsEmployees ? selectedEmployeeIds.size > 0 : true) &&
    (period === "custom" ? !!customFrom && !!customTo : true);

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

  const activeEmployees = employees.filter((employee) => employee.status === "ACTIVE");

  return (
    <DashboardChrome email={session.user.email} onLogout={logout}>
      <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
        <form onSubmit={handleSubmit} className="glass animate-rise grid gap-5 rounded-[2rem] p-6 md:p-7">
          <div>
            <p className="mb-2 inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.28em] text-(--accent)">
              <Sparkles size={14} />
              Reports
            </p>
            <h1 className="text-3xl font-black tracking-tight text-(--text)">
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
            className="btn-gradient inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3.5 text-sm font-black"
          >
            {generating ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <FileText size={16} />
            )}
            {generating ? "Generating..." : "Generate report"}
          </button>
        </form>

        <section className="animate-rise [animation-delay:80ms] lg:sticky lg:top-6">
          {!result ? (
            <div className="glass-soft grid min-h-64 place-items-center rounded-[2rem] p-12 text-center text-sm font-bold text-(--muted)">
              Your generated report will appear here.
            </div>
          ) : (
            <div className="glass rounded-[2rem] p-6 md:p-7">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-black tracking-tight text-(--text)">
                  {result.title}
                </h2>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-black text-amber-600 dark:text-amber-400">
                  {result.status}
                </span>
              </div>

              <div className="mb-4 grid grid-cols-4 gap-2 text-center">
                {[
                  ["Commits", result.statistics.commits],
                  ["+Lines", result.statistics.additions],
                  ["-Lines", result.statistics.deletions],
                  ["Files", result.statistics.filesChanged]
                ].map(([label, value]) => (
                  <div key={label} className="glass-soft rounded-2xl px-2 py-3">
                    <p className="text-lg font-black text-(--text)">{value}</p>
                    <p className="text-[10px] font-black uppercase tracking-wide text-(--muted)">
                      {label}
                    </p>
                  </div>
                ))}
              </div>

              <pre className="glass-soft max-h-96 overflow-auto whitespace-pre-wrap rounded-2xl p-5 text-sm leading-6 text-(--text)">
                {result.markdown}
              </pre>

              <div className="mt-4 rounded-2xl border border-(--border) bg-(--surface-soft) p-4">
                <p className="text-xs font-black uppercase tracking-wide text-(--muted)">
                  Pending in later phases
                </p>
                <ul className="mt-2 grid gap-1 text-sm font-bold text-(--muted)">
                  {result.pending.map((item) => (
                    <li key={item}>• {item}</li>
                  ))}
                </ul>
              </div>
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
