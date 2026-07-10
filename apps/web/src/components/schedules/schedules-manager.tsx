"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, Loader2, Pause, Play, Plus, Trash2 } from "lucide-react";

import {
  type CreateScheduleInput,
  type Employee,
  type Project,
  type ReportSchedule,
  type ReportType,
  type ScheduleCadence,
  type StatPeriod,
  type TrackedRepository,
  createSchedule,
  deleteSchedule,
  getApiErrorMessage,
  listEmployees,
  listProjects,
  listRepositories,
  listSchedules,
  runScheduleNow,
  updateSchedule
} from "@/lib/api";
import { canManage, useSession } from "@/lib/use-session";
import { DashboardChrome, DashboardLoading } from "@/components/dashboard/dashboard-chrome";

const REPORT_TYPES: { value: ReportType; label: string }[] = [
  { value: "repository", label: "Repo" },
  { value: "project", label: "Project" },
  { value: "employee", label: "Employee" },
  { value: "team", label: "Team" }
];

const PERIODS: { value: StatPeriod; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_7_days", label: "Last 7 days" },
  { value: "last_30_days", label: "Last 30 days" },
  { value: "last_90_days", label: "Last 90 days" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" }
];

const CADENCES: { value: ScheduleCadence; label: string }[] = [
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" }
];

const fieldClass =
  "field w-full rounded-lg px-3.5 py-2.5 text-sm font-medium text-(--text) placeholder:font-normal";

function formatWhen(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function SchedulesManager() {
  const { session, status, activeOrganization, logout } = useSession();
  const organizationId = activeOrganization?.id;
  const manageable = canManage(activeOrganization?.role);

  const [repos, setRepos] = useState<TrackedRepository[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [reportType, setReportType] = useState<ReportType>("project");
  const [repositoryId, setRepositoryId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set());
  const [period, setPeriod] = useState<StatPeriod>("last_7_days");
  const [cadence, setCadence] = useState<ScheduleCadence>("WEEKLY");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [rowNotice, setRowNotice] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!organizationId) {
      return Promise.resolve();
    }
    return listSchedules(organizationId)
      .then((data) => {
        setSchedules(data);
        setLoadError(null);
      })
      .catch((error) => setLoadError(getApiErrorMessage(error)))
      .finally(() => setLoading(false));
  }, [organizationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
    name.trim().length > 0 &&
    (reportType === "repository" ? !!repositoryId : true) &&
    (reportType === "project" ? !!projectId : true) &&
    (needsEmployees ? selectedEmployeeIds.size > 0 : true);

  function toggleEmployee(id: string) {
    setSelectedEmployeeIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !canSubmit) {
      return;
    }
    setCreating(true);
    setFormError(null);

    const input: CreateScheduleInput = {
      organizationId,
      name: name.trim(),
      reportType,
      period,
      cadence,
      ...(reportType === "repository" ? { repositoryId } : {}),
      ...(reportType === "project" ? { projectId } : {}),
      ...(needsEmployees ? { employeeIds: [...selectedEmployeeIds] } : {})
    };

    try {
      await createSchedule(input);
      setName("");
      setSelectedEmployeeIds(new Set());
      await refresh();
    } catch (error) {
      setFormError(getApiErrorMessage(error));
    } finally {
      setCreating(false);
    }
  }

  async function handleRun(schedule: ReportSchedule) {
    setBusyId(schedule.id);
    setRowError(null);
    setRowNotice(null);
    try {
      await runScheduleNow(schedule.id);
      setRowNotice(`Generated a report for “${schedule.name}”.`);
      await refresh();
    } catch (error) {
      setRowError(getApiErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggle(schedule: ReportSchedule) {
    if (!organizationId) return;
    setBusyId(schedule.id);
    setRowError(null);
    try {
      await updateSchedule(schedule.id, { enabled: !schedule.enabled });
      await refresh();
    } catch (error) {
      setRowError(getApiErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(schedule: ReportSchedule) {
    if (!window.confirm(`Delete the schedule “${schedule.name}”? This cannot be undone.`)) {
      return;
    }
    setBusyId(schedule.id);
    setRowError(null);
    try {
      await deleteSchedule(schedule.id);
      await refresh();
    } catch (error) {
      setRowError(getApiErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  function targetLabel(schedule: ReportSchedule) {
    if (schedule.reportType === "repository") {
      return repos.find((repo) => repo.id === schedule.repositoryId)?.fullName ?? "repository";
    }
    if (schedule.reportType === "project") {
      return projects.find((project) => project.id === schedule.projectId)?.name ?? "project";
    }
    return `${schedule.employeeIds.length} employee${schedule.employeeIds.length === 1 ? "" : "s"}`;
  }

  if (status === "loading") {
    return <DashboardLoading />;
  }
  if (!session) {
    return null;
  }

  return (
    <DashboardChrome email={session.user.email} onLogout={logout}>
      <div className="grid gap-6 lg:grid-cols-[380px_1fr] lg:items-start">
        <section className="glass animate-rise rounded-xl p-5">
          <p className="mb-1.5 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-(--accent)">
            <CalendarClock size={14} />
            Schedules
          </p>
          <h1 className="text-xl font-bold tracking-tight text-(--text)">New schedule</h1>
          <p className="mt-1.5 text-sm leading-6 text-(--muted)">
            The system generates this report automatically on the cadence you pick.
          </p>

          {manageable ? (
            <form onSubmit={handleCreate} className="mt-5 grid gap-3.5">
              <label className="grid gap-1.5 text-sm font-semibold text-(--text)">
                Name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  className={fieldClass}
                  placeholder="Weekly CRM report"
                />
              </label>

              <div className="grid gap-1.5">
                <span className="text-sm font-semibold text-(--text)">Report type</span>
                <div className="glass-soft grid grid-cols-4 gap-1 rounded-lg p-1">
                  {REPORT_TYPES.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setReportType(option.value)}
                      className={`truncate rounded-md px-1 py-1.5 text-center text-[11px] font-semibold whitespace-nowrap transition ${
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
                <label className="grid gap-1.5 text-sm font-semibold text-(--text)">
                  Repository
                  <select
                    value={repositoryId}
                    onChange={(event) => setRepositoryId(event.target.value)}
                    className={fieldClass}
                  >
                    {repos.map((repo) => (
                      <option key={repo.id} value={repo.id}>
                        {repo.fullName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {reportType === "project" ? (
                <label className="grid gap-1.5 text-sm font-semibold text-(--text)">
                  Project
                  <select
                    value={projectId}
                    onChange={(event) => setProjectId(event.target.value)}
                    className={fieldClass}
                  >
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {needsEmployees ? (
                <div className="grid gap-1.5">
                  <span className="text-sm font-semibold text-(--text)">Employees</span>
                  <ul className="grid max-h-40 gap-1 overflow-y-auto pr-1">
                    {employees
                      .filter((employee) => employee.status === "ACTIVE")
                      .map((employee) => {
                        const checked = selectedEmployeeIds.has(employee.id);
                        return (
                          <li key={employee.id}>
                            <button
                              type="button"
                              onClick={() => toggleEmployee(employee.id)}
                              className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${
                                checked
                                  ? "border-(--accent) bg-(--accent-soft) text-(--text)"
                                  : "border-(--border) text-(--muted) hover:text-(--text)"
                              }`}
                            >
                              <span className="truncate">{employee.name}</span>
                              {checked ? <span className="text-(--accent)">✓</span> : null}
                            </button>
                          </li>
                        );
                      })}
                  </ul>
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1.5 text-sm font-semibold text-(--text)">
                  Period
                  <select
                    value={period}
                    onChange={(event) => setPeriod(event.target.value as StatPeriod)}
                    className={fieldClass}
                  >
                    {PERIODS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1.5 text-sm font-semibold text-(--text)">
                  Cadence
                  <select
                    value={cadence}
                    onChange={(event) => setCadence(event.target.value as ScheduleCadence)}
                    className={fieldClass}
                  >
                    {CADENCES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {formError ? (
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm font-medium text-red-600 dark:text-red-400">
                  {formError}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={creating || !canSubmit}
                className="btn-gradient inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold"
              >
                {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                {creating ? "Creating..." : "Create schedule"}
              </button>
            </form>
          ) : (
            <p className="mt-5 rounded-lg border border-(--border) bg-(--surface-soft) px-3.5 py-2.5 text-sm font-medium text-(--muted)">
              You have read-only access. Ask an owner or manager to add schedules.
            </p>
          )}
        </section>

        <section className="animate-rise [animation-delay:80ms]">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-(--text)">
              {schedules.length} schedule{schedules.length === 1 ? "" : "s"}
            </h2>
          </div>

          {rowError ? (
            <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm font-medium text-red-600 dark:text-red-400">
              {rowError}
            </p>
          ) : null}
          {rowNotice ? (
            <p className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
              {rowNotice}
            </p>
          ) : null}

          {loading ? (
            <div className="glass grid place-items-center rounded-xl p-10 text-(--muted)">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : loadError ? (
            <div className="glass rounded-xl p-6 text-sm font-medium text-red-600 dark:text-red-400">
              {loadError}
            </div>
          ) : schedules.length === 0 ? (
            <div className="glass rounded-xl p-8 text-center text-sm font-medium text-(--muted)">
              No schedules yet. Create one to automate reports.
            </div>
          ) : (
            <div className="glass overflow-hidden rounded-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-(--border) text-left text-[11px] uppercase tracking-wide text-(--muted)">
                      <th className="px-4 py-2.5 font-semibold">Schedule</th>
                      <th className="px-4 py-2.5 font-semibold">Cadence</th>
                      <th className="px-4 py-2.5 font-semibold">Next run</th>
                      <th className="px-4 py-2.5 font-semibold">Last run</th>
                      {manageable ? (
                        <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {schedules.map((schedule) => {
                      const busy = busyId === schedule.id;
                      return (
                        <tr
                          key={schedule.id}
                          className="border-b border-(--border) transition last:border-0 hover:bg-(--surface-soft)"
                        >
                          <td className="px-4 py-3">
                            <p className="font-semibold text-(--text)">{schedule.name}</p>
                            <p className="text-xs text-(--muted)">
                              {schedule.reportType} · {targetLabel(schedule)} · {schedule.period}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                                schedule.enabled
                                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                  : "bg-(--surface-soft) text-(--muted)"
                              }`}
                            >
                              {schedule.enabled ? schedule.cadence : "PAUSED"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-(--muted)">
                            {schedule.enabled ? formatWhen(schedule.nextRunAt) : "—"}
                          </td>
                          <td className="px-4 py-3">
                            {schedule.lastRunAt ? (
                              <div className="flex items-center gap-2">
                                <span className="text-(--muted)">{formatWhen(schedule.lastRunAt)}</span>
                                {schedule.lastStatus === "error" ? (
                                  <span
                                    className="text-xs font-semibold text-red-600 dark:text-red-400"
                                    title={schedule.lastError ?? "error"}
                                  >
                                    failed
                                  </span>
                                ) : schedule.lastReportId ? (
                                  <Link
                                    href="/dashboard/reports"
                                    className="text-xs font-semibold text-(--accent) hover:underline"
                                  >
                                    view
                                  </Link>
                                ) : null}
                              </div>
                            ) : (
                              <span className="text-(--muted)">never</span>
                            )}
                          </td>
                          {manageable ? (
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleRun(schedule)}
                                  disabled={busy}
                                  className="inline-flex items-center gap-1.5 rounded-md border border-(--border) px-3 py-1.5 text-xs font-semibold text-(--text) transition hover:bg-(--surface)"
                                >
                                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                                  Run now
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleToggle(schedule)}
                                  disabled={busy}
                                  aria-label={schedule.enabled ? "Pause" : "Resume"}
                                  className="grid h-8 w-8 place-items-center rounded-md border border-(--border) text-(--text) transition hover:bg-(--surface)"
                                >
                                  {schedule.enabled ? <Pause size={14} /> : <Play size={14} />}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(schedule)}
                                  disabled={busy}
                                  aria-label="Delete"
                                  className="grid h-8 w-8 place-items-center rounded-md text-(--muted) transition hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>
    </DashboardChrome>
  );
}
