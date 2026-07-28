"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ClipboardList,
  FolderGit2,
  GitPullRequest,
  Globe,
  HardDriveDownload,
  History,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
  Zap
} from "lucide-react";

import {
  type CollectionJob,
  type Project,
  type SonarProjectSummary,
  type TrackedRepository,
  assignRepositoryProject,
  cancelDeepCollection,
  collectActivity,
  collectIssues,
  collectPullRequests,
  deprovisionRepositoryCodeQuality,
  getApiErrorMessage,
  listCollectionJobs,
  listProjects,
  listRepositories,
  listSonarProjects,
  provisionRepositoryCodeQuality,
  resyncRepository,
  setRepositorySonarProjectKey,
  startDeepCollection
} from "@/lib/api";
import { canManage, useSession } from "@/lib/use-session";
import {
  DashboardChrome,
  DashboardLoading
} from "@/components/dashboard/dashboard-chrome";

const DEEP_LOOKBACKS = [
  { days: 180, label: "6 months" },
  { days: 365, label: "1 year" },
  { days: 730, label: "2 years" },
  { days: 3650, label: "Full history" }
] as const;

const FINISHED_BADGE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function isActiveJob(job: CollectionJob | undefined): boolean {
  return Boolean(job && (job.status === "QUEUED" || job.status === "RUNNING"));
}

/**
 * Latest job per repository, dropping stale completed/cancelled ones so old
 * badges don't clutter the table (failures stay until dismissed). Runs in data
 * callbacks, not render, so Date.now() is fine here.
 */
function toJobMap(rows: CollectionJob[]): Record<string, CollectionJob> {
  const now = Date.now();
  return Object.fromEntries(
    rows
      .filter(
        (job) =>
          isActiveJob(job) ||
          job.status === "FAILED" ||
          (job.finishedAt &&
            now - new Date(job.finishedAt).getTime() < FINISHED_BADGE_MAX_AGE_MS)
      )
      .map((job) => [job.repositoryId, job])
  );
}

function LiveSyncBadge({ liveSync }: { liveSync: TrackedRepository["liveSync"] }) {
  if (!liveSync.status) {
    return null;
  }
  if (liveSync.status === "ERROR") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-black text-red-600 dark:text-red-400">
        <Zap size={11} />
        Sync error
      </span>
    );
  }
  return (
    <span
      title={
        liveSync.lastWebhookAt
          ? `Last push received ${new Date(liveSync.lastWebhookAt).toLocaleString()}`
          : "Waiting for the first push"
      }
      className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-black text-emerald-600 dark:text-emerald-400"
    >
      <span className="pulse-dot" />
      Live
    </span>
  );
}

function PrivacyBadge({ isPrivate }: { isPrivate: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-black ${
        isPrivate
          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
          : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      }`}
    >
      {isPrivate ? <Lock size={12} /> : <Globe size={12} />}
      {isPrivate ? "Private" : "Public"}
    </span>
  );
}

export function RepositoriesManager() {
  const { session, status, activeOrganization, logout } = useSession();
  const organizationId = activeOrganization?.id;
  const manageable = canManage(activeOrganization?.role);

  const [tracked, setTracked] = useState<TrackedRepository[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sonarProjects, setSonarProjects] = useState<SonarProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [rowNotice, setRowNotice] = useState<{
    text: string;
    tone: "success" | "warning";
  } | null>(null);

  const [trackedQuery, setTrackedQuery] = useState("");

  // Deep-history collection jobs, keyed by repository id (latest per repo).
  const [jobs, setJobs] = useState<Record<string, CollectionJob>>({});
  const [dismissedJobs, setDismissedJobs] = useState<Set<string>>(new Set());
  const [deepFormId, setDeepFormId] = useState<string | null>(null);
  const [deepLookback, setDeepLookback] = useState<number>(365);
  const [deepVerify, setDeepVerify] = useState(false);
  const prevActiveJobsRef = useRef<Set<string>>(new Set());

  const activeJobCount = useMemo(
    () => Object.values(jobs).filter((job) => isActiveJob(job)).length,
    [jobs]
  );

  const refresh = useCallback(() => {
    if (!organizationId) {
      return Promise.resolve();
    }

    return listRepositories(organizationId)
      .then((repos) => {
        setTracked(repos);
        setLoadError(null);
      })
      .catch((error) => {
        setLoadError(getApiErrorMessage(error));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [organizationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!organizationId) {
      return;
    }

    listProjects(organizationId)
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [organizationId]);

  // SonarQube projects for the code-quality mapping dropdown (empty when no
  // SonarQube is connected — the row then falls back to a manual key prompt).
  useEffect(() => {
    if (!organizationId) {
      return;
    }

    listSonarProjects(organizationId)
      .then((result) => setSonarProjects(result.projects))
      .catch(() => setSonarProjects([]));
  }, [organizationId]);

  // Load the latest job per repository once, so an in-flight deep collection
  // resumes showing progress after a page reload.
  useEffect(() => {
    if (!organizationId) {
      return;
    }

    listCollectionJobs(organizationId)
      .then((rows) => setJobs(toJobMap(rows)))
      .catch(() => {});
  }, [organizationId]);

  // Poll while any job is queued/running (first polling in the app: cheap
  // indexed read, cleared as soon as the last job settles or on unmount).
  useEffect(() => {
    if (!organizationId || activeJobCount === 0) {
      return;
    }

    const timer = setInterval(() => {
      listCollectionJobs(organizationId)
        .then((rows) => setJobs(toJobMap(rows)))
        .catch(() => {});
    }, 2500);

    return () => clearInterval(timer);
  }, [organizationId, activeJobCount]);

  // When a job finishes, refresh the repository list once (commit counts).
  useEffect(() => {
    const nowActive = new Set(
      Object.values(jobs)
        .filter((job) => isActiveJob(job))
        .map((job) => job.id)
    );
    const finished = [...prevActiveJobsRef.current].some((id) => !nowActive.has(id));
    prevActiveJobsRef.current = nowActive;
    if (finished) {
      void refresh();
    }
  }, [jobs, refresh]);

  const filteredTracked = useMemo(() => {
    const query = trackedQuery.trim().toLowerCase();
    if (!query) {
      return tracked;
    }
    return tracked.filter((repo) => repo.fullName.toLowerCase().includes(query));
  }, [tracked, trackedQuery]);

  async function handleAssignProject(repo: TrackedRepository, projectId: string) {
    setBusyId(repo.id);
    setRowError(null);

    try {
      await assignRepositoryProject(repo.id, projectId ? projectId : null);
      await refresh();
    } catch (error) {
      setRowError(getApiErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  async function handleResync(repo: TrackedRepository) {
    setBusyId(repo.id);
    setRowError(null);

    try {
      await resyncRepository(repo.id);
      await refresh();
    } catch (error) {
      setRowError(getApiErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  async function setSonarKey(repo: TrackedRepository, key: string | null) {
    setBusyId(repo.id);
    setRowError(null);
    try {
      await setRepositorySonarProjectKey(repo.id, key);
      await refresh();
    } catch (error) {
      setRowError(getApiErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  // Enable automated SonarQube scanning: provisions the project + token, injects
  // the repo secrets, and opens the workflow-update PR (merge lands the scan job).
  async function handleEnableScan(repo: TrackedRepository) {
    setBusyId(repo.id);
    setRowError(null);
    try {
      const result = await provisionRepositoryCodeQuality(repo.id);
      await refresh();
      setRowNotice({
        text:
          result.ci.pullRequest && result.ci.pullRequest.state !== "merged"
            ? `Scanning enabled for ${repo.fullName}. Merge the "Enable CI with DevInside" PR to start scanning.`
            : `Scanning enabled for ${repo.fullName} (project ${result.projectKey}).`,
        tone: "success"
      });
    } catch (error) {
      setRowError(getApiErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDisableScan(repo: TrackedRepository) {
    if (
      !window.confirm(
        `Turn off automated code-quality scanning for ${repo.fullName}? The SonarQube project and its results are kept.`
      )
    ) {
      return;
    }
    setBusyId(repo.id);
    setRowError(null);
    try {
      await deprovisionRepositoryCodeQuality(repo.id);
      await refresh();
      setRowNotice({ text: `Scanning turned off for ${repo.fullName}.`, tone: "success" });
    } catch (error) {
      setRowError(getApiErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  // Manual entry when no SonarQube projects are listed (not connected).
  async function handleSetSonarKeyManual(repo: TrackedRepository) {
    const input = window.prompt(
      `SonarQube project key for ${repo.fullName} (blank to clear):`,
      repo.sonarProjectKey ?? ""
    );
    if (input === null) return;
    await setSonarKey(repo, input.trim() ? input.trim() : null);
  }

  // Best-effort bulk mapping: match each unmapped repo to a SonarQube project
  // whose key or name looks like the repo (case-insensitive substring).
  async function handleAutoMapSonar() {
    const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
    const candidates = tracked.filter((repo) => !repo.sonarProjectKey);
    let mapped = 0;
    setRowError(null);
    for (const repo of candidates) {
      const repoTokens = [norm(repo.name), norm(repo.fullName.replace("/", ""))];
      const match = sonarProjects.find((project) => {
        const pk = norm(project.key);
        const pn = norm(project.name);
        return repoTokens.some((t) => t && (pk.includes(t) || t.includes(pk) || pn.includes(t)));
      });
      if (match) {
        try {
          await setRepositorySonarProjectKey(repo.id, match.key);
          mapped += 1;
        } catch {
          /* keep going */
        }
      }
    }
    await refresh();
    setRowNotice({
      text: `Auto-mapped ${mapped} repositor${mapped === 1 ? "y" : "ies"} to SonarQube.`,
      tone: mapped > 0 ? "success" : "warning"
    });
  }

  async function handleCollect(repo: TrackedRepository) {
    setBusyId(repo.id);
    setRowError(null);
    setRowNotice(null);

    try {
      const result = await collectActivity(repo.id);
      if (result.capped) {
        setRowNotice({
          tone: "warning",
          text: `Collected ${result.newCollected} new commit(s) from ${repo.fullName}, but hit the per-run cap — click Collect again to continue, or use Deep collect for full history.`
        });
      } else {
        setRowNotice({
          tone: "success",
          text: `Collected ${result.newCollected} new commit(s) across ${result.branchesChecked} branch(es) from ${repo.fullName} (last 90 days).`
        });
      }
      await refresh();
    } catch (error) {
      setRowError(getApiErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  async function handleCollectPrs(repo: TrackedRepository) {
    setBusyId(repo.id);
    setRowError(null);
    setRowNotice(null);

    try {
      const result = await collectPullRequests(repo.id);
      setRowNotice({
        tone: "success",
        text: `Collected ${result.prCount} pull request(s) and ${result.reviewCount} review(s) from ${repo.fullName}.`
      });
    } catch (error) {
      setRowError(getApiErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  async function handleCollectIssues(repo: TrackedRepository) {
    setBusyId(repo.id);
    setRowError(null);
    setRowNotice(null);

    try {
      const result = await collectIssues(repo.id);
      setRowNotice({
        tone: result.capped ? "warning" : "success",
        text: `${result.issueCount} GitHub issue(s) and ${result.eventCount} workflow event(s) synced from ${repo.fullName}${result.capped ? " (collection cap reached)" : ""}.`
      });
    } catch (error) {
      setRowError(getApiErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeepStart(repo: TrackedRepository) {
    setBusyId(repo.id);
    setRowError(null);
    setRowNotice(null);

    try {
      const job = await startDeepCollection(repo.id, deepLookback, deepVerify);
      setJobs((current) => ({ ...current, [repo.id]: job }));
      setDeepFormId(null);
    } catch (error) {
      setRowError(getApiErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeepCancel(repo: TrackedRepository) {
    setRowError(null);

    try {
      const job = await cancelDeepCollection(repo.id);
      setJobs((current) => ({ ...current, [repo.id]: job }));
    } catch (error) {
      setRowError(getApiErrorMessage(error));
    }
  }

  function dismissJob(jobId: string) {
    setDismissedJobs((current) => new Set(current).add(jobId));
  }

  // Stale completed/cancelled jobs are already filtered out by toJobMap.
  function shouldShowJob(job: CollectionJob | undefined): job is CollectionJob {
    return Boolean(job && (isActiveJob(job) || !dismissedJobs.has(job.id)));
  }

  if (status === "loading") {
    return <DashboardLoading />;
  }

  if (!session) {
    return null;
  }

  return (
    <DashboardChrome email={session.user.email} onLogout={logout}>
      <div className="grid gap-6">
        <section className="glass animate-rise flex flex-wrap items-center justify-between gap-4 rounded-xl p-5">
          <div>
            <p className="mb-1.5 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-(--accent)">
              <FolderGit2 size={14} />
              Repositories
            </p>
            <h1 className="text-xl font-bold tracking-tight text-(--text)">
              Tracked repositories
            </h1>
            <p className="mt-1.5 max-w-xl text-sm leading-6 text-(--muted)">
              Repositories selected for your GitHub App are tracked automatically.
              Signed push events keep commit activity current.
            </p>
          </div>
          {manageable ? (
            <div className="flex items-center gap-2">
              {sonarProjects.length ? (
                <button
                  type="button"
                  onClick={handleAutoMapSonar}
                  title="Match tracked repos to SonarQube projects by name"
                  className="inline-flex items-center gap-2 rounded-lg border border-(--border) px-3 py-2.5 text-sm font-semibold text-(--text) hover:bg-(--surface-soft)"
                >
                  <ShieldCheck size={16} />
                  Auto-map Sonar
                </button>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="animate-rise [animation-delay:60ms]">
          {rowError ? (
            <p className="mb-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-600 dark:text-red-400">
              {rowError}
            </p>
          ) : null}
          {rowNotice ? (
            <p
              className={`mb-4 rounded-2xl border px-4 py-3 text-sm font-bold ${
                rowNotice.tone === "warning"
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {rowNotice.text}
            </p>
          ) : null}

          {loading ? (
            <div className="glass grid place-items-center rounded-[1.75rem] p-10 text-(--muted)">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : loadError ? (
            <div className="glass rounded-[1.75rem] p-6 text-sm font-bold text-red-600 dark:text-red-400">
              {loadError}
            </div>
          ) : tracked.length === 0 ? (
            <div className="glass rounded-[1.75rem] p-8 text-center text-sm font-bold text-(--muted)">
              No repositories tracked yet.
              {manageable ? " Select repositories in the GitHub App settings, then run App Sync." : ""}
            </div>
          ) : (
            <>
              <div className="field mb-4 flex items-center gap-2 rounded-2xl px-3.5 py-2.5">
                <Search size={15} className="shrink-0 text-(--muted)" />
                <input
                  value={trackedQuery}
                  onChange={(event) => setTrackedQuery(event.target.value)}
                  placeholder="Search tracked repositories…"
                  className="w-full bg-transparent text-sm font-medium text-(--text) outline-none placeholder:font-normal"
                />
              </div>
              {filteredTracked.length === 0 ? (
                <p className="glass rounded-[1.5rem] p-6 text-center text-sm font-bold text-(--muted)">
                  No repositories match “{trackedQuery}”.
                </p>
              ) : (
                <div className="glass overflow-hidden rounded-xl">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-(--border) text-left text-[11px] uppercase tracking-wide text-(--muted)">
                          <th className="px-4 py-2.5 font-semibold">Repository</th>
                          <th className="px-4 py-2.5 font-semibold">Visibility</th>
                          <th className="px-4 py-2.5 font-semibold">Project</th>
                          {manageable ? (
                            <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredTracked.map((repo) => {
                          const busy = busyId === repo.id;
                          const job = jobs[repo.id];
                          const jobActive = isActiveJob(job);
                          const jobPct =
                            job && job.chunksTotal > 0
                              ? Math.min(
                                  100,
                                  Math.round((job.chunksDone / job.chunksTotal) * 100)
                                )
                              : 0;
                          const jobIndeterminate =
                            jobActive && (job?.status === "QUEUED" || job?.chunksTotal === 0);
                          return (
                            <tr
                              key={repo.id}
                              className="border-b border-(--border) transition last:border-0 hover:bg-(--surface-soft)"
                            >
                              <td className="px-4 py-3">
                                <a
                                  href={repo.remoteUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-semibold text-(--text) hover:text-(--accent)"
                                >
                                  {repo.fullName}
                                </a>
                                <p className="mt-0.5 text-xs text-(--muted)">
                                  {repo.commitCount} commit{repo.commitCount === 1 ? "" : "s"}
                                  {repo.defaultBranch ? ` · ${repo.defaultBranch}` : ""}
                                </p>
                                <Link
                                  href={`/dashboard/repositories/${repo.id}`}
                                  className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-(--accent) hover:underline"
                                >
                                  Manage CI →
                                </Link>
                                {shouldShowJob(job) ? (
                                  <div className="mt-2 max-w-sm">
                                    {jobActive ? (
                                      <>
                                        <div className="flex items-center gap-2">
                                          <span
                                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                                              job.status === "QUEUED"
                                                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                                                : "bg-(--accent-soft) text-(--accent)"
                                            }`}
                                          >
                                            {job.status === "QUEUED"
                                              ? "Queued"
                                              : job.cancelRequested
                                                ? "Cancelling…"
                                                : "Collecting"}
                                          </span>
                                          <span className="text-[11px] text-(--muted)">
                                            {job.commitsCollected} commits
                                            {job.branchesTotal > 0
                                              ? ` · branch ${Math.min(job.branchesDone + 1, job.branchesTotal)}/${job.branchesTotal}`
                                              : ""}
                                            {job.currentBranch ? ` (${job.currentBranch})` : ""}
                                          </span>
                                          {manageable && !job.cancelRequested ? (
                                            <button
                                              type="button"
                                              onClick={() => handleDeepCancel(repo)}
                                              className="text-[11px] font-bold text-(--muted) underline transition hover:text-red-600 dark:hover:text-red-400"
                                            >
                                              Cancel
                                            </button>
                                          ) : null}
                                        </div>
                                        <div
                                          role="progressbar"
                                          aria-label={`Deep collection of ${repo.fullName}`}
                                          aria-valuenow={jobIndeterminate ? undefined : jobPct}
                                          aria-valuemin={0}
                                          aria-valuemax={100}
                                          className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-(--surface-soft)"
                                        >
                                          <div
                                            className={`h-full rounded-full bg-(--accent) transition-[width] duration-500 ${
                                              jobIndeterminate ? "animate-pulse" : ""
                                            }`}
                                            style={{
                                              width: jobIndeterminate ? "100%" : `${Math.max(3, jobPct)}%`
                                            }}
                                          />
                                        </div>
                                      </>
                                    ) : (
                                      <div className="flex items-center gap-2">
                                        <span
                                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                                            job.status === "COMPLETED"
                                              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                              : job.status === "FAILED"
                                                ? "bg-red-500/15 text-red-600 dark:text-red-400"
                                                : "bg-(--surface-soft) text-(--muted)"
                                          }`}
                                        >
                                          {job.status === "COMPLETED"
                                            ? `Deep history collected · ${job.commitsCollected} commits`
                                            : job.status === "FAILED"
                                              ? "Deep collect failed"
                                              : "Deep collect cancelled"}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => dismissJob(job.id)}
                                          aria-label="Dismiss"
                                          className="grid h-5 w-5 place-items-center rounded-full text-(--muted) transition hover:bg-(--surface-soft) hover:text-(--text)"
                                        >
                                          <X size={12} />
                                        </button>
                                      </div>
                                    )}
                                    {!jobActive && job.status === "FAILED" && job.error ? (
                                      <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">
                                        {job.error}
                                      </p>
                                    ) : null}
                                  </div>
                                ) : null}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <PrivacyBadge isPrivate={repo.isPrivate} />
                                  <LiveSyncBadge liveSync={repo.liveSync} />
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                {manageable ? (
                                  <select
                                    value={repo.project?.id ?? ""}
                                    disabled={busy}
                                    onChange={(event) =>
                                      handleAssignProject(repo, event.target.value)
                                    }
                                    className="field rounded-md px-2.5 py-1.5 text-xs font-semibold text-(--text)"
                                  >
                                    <option value="">No project</option>
                                    {projects.map((project) => (
                                      <option key={project.id} value={project.id}>
                                        {project.name}
                                      </option>
                                    ))}
                                  </select>
                                ) : repo.project ? (
                                  <span className="text-xs font-semibold text-(--text)">
                                    {repo.project.name}
                                  </span>
                                ) : (
                                  <span className="text-xs text-(--muted)">—</span>
                                )}
                                {manageable && sonarProjects.length ? (
                                  <select
                                    value={repo.sonarProjectKey ?? ""}
                                    disabled={busy}
                                    onChange={(event) =>
                                      setSonarKey(repo, event.target.value || null)
                                    }
                                    title="Map this repo to a SonarQube project (for code-quality analysis)"
                                    className="mt-1.5 block rounded-md bg-transparent text-[11px] font-semibold text-(--muted)"
                                  >
                                    <option value="">No Sonar project</option>
                                    {sonarProjects.map((project) => (
                                      <option key={project.key} value={project.key}>
                                        Sonar: {project.name}
                                      </option>
                                    ))}
                                  </select>
                                ) : manageable ? (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => handleSetSonarKeyManual(repo)}
                                    title="Map this repo to a SonarQube project key (for code-quality analysis)"
                                    className="mt-1.5 block text-[11px] font-semibold text-(--muted) hover:text-(--accent) disabled:opacity-50"
                                  >
                                    {repo.sonarProjectKey ? `Sonar: ${repo.sonarProjectKey}` : "+ Sonar key"}
                                  </button>
                                ) : null}
                                {manageable ? (
                                  repo.codeQualityScan.provisioned ? (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() => handleDisableScan(repo)}
                                      title="Automated SonarQube scan runs on each push to the default branch. Click to turn off."
                                      className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-(--accent) hover:opacity-80 disabled:opacity-50"
                                    >
                                      <ShieldCheck size={12} />
                                      Scanning on
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() => handleEnableScan(repo)}
                                      title="Create the SonarQube project + token, inject repo secrets, and add a scan job to the CI workflow (via a PR)."
                                      className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-(--muted) hover:text-(--accent) disabled:opacity-50"
                                    >
                                      <ShieldCheck size={12} />
                                      Enable scan
                                    </button>
                                  )
                                ) : null}
                              </td>
                              {manageable ? (
                                <td className="px-4 py-3">
                                  <div className="flex flex-col items-end gap-1.5">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => handleCollect(repo)}
                                        disabled={busy || jobActive}
                                        className="inline-flex items-center gap-1.5 rounded-md border border-(--border) px-3 py-1.5 text-xs font-semibold text-(--text) transition hover:bg-(--surface) disabled:cursor-not-allowed disabled:opacity-55"
                                      >
                                        {busy ? (
                                          <Loader2 size={13} className="animate-spin" />
                                        ) : (
                                          <History size={13} />
                                        )}
                                        Collect
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleCollectPrs(repo)}
                                        disabled={busy || jobActive}
                                        title="Fetch pull requests + reviews for collaboration metrics"
                                        className="inline-flex items-center gap-1.5 rounded-md border border-(--border) px-3 py-1.5 text-xs font-semibold text-(--text) transition hover:bg-(--surface) disabled:cursor-not-allowed disabled:opacity-55"
                                      >
                                        <GitPullRequest size={13} />
                                        PRs
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleCollectIssues(repo)}
                                        disabled={busy || jobActive}
                                        title="Fetch GitHub Issues and workflow events for work tracking"
                                        className="inline-flex items-center gap-1.5 rounded-md border border-(--border) px-3 py-1.5 text-xs font-semibold text-(--text) transition hover:bg-(--surface) disabled:cursor-not-allowed disabled:opacity-55"
                                      >
                                        <ClipboardList size={13} />
                                        Issues
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setDeepLookback(365);
                                          setDeepVerify(false);
                                          setDeepFormId((current) =>
                                            current === repo.id ? null : repo.id
                                          );
                                        }}
                                        disabled={busy || jobActive}
                                        title="Fetch months or years of history across all branches (runs in the background)"
                                        className="inline-flex items-center gap-1.5 rounded-md border border-(--border) px-3 py-1.5 text-xs font-semibold text-(--text) transition hover:bg-(--surface) disabled:cursor-not-allowed disabled:opacity-55"
                                      >
                                        <HardDriveDownload size={13} />
                                        Deep collect
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleResync(repo)}
                                        disabled={busy}
                                        aria-label="Resync"
                                        className="grid h-8 w-8 place-items-center rounded-md border border-(--border) text-(--text) transition hover:bg-(--surface)"
                                      >
                                        {busy ? (
                                          <Loader2 size={14} className="animate-spin" />
                                        ) : (
                                          <RefreshCw size={14} />
                                        )}
                                      </button>
                                    </div>
                                    {deepFormId === repo.id ? (
                                      <div className="flex items-center justify-end gap-1.5">
                                        <label
                                          title="Re-checks GitHub for anything missed (e.g. commits pushed after an earlier collection)"
                                          className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-bold text-(--muted)"
                                        >
                                          <input
                                            type="checkbox"
                                            checked={deepVerify}
                                            onChange={(event) => setDeepVerify(event.target.checked)}
                                            className="h-3.5 w-3.5 accent-(--accent)"
                                          />
                                          Re-verify
                                        </label>
                                        <select
                                          value={deepLookback}
                                          onChange={(event) =>
                                            setDeepLookback(Number(event.target.value))
                                          }
                                          className="field rounded-md px-2 py-1.5 text-xs font-semibold text-(--text)"
                                        >
                                          {DEEP_LOOKBACKS.map((option) => (
                                            <option key={option.days} value={option.days}>
                                              {option.label}
                                            </option>
                                          ))}
                                        </select>
                                        <button
                                          type="button"
                                          onClick={() => handleDeepStart(repo)}
                                          disabled={busy}
                                          className="btn-gradient inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold"
                                        >
                                          {busy ? (
                                            <Loader2 size={13} className="animate-spin" />
                                          ) : (
                                            <HardDriveDownload size={13} />
                                          )}
                                          Start
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setDeepFormId(null)}
                                          aria-label="Close"
                                          className="grid h-7 w-7 place-items-center rounded-md text-(--muted) transition hover:bg-(--surface-soft) hover:text-(--text)"
                                        >
                                          <X size={13} />
                                        </button>
                                      </div>
                                    ) : null}
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
            </>
          )}
        </section>
      </div>
    </DashboardChrome>
  );
}
