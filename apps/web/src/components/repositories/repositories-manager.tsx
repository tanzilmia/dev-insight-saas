"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Check,
  DownloadCloud,
  FolderGit2,
  Globe,
  HardDriveDownload,
  History,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X
} from "lucide-react";

import {
  type AvailableRepository,
  type CollectionJob,
  type Project,
  type TrackedRepository,
  assignRepositoryProject,
  cancelDeepCollection,
  collectActivity,
  getApiErrorMessage,
  listCollectionJobs,
  listProjects,
  listRepositories,
  resyncRepository,
  selectRepositories,
  startDeepCollection,
  syncRepositories,
  untrackRepository
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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [available, setAvailable] = useState<AvailableRepository[] | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [rowNotice, setRowNotice] = useState<{
    text: string;
    tone: "success" | "warning";
  } | null>(null);

  const [availableQuery, setAvailableQuery] = useState("");
  const [trackedQuery, setTrackedQuery] = useState("");

  // Deep-history collection jobs, keyed by repository id (latest per repo).
  const [jobs, setJobs] = useState<Record<string, CollectionJob>>({});
  const [dismissedJobs, setDismissedJobs] = useState<Set<string>>(new Set());
  const [deepFormId, setDeepFormId] = useState<string | null>(null);
  const [deepLookback, setDeepLookback] = useState<number>(365);
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

  const untrackedAvailable = useMemo(
    () => available?.filter((repo) => !repo.tracked) ?? [],
    [available]
  );

  const filteredAvailable = useMemo(() => {
    if (!available) {
      return [];
    }
    const query = availableQuery.trim().toLowerCase();
    if (!query) {
      return available;
    }
    return available.filter((repo) => repo.fullName.toLowerCase().includes(query));
  }, [available, availableQuery]);

  const filteredTracked = useMemo(() => {
    const query = trackedQuery.trim().toLowerCase();
    if (!query) {
      return tracked;
    }
    return tracked.filter((repo) => repo.fullName.toLowerCase().includes(query));
  }, [tracked, trackedQuery]);

  async function handleSync() {
    if (!organizationId) {
      return;
    }

    setSyncing(true);
    setSyncError(null);
    setSelectedIds(new Set());

    try {
      setAvailable(await syncRepositories(organizationId));
    } catch (error) {
      setSyncError(getApiErrorMessage(error));
      setAvailable(null);
    } finally {
      setSyncing(false);
    }
  }

  function toggleSelect(externalId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(externalId)) {
        next.delete(externalId);
      } else {
        next.add(externalId);
      }
      return next;
    });
  }

  async function handleAddSelected() {
    if (!organizationId || !available || selectedIds.size === 0) {
      return;
    }

    setSaving(true);
    setSyncError(null);

    try {
      const payload = available
        .filter((repo) => selectedIds.has(repo.externalId))
        .map((repo) => ({
          externalId: repo.externalId,
          owner: repo.owner,
          name: repo.name,
          fullName: repo.fullName,
          remoteUrl: repo.remoteUrl,
          isPrivate: repo.isPrivate,
          defaultBranch: repo.defaultBranch
        }));
      await selectRepositories(organizationId, payload);
      setAvailable(null);
      setSelectedIds(new Set());
      await refresh();
    } catch (error) {
      setSyncError(getApiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

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

  async function handleUntrack(repo: TrackedRepository) {
    if (
      !window.confirm(
        `Untrack ${repo.fullName}? It will stop syncing and won't appear in new reports.`
      )
    ) {
      return;
    }
    setBusyId(repo.id);
    setRowError(null);

    try {
      await untrackRepository(repo.id);
      await refresh();
    } catch (error) {
      setRowError(getApiErrorMessage(error));
    } finally {
      setBusyId(null);
    }
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

  async function handleDeepStart(repo: TrackedRepository) {
    setBusyId(repo.id);
    setRowError(null);
    setRowNotice(null);

    try {
      const job = await startDeepCollection(repo.id, deepLookback);
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

  const needsCredential = syncError?.toLowerCase().includes("connect a github");

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
              Sync repositories from GitHub and choose which ones DevInsight should track
              for reports.
            </p>
          </div>
          {manageable ? (
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing}
              className="btn-gradient inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold"
            >
              {syncing ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <DownloadCloud size={16} />
              )}
              {syncing ? "Syncing..." : "Sync from GitHub"}
            </button>
          ) : null}
        </section>

        {syncError ? (
          <div className="glass rounded-[1.5rem] p-5 text-sm font-bold text-red-600 dark:text-red-400">
            {syncError}
            {needsCredential ? (
              <>
                {" "}
                <Link href="/dashboard/git" className="underline">
                  Connect GitHub →
                </Link>
              </>
            ) : null}
          </div>
        ) : null}

        {available ? (
          <section className="glass animate-rise rounded-[2rem] p-6 md:p-7">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-black text-(--text)">
                Available on GitHub ({available.length})
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAvailable(null);
                    setSelectedIds(new Set());
                  }}
                  className="glass glass-hover rounded-full px-4 py-2 text-sm font-bold text-(--text)"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handleAddSelected}
                  disabled={saving || selectedIds.size === 0}
                  className="btn-gradient inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-black"
                >
                  {saving ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Plus size={15} />
                  )}
                  Add {selectedIds.size || ""} selected
                </button>
              </div>
            </div>

            <div className="field mb-4 flex items-center gap-2 rounded-2xl px-3.5 py-2.5">
              <Search size={15} className="shrink-0 text-(--muted)" />
              <input
                value={availableQuery}
                onChange={(event) => setAvailableQuery(event.target.value)}
                placeholder="Search repositories…"
                className="w-full bg-transparent text-sm font-medium text-(--text) outline-none placeholder:font-normal"
              />
            </div>

            {untrackedAvailable.length === 0 ? (
              <p className="glass-soft rounded-2xl px-4 py-4 text-center text-sm font-bold text-(--muted)">
                All available repositories are already tracked.
              </p>
            ) : filteredAvailable.length === 0 ? (
              <p className="glass-soft rounded-2xl px-4 py-4 text-center text-sm font-bold text-(--muted)">
                No repositories match “{availableQuery}”.
              </p>
            ) : (
              <ul className="grid max-h-96 gap-2 overflow-y-auto pr-1">
                {filteredAvailable.map((repo) => {
                  const checked = selectedIds.has(repo.externalId);
                  return (
                    <li key={repo.externalId}>
                      <button
                        type="button"
                        disabled={repo.tracked}
                        onClick={() => toggleSelect(repo.externalId)}
                        className={`glass-soft flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left ${
                          repo.tracked ? "opacity-60" : "glass-hover"
                        } ${checked ? "ring-2 ring-(--accent-2)" : ""}`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-black text-(--text)">
                            {repo.fullName}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <PrivacyBadge isPrivate={repo.isPrivate} />
                          {repo.tracked ? (
                            <span className="text-xs font-black text-(--muted)">
                              Tracked
                            </span>
                          ) : (
                            <span
                              className={`grid h-5 w-5 place-items-center rounded-md border ${
                                checked
                                  ? "btn-gradient border-transparent"
                                  : "border-(--field-border)"
                              }`}
                            >
                              {checked ? <Check size={13} /> : null}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}

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
              {manageable ? " Use “Sync from GitHub” to add some." : ""}
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
                                <PrivacyBadge isPrivate={repo.isPrivate} />
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
                                        onClick={() => {
                                          setDeepLookback(365);
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
                                      <button
                                        type="button"
                                        onClick={() => handleUntrack(repo)}
                                        disabled={busy}
                                        aria-label="Untrack"
                                        className="grid h-8 w-8 place-items-center rounded-md text-(--muted) transition hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                    {deepFormId === repo.id ? (
                                      <div className="flex items-center justify-end gap-1.5">
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
