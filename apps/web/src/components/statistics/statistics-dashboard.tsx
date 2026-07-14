"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Activity,
  AlertTriangle,
  FileDiff,
  FileText,
  FolderGit2,
  Loader2,
  Minus,
  Plus,
  Users,
  X
} from "lucide-react";

import {
  type GeneratedReport,
  type StatPeriod,
  type StatisticsOverview,
  generateReport,
  getApiErrorMessage,
  getStatisticsOverview
} from "@/lib/api";
import { canManage, useSession } from "@/lib/use-session";
import {
  DashboardChrome,
  DashboardLoading
} from "@/components/dashboard/dashboard-chrome";
import { AwardsPanel } from "@/components/analysis/awards-panel";
import { AreaChart, BarList, StatTile } from "./charts";
import { DailyDigestCard } from "./daily-digest-card";
import { LeaderboardHistoryPanel } from "./leaderboard-history-panel";
import { UnmappedNudge } from "./unmapped-nudge";

const PERIODS: { value: StatPeriod; label: string }[] = [
  { value: "yesterday", label: "Yesterday" },
  { value: "last_7_days", label: "Last 7 days" },
  { value: "last_30_days", label: "Last 30 days" },
  { value: "last_90_days", label: "Last 90 days" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" }
];

const markdownPlugins = [remarkGfm];

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-xl p-5">
      <h2 className="mb-3 text-sm font-bold text-(--text)">{title}</h2>
      {children}
    </div>
  );
}

export function StatisticsDashboard() {
  const { session, status, activeOrganization, logout } = useSession();
  const organizationId = activeOrganization?.id;
  const manageable = canManage(activeOrganization?.role);

  const [period, setPeriod] = useState<StatPeriod>("last_30_days");
  const [overview, setOverview] = useState<StatisticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // One-click "Today's report" — an org-wide team report for the current day.
  const [todayReport, setTodayReport] = useState<GeneratedReport | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  async function handleTodayReport() {
    if (!organizationId || reportBusy) {
      return;
    }
    setReportBusy(true);
    setReportError(null);
    try {
      const report = await generateReport({
        organizationId,
        reportType: "team",
        period: "today"
      });
      setTodayReport(report);
    } catch (caught) {
      setReportError(getApiErrorMessage(caught));
    } finally {
      setReportBusy(false);
    }
  }

  // State is set only inside .then/.catch/.finally callbacks (deferred), so this
  // is safe to call directly from an effect (react-hooks/set-state-in-effect).
  const load = useCallback(() => {
    if (!organizationId) {
      return Promise.resolve();
    }
    return getStatisticsOverview(organizationId, period)
      .then((data) => {
        setOverview(data);
        setError(null);
      })
      .catch((caught) => {
        setError(getApiErrorMessage(caught));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [organizationId, period]);

  useEffect(() => {
    void load();
  }, [load]);

  if (status === "loading") {
    return <DashboardLoading />;
  }

  if (!session) {
    return null;
  }

  const hasActivity =
    overview !== null &&
    (overview.totals.commits > 0 || overview.byRepository.length > 0);

  return (
    <DashboardChrome email={session.user.email} onLogout={logout}>
      <div className="grid gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold tracking-tight text-(--text)">
              Welcome back, {session.user.name}
            </h1>
            <p className="text-sm text-(--muted)">
              Activity across {activeOrganization?.name ?? "your organization"}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {loading && overview ? (
              <Loader2 size={16} className="animate-spin text-(--muted)" aria-label="Loading" />
            ) : null}
            <button
              type="button"
              onClick={handleTodayReport}
              disabled={reportBusy || !organizationId}
              className="btn-gradient inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-60"
            >
              {reportBusy ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <FileText size={15} />
              )}
              {reportBusy ? "Generating…" : "Today's report"}
            </button>
            <select
              value={period}
              onChange={(event) => {
                setPeriod(event.target.value as StatPeriod);
                setLoading(true);
              }}
              aria-label="Statistics period"
              className="field rounded-lg px-3 py-2 text-sm font-medium text-(--text)"
            >
              {PERIODS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {reportError ? (
          <div className="glass rounded-xl p-5 text-sm font-medium text-red-600 dark:text-red-400">
            {reportError}
          </div>
        ) : null}

        {todayReport ? (
          <div className="glass rounded-xl p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-bold text-(--text)">{todayReport.title}</h2>
                {todayReport.cached ? (
                  <span className="rounded-full bg-(--surface-soft) px-2.5 py-0.5 text-[11px] font-bold text-(--muted)">
                    Cached
                  </span>
                ) : null}
                {todayReport.status === "PARTIAL" ? (
                  <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-bold text-amber-600 dark:text-amber-400">
                    Template (no AI configured)
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/dashboard/reports?report=${todayReport.reportId}`}
                  className="text-xs font-bold text-(--accent) hover:underline"
                >
                  View in Reports →
                </Link>
                <button
                  type="button"
                  onClick={() => setTodayReport(null)}
                  aria-label="Dismiss report"
                  className="grid h-6 w-6 place-items-center rounded-full text-(--muted) transition hover:bg-(--surface-soft) hover:text-(--text)"
                >
                  <X size={13} />
                </button>
              </div>
            </div>
            {todayReport.warnings?.length ? (
              <div className="mb-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-400">
                {todayReport.warnings.map((warning, index) => (
                  <p key={index}>Heads up: {warning}</p>
                ))}
              </div>
            ) : null}
            <div className="report-md glass-soft max-h-128 overflow-y-auto rounded-lg px-4 py-3 text-sm">
              <ReactMarkdown remarkPlugins={markdownPlugins}>{todayReport.markdown}</ReactMarkdown>
            </div>
          </div>
        ) : null}

        <UnmappedNudge organizationId={organizationId} />

        <DailyDigestCard organizationId={organizationId} />

        <LeaderboardHistoryPanel organizationId={organizationId} scope="org" />

        {organizationId ? (
          <AwardsPanel
            organizationId={organizationId}
            scope="org"
            projectName={null}
            canManage={manageable}
          />
        ) : null}

        {error ? (
          <div className="glass rounded-xl p-5 text-sm font-medium text-red-600 dark:text-red-400">
            {error}
          </div>
        ) : null}

        {loading && !overview ? (
          <div className="glass grid place-items-center rounded-xl p-16 text-(--muted)">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : overview && hasActivity ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <StatTile label="Commits" value={overview.totals.commits} icon={Activity} />
              <StatTile label="Lines added" value={overview.totals.additions} icon={Plus} />
              <StatTile label="Lines removed" value={overview.totals.deletions} icon={Minus} />
              <StatTile label="Files changed" value={overview.totals.filesChanged} icon={FileDiff} />
              <StatTile label="Active repos" value={overview.totals.repositories} icon={FolderGit2} />
              <StatTile label="Contributors" value={overview.totals.contributors} icon={Users} />
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
              <Panel title="Commits over time">
                {overview.commitsOverTime.some((day) => day.commits > 0) ? (
                  <AreaChart
                    data={overview.commitsOverTime.map((day) => ({
                      date: day.date,
                      value: day.commits
                    }))}
                    unit=" commits"
                  />
                ) : (
                  <p className="py-6 text-center text-sm text-(--muted)">
                    No commits in this period.
                  </p>
                )}
              </Panel>

              <Panel title="Top contributors">
                <BarList
                  items={overview.topContributors.map((contributor) => ({
                    label: contributor.name,
                    value: contributor.lines,
                    sub: `${contributor.commits} commit${contributor.commits === 1 ? "" : "s"}`
                  }))}
                  unit=" lines"
                />
              </Panel>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel title="By project">
                <BarList
                  items={overview.byProject.map((project) => ({
                    label: project.name,
                    value: project.commits
                  }))}
                  unit=" commits"
                />
              </Panel>

              <Panel title="Work breakdown">
                <BarList
                  items={Object.entries(overview.categories)
                    .sort((a, b) => b[1] - a[1])
                    .map(([category, count]) => ({ label: category, value: count }))}
                />
              </Panel>

              <Panel title="Most changed areas">
                <BarList
                  items={overview.topModules.map((module) => ({
                    label: module.module,
                    value: module.changes
                  }))}
                  unit=" changes"
                />
              </Panel>
            </div>

            <Panel title="Risk signals">
              {overview.risks.length ? (
                <ul className="grid gap-2.5 sm:grid-cols-2">
                  {overview.risks.map((risk, index) => (
                    <li key={index} className="flex gap-2 text-sm text-(--text)">
                      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" />
                      {risk}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-2 text-sm text-(--muted)">
                  No risk signals in this period.
                </p>
              )}
            </Panel>
          </>
        ) : (
          <div className="glass rounded-xl p-10 text-center">
            <p className="text-sm font-semibold text-(--text)">No activity collected yet.</p>
            <p className="mt-1 text-sm text-(--muted)">
              Go to Repositories and “Collect” a repo, then reports and stats will fill in.
            </p>
          </div>
        )}
      </div>
    </DashboardChrome>
  );
}
