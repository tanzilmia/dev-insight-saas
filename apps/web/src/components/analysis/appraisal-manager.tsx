"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Award,
  CalendarDays,
  ExternalLink,
  FileDiff,
  Info,
  Loader2,
  Printer,
  ShieldAlert,
  Users
} from "lucide-react";

import {
  type Employee,
  type EmployeeAppraisal,
  type Project,
  getApiErrorMessage,
  getEmployeeAppraisal,
  listEmployees,
  listProjects
} from "@/lib/api";
import { canManage, useSession } from "@/lib/use-session";
import {
  DashboardChrome,
  DashboardLoading
} from "@/components/dashboard/dashboard-chrome";
import { BarList, StatTile } from "@/components/statistics/charts";

const WINDOWS: { value: number; label: string }[] = [
  { value: 3, label: "Last 3 months" },
  { value: 6, label: "Last 6 months" },
  { value: 12, label: "Last 12 months" },
  { value: 24, label: "Last 24 months" }
];

function categoryPill(category: string) {
  if (category === "Feature") return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
  if (category === "Fix") return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  if (category === "Refactor") return "bg-sky-500/15 text-sky-600 dark:text-sky-400";
  return "bg-(--surface-soft) text-(--muted)";
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  if (!year || !month) return key;
  return new Date(year, month - 1, 1).toLocaleString(undefined, { month: "short" });
}

function formatDay(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

export function AppraisalManager() {
  const { session, status, activeOrganization, logout } = useSession();
  const organizationId = activeOrganization?.id;
  const manageable = canManage(activeOrganization?.role);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [userId, setUserId] = useState("");
  const [months, setMonths] = useState(6);
  const [scope, setScope] = useState(""); // "" = whole org, else projectId

  const [appraisal, setAppraisal] = useState<EmployeeAppraisal | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load selectable employees + projects.
  useEffect(() => {
    if (!organizationId || !manageable) {
      return;
    }
    listEmployees(organizationId)
      .then((rows) => setEmployees(rows.filter((employee) => employee.status === "ACTIVE")))
      .catch(() => setEmployees([]));
    listProjects(organizationId)
      .then((rows) => setProjects(rows))
      .catch(() => setProjects([]));
  }, [organizationId, manageable]);

  // State is set only inside .then/.catch/.finally (deferred), so this is safe
  // to call from an effect (react-hooks/set-state-in-effect).
  const load = useCallback(() => {
    if (!organizationId || !manageable || !userId) {
      return Promise.resolve();
    }
    return getEmployeeAppraisal(organizationId, userId, {
      months,
      projectId: scope || undefined
    })
      .then((data) => {
        setAppraisal(data);
        setError(null);
      })
      .catch((caught) => {
        setError(getApiErrorMessage(caught));
        setAppraisal(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [organizationId, manageable, userId, months, scope]);

  // The effect only calls load(); loading is toggled in the event handlers below
  // so no setState runs synchronously inside an effect (react-hooks rule).
  useEffect(() => {
    void load();
  }, [load]);

  function selectEmployee(value: string) {
    setUserId(value);
    setError(null);
    if (value) {
      setLoading(true);
    } else {
      setAppraisal(null);
    }
  }

  function reloadFor(change: () => void) {
    change();
    if (userId) {
      setLoading(true);
    }
  }

  if (status === "loading") {
    return <DashboardLoading />;
  }
  if (!session) {
    return null;
  }

  const withChrome = (node: React.ReactNode) => (
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

  const maxMonthly = appraisal
    ? Math.max(1, ...appraisal.consistency.monthly.map((month) => month.commits))
    : 1;

  return withChrome(
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="mb-1 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-(--accent)">
            <Award size={14} />
            Appraisal
          </p>
          <h1 className="text-xl font-black text-(--text) md:text-2xl">Increment review</h1>
          <p className="mt-1 max-w-2xl text-sm text-(--muted)">
            An evidence-backed look at one person&apos;s real contribution — built to help you
            judge fairly on the work, not on who&apos;s closest to the lead.
          </p>
        </div>
        {appraisal ? (
          <button
            type="button"
            onClick={() => window.print()}
            className="glass-soft glass-hover inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-(--text)"
          >
            <Printer size={14} />
            Print / PDF
          </button>
        ) : null}
      </div>

      {/* Selectors */}
      <div className="glass grid gap-3 rounded-xl p-4 sm:grid-cols-3">
        <label className="grid gap-1 text-xs font-bold text-(--muted)">
          Employee
          <select
            value={userId}
            onChange={(event) => selectEmployee(event.target.value)}
            className="field"
          >
            <option value="">Select an employee…</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-bold text-(--muted)">
          Time window
          <select
            value={months}
            onChange={(event) => reloadFor(() => setMonths(Number(event.target.value)))}
            className="field"
          >
            {WINDOWS.map((window) => (
              <option key={window.value} value={window.value}>
                {window.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-bold text-(--muted)">
          Scope
          <select
            value={scope}
            onChange={(event) => reloadFor(() => setScope(event.target.value))}
            className="field"
          >
            <option value="">All work (whole org)</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Fairness framing — always visible, the heart of the feature. */}
      <div className="flex items-start gap-2 rounded-xl border border-(--accent)/30 bg-(--accent-soft) px-4 py-3 text-sm text-(--text)">
        <Info size={16} className="mt-0.5 shrink-0 text-(--accent)" />
        <p>
          This is <strong>objective evidence to inform a fair decision</strong> — not a score or a
          verdict. Read it together with what the data can&apos;t see (below), and let the numbers
          support your judgement, not replace it.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-600 dark:text-red-400">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="glass flex items-center justify-center gap-2 rounded-xl p-10 text-sm font-bold text-(--muted)">
          <Loader2 size={16} className="animate-spin" />
          Building appraisal…
        </div>
      ) : !appraisal ? (
        !userId ? (
          <div className="glass rounded-xl p-10 text-center text-sm font-bold text-(--muted)">
            Pick an employee to see their evidence-backed contribution.
          </div>
        ) : null
      ) : (
        <div className="grid gap-4">
          {/* Person header */}
          <div className="glass rounded-xl p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-black text-(--text)">{appraisal.employee.name}</h2>
              <p className="text-xs font-medium text-(--muted)">
                {formatDay(appraisal.period.from)} – {formatDay(appraisal.period.to)} ·{" "}
                {appraisal.scope.type === "project" ? appraisal.scope.name : "All work"}
              </p>
            </div>
            {appraisal.employee.usernames.length ? (
              <p className="mt-1 text-xs text-(--muted)">
                {appraisal.employee.usernames.map((name) => `@${name}`).join(", ")}
              </p>
            ) : null}
          </div>

          {!appraisal.hasGitIdentity ? (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-700 dark:text-amber-400">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <p>{appraisal.dataBlindSpots[0]}</p>
            </div>
          ) : (
            <>
              {/* Headline signals */}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile
                  label="Real work (lines)"
                  value={appraisal.headline!.effectiveLines}
                  icon={FileDiff}
                />
                <StatTile label="Updates" value={appraisal.headline!.commits} icon={Activity} />
                <StatTile
                  label="Active days"
                  value={appraisal.headline!.activeDays}
                  icon={CalendarDays}
                />
                <StatTile
                  label="Consistency"
                  value={`${appraisal.consistency.activeWeekPct}%`}
                  icon={CalendarDays}
                />
              </div>

              {/* Consistency + focus */}
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="glass rounded-xl p-5">
                  <p className="mb-1 text-sm font-black text-(--text)">Consistency</p>
                  <p className="mb-3 text-xs text-(--muted)">
                    Active in {appraisal.consistency.activeWeeks} of{" "}
                    {appraisal.consistency.totalWeeks} weeks — steady work over time, not just a
                    burst before review.
                  </p>
                  <div className="flex items-end gap-1.5" style={{ height: 72 }}>
                    {appraisal.consistency.monthly.map((month) => (
                      <div key={month.month} className="flex flex-1 flex-col items-center gap-1">
                        <div
                          className="w-full rounded-t bg-(--accent)"
                          style={{
                            height: `${Math.round((month.commits / maxMonthly) * 56)}px`,
                            minHeight: month.commits > 0 ? 3 : 1,
                            opacity: month.commits > 0 ? 1 : 0.25
                          }}
                          title={`${month.month}: ${month.commits} updates`}
                        />
                        <span className="text-[9px] font-medium text-(--muted)">
                          {monthLabel(month.month)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="glass rounded-xl p-5">
                  <p className="mb-1 text-sm font-black text-(--text)">What they focused on</p>
                  <p className="mb-3 text-xs text-(--muted)">
                    {appraisal.workMix.text || "No classified work in this window."}
                  </p>
                  {appraisal.workMix.top.length ? (
                    <BarList
                      items={appraisal.workMix.top.map((item) => ({
                        label: item.label,
                        value: item.pct
                      }))}
                    />
                  ) : null}
                  {appraisal.areas.length ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {appraisal.areas.map((area) => (
                        <span
                          key={area}
                          className="rounded-full bg-(--surface-soft) px-2 py-0.5 text-[11px] font-medium text-(--muted)"
                        >
                          {area}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Ownership + quality + team standing */}
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="glass rounded-xl p-5">
                  <p className="mb-2 inline-flex items-center gap-1.5 text-sm font-black text-(--text)">
                    <ShieldAlert size={14} className="text-(--accent)" />
                    Ownership
                  </p>
                  <ul className="grid gap-1.5 text-sm text-(--text)">
                    <li>
                      <strong>{appraisal.ownership.moduleBreadth}</strong> area
                      {appraisal.ownership.moduleBreadth === 1 ? "" : "s"} of the codebase touched
                    </li>
                    <li>
                      <strong>{appraisal.ownership.sensitiveAreaCommits}</strong> update
                      {appraisal.ownership.sensitiveAreaCommits === 1 ? "" : "s"} in
                      security-critical code
                    </li>
                  </ul>
                  {appraisal.ownership.criticalAreas.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {appraisal.ownership.criticalAreas.map((area) => (
                        <span
                          key={area}
                          className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400"
                        >
                          {area}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="glass rounded-xl p-5">
                  <p className="mb-2 text-sm font-black text-(--text)">Kind of work</p>
                  <ul className="grid gap-1.5 text-sm text-(--text)">
                    <li>
                      <strong>{appraisal.quality.features}</strong> new features
                    </li>
                    <li>
                      <strong>{appraisal.quality.bugFixes}</strong> bug fixes
                    </li>
                    <li>
                      <strong>{appraisal.quality.refactors}</strong> clean-ups / refactors
                    </li>
                    <li>
                      <strong>{appraisal.quality.largeCommits}</strong> large updates
                    </li>
                  </ul>
                </div>

                <div className="glass rounded-xl p-5">
                  <p className="mb-2 inline-flex items-center gap-1.5 text-sm font-black text-(--text)">
                    <Users size={14} className="text-(--accent)" />
                    Team standing
                  </p>
                  {appraisal.teamComparison ? (
                    <ul className="grid gap-1.5 text-sm text-(--text)">
                      <li>
                        <strong>
                          #{appraisal.teamComparison.byRealWork.rank} of{" "}
                          {appraisal.teamComparison.byRealWork.of}
                        </strong>{" "}
                        by real work
                      </li>
                      <li>
                        <strong>
                          #{appraisal.teamComparison.byCommits.rank} of{" "}
                          {appraisal.teamComparison.byCommits.of}
                        </strong>{" "}
                        by number of updates
                      </li>
                      <li className="text-xs text-(--muted)">Same team, same window.</li>
                    </ul>
                  ) : (
                    <p className="text-xs text-(--muted)">
                      No comparable teammates with activity in this window.
                    </p>
                  )}
                </div>
              </div>

              {/* Evidence — the proof */}
              <div className="glass rounded-xl p-5">
                <p className="mb-1 text-sm font-black text-(--text)">Evidence — actual work</p>
                <p className="mb-3 text-xs text-(--muted)">
                  The most substantial updates, each linking to the real commit. Undeniable proof,
                  even if the numbers were questioned.
                </p>
                {appraisal.evidence.length ? (
                  <ul className="grid gap-1.5">
                    {appraisal.evidence.map((item) => (
                      <li
                        key={item.sha}
                        className="flex items-start gap-2 rounded-lg bg-(--surface-soft) px-3 py-2"
                      >
                        <span
                          className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${categoryPill(item.category)}`}
                        >
                          {item.category}
                        </span>
                        <div className="min-w-0 flex-1">
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-baseline gap-1 text-sm font-medium text-(--text) hover:text-(--accent) hover:underline"
                          >
                            <span className="truncate">{item.message}</span>
                            <ExternalLink size={11} className="shrink-0 text-(--muted)" />
                          </a>
                          <p className="text-[11px] text-(--muted)">
                            {formatDay(item.committedAt)} · {item.lines.toLocaleString()} lines
                            {item.sensitive ? " · security-critical" : ""}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-(--muted)">No recorded work in this window.</p>
                )}
              </div>
            </>
          )}

          {/* What the data can't see — honest guardrail */}
          <div className="rounded-xl border border-(--border) bg-(--surface-soft) p-4">
            <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-(--muted)">
              <Info size={13} />
              What this data can&apos;t see
            </p>
            <ul className="grid gap-1.5 text-sm text-(--muted)">
              {appraisal.dataBlindSpots.map((note, index) => (
                <li key={index}>• {note}</li>
              ))}
            </ul>
            {appraisal.truncated ? (
              <p className="mt-2 text-xs font-medium text-amber-600 dark:text-amber-400">
                Some data was truncated for this long window — see the note above.
              </p>
            ) : null}
          </div>

          <p className="text-center text-xs text-(--muted)">
            Missing someone&apos;s work?{" "}
            <Link href="/dashboard/contributors" className="font-bold text-(--accent) hover:underline">
              Link their Git identity
            </Link>{" "}
            so nobody&apos;s contribution is invisible.
          </p>
        </div>
      )}
    </div>
  );
}
