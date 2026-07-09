"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Check,
  DownloadCloud,
  FolderGit2,
  Globe,
  History,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Trash2
} from "lucide-react";

import {
  type AvailableRepository,
  type Project,
  type TrackedRepository,
  assignRepositoryProject,
  collectActivity,
  getApiErrorMessage,
  listProjects,
  listRepositories,
  resyncRepository,
  selectRepositories,
  syncRepositories,
  untrackRepository
} from "@/lib/api";
import { canManage, useSession } from "@/lib/use-session";
import {
  DashboardChrome,
  DashboardLoading
} from "@/components/dashboard/dashboard-chrome";

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
  const [rowNotice, setRowNotice] = useState<string | null>(null);

  const [availableQuery, setAvailableQuery] = useState("");
  const [trackedQuery, setTrackedQuery] = useState("");

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
      setRowNotice(
        `Collected ${result.newCollected} new commit(s) across ${result.branchesChecked} branch(es) from ${repo.fullName} (last 90 days).`
      );
      await refresh();
    } catch (error) {
      setRowError(getApiErrorMessage(error));
    } finally {
      setBusyId(null);
    }
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
            <p className="mb-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-600 dark:text-emerald-400">
              {rowNotice}
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
                                  <div className="flex items-center justify-end gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => handleCollect(repo)}
                                      disabled={busy}
                                      className="inline-flex items-center gap-1.5 rounded-md border border-(--border) px-3 py-1.5 text-xs font-semibold text-(--text) transition hover:bg-(--surface)"
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
