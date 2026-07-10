"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Check,
  DownloadCloud,
  EyeOff,
  Loader2,
  RotateCcw,
  Sparkles,
  UserCheck,
  X
} from "lucide-react";

import {
  type Contributor,
  type ContributorSuggestionMatch,
  type Employee,
  type TrackedRepository,
  discoverContributors,
  getApiErrorMessage,
  ignoreContributor,
  listContributorSuggestions,
  listEmployees,
  listRepositories,
  listRepositoryContributors,
  mapContributor,
  unmapContributor
} from "@/lib/api";
import { canManage, useSession } from "@/lib/use-session";
import {
  DashboardChrome,
  DashboardLoading
} from "@/components/dashboard/dashboard-chrome";

function Avatar({ username }: { username: string | null }) {
  const letter = (username ?? "?").charAt(0).toUpperCase();
  return (
    <span className="btn-gradient grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-black">
      {letter}
    </span>
  );
}

export function ContributorsManager() {
  const { session, status, activeOrganization, logout } = useSession();
  const organizationId = activeOrganization?.id;
  const manageable = canManage(activeOrganization?.role);

  const [repos, setRepos] = useState<TrackedRepository[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState("");

  const [contributors, setContributors] = useState<Contributor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [discovering, setDiscovering] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  // Suggested employee matches per contributor id (managers only).
  const [suggestions, setSuggestions] = useState<
    Record<string, ContributorSuggestionMatch[]>
  >({});

  useEffect(() => {
    if (!organizationId) {
      return;
    }

    listRepositories(organizationId)
      .then((tracked) => {
        setRepos(tracked);
        setSelectedRepoId((current) => current || tracked[0]?.id || "");
      })
      .catch(() => setRepos([]));

    listEmployees(organizationId)
      .then(setEmployees)
      .catch(() => setEmployees([]));
  }, [organizationId]);

  // .then callbacks keep setState deferred (react-hooks/set-state-in-effect).
  const loadContributors = useCallback(() => {
    if (!selectedRepoId) {
      return Promise.resolve().then(() => setLoading(false));
    }

    return listRepositoryContributors(selectedRepoId)
      .then((list) => {
        setContributors(list);
        setLoadError(null);
      })
      .catch((error) => {
        setLoadError(getApiErrorMessage(error));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [selectedRepoId]);

  useEffect(() => {
    void loadContributors();
  }, [loadContributors]);

  // Suggestions are a manager tool; skip the call for read-only viewers.
  const loadSuggestions = useCallback(() => {
    if (!selectedRepoId || !manageable) {
      // Defer setState so this is safe to call directly from an effect.
      return Promise.resolve().then(() => setSuggestions({}));
    }

    return listContributorSuggestions(selectedRepoId)
      .then((list) => {
        const map: Record<string, ContributorSuggestionMatch[]> = {};
        for (const item of list) {
          map[item.contributorId] = item.suggestions;
        }
        setSuggestions(map);
      })
      .catch(() => setSuggestions({}));
  }, [selectedRepoId, manageable]);

  useEffect(() => {
    void loadSuggestions();
  }, [loadSuggestions]);

  function dismissSuggestions(contributorId: string) {
    setSuggestions((current) => {
      const next = { ...current };
      delete next[contributorId];
      return next;
    });
  }

  async function handleDiscover() {
    if (!selectedRepoId) {
      return;
    }

    setDiscovering(true);
    setRowError(null);

    try {
      setContributors(await discoverContributors(selectedRepoId));
      await loadSuggestions();
    } catch (error) {
      setRowError(getApiErrorMessage(error));
    } finally {
      setDiscovering(false);
    }
  }

  async function runRowAction(id: string, action: () => Promise<Contributor>) {
    setBusyId(id);
    setRowError(null);

    try {
      const updated = await action();
      setContributors((current) =>
        current.map((item) => (item.id === id ? updated : item))
      );
    } catch (error) {
      setRowError(getApiErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  function handleMapChange(contributor: Contributor, userId: string) {
    if (userId) {
      void runRowAction(contributor.id, () => mapContributor(contributor.id, userId));
    } else if (contributor.mapping) {
      void runRowAction(contributor.id, () => unmapContributor(contributor.id));
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
      <div className="grid gap-6">
        <section className="glass animate-rise rounded-xl p-5">
          <p className="mb-2 inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.28em] text-(--accent)">
            <UserCheck size={14} />
            Contributors
          </p>
          <h1 className="text-xl font-bold tracking-tight text-(--text)">
            Map Git identities to employees
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-(--muted)">
            Discover who contributes to each repository, then map each Git
            identity to an employee so reports are accurate.
          </p>

          {repos.length === 0 ? (
            <p className="mt-5 rounded-2xl border border-(--border) bg-(--surface-soft) px-4 py-3 text-sm font-bold text-(--muted)">
              No tracked repositories yet.{" "}
              <Link href="/dashboard/repositories" className="text-(--accent) underline">
                Track a repository first →
              </Link>
            </p>
          ) : (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <select
                value={selectedRepoId}
                onChange={(event) => {
                  setLoading(true);
                  setSelectedRepoId(event.target.value);
                }}
                className="field rounded-2xl px-4 py-2.5 text-sm font-bold text-(--text)"
              >
                {repos.map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repo.fullName}
                  </option>
                ))}
              </select>
              {manageable ? (
                <button
                  type="button"
                  onClick={handleDiscover}
                  disabled={discovering || !selectedRepoId}
                  className="btn-gradient inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-black"
                >
                  {discovering ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <DownloadCloud size={16} />
                  )}
                  {discovering ? "Discovering..." : "Discover contributors"}
                </button>
              ) : null}
            </div>
          )}
        </section>

        {rowError ? (
          <p className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-600 dark:text-red-400">
            {rowError}
          </p>
        ) : null}

        <section className="animate-rise [animation-delay:60ms]">
          {loading ? (
            <div className="glass grid place-items-center rounded-xl p-10 text-(--muted)">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : loadError ? (
            <div className="glass rounded-xl p-6 text-sm font-bold text-red-600 dark:text-red-400">
              {loadError}
            </div>
          ) : contributors.length === 0 ? (
            <div className="glass rounded-xl p-8 text-center text-sm font-bold text-(--muted)">
              No contributors discovered yet.
              {manageable ? " Use “Discover contributors” above." : ""}
            </div>
          ) : (
            <ul className="grid gap-3">
              {contributors.map((contributor) => {
                const busy = busyId === contributor.id;
                const rowSuggestions =
                  manageable && !contributor.mapping && !contributor.ignored
                    ? suggestions[contributor.id] ?? []
                    : [];
                return (
                  <li
                    key={contributor.id}
                    className={`glass glass-hover rounded-lg p-5 ${
                      contributor.ignored ? "opacity-60" : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar username={contributor.username} />
                        <div className="min-w-0">
                          <p className="truncate text-base font-black text-(--text)">
                            {contributor.username ?? "unknown"}
                          </p>
                          <p className="text-xs font-bold text-(--muted)">
                            {contributor.contributions} contribution
                            {contributor.contributions === 1 ? "" : "s"}
                            {contributor.mapping
                              ? ` · mapped to ${contributor.mapping.name}`
                              : ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {busy ? (
                          <Loader2 size={15} className="animate-spin text-(--muted)" />
                        ) : null}
                        {manageable ? (
                          <>
                            <select
                              value={contributor.mapping?.userId ?? ""}
                              disabled={busy || contributor.ignored}
                              onChange={(event) =>
                                handleMapChange(contributor, event.target.value)
                              }
                              className="field rounded-full px-3 py-1.5 text-xs font-bold text-(--text)"
                            >
                              <option value="">Unmapped</option>
                              {activeEmployees.map((employee) => (
                                <option key={employee.id} value={employee.id}>
                                  {employee.name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() =>
                                runRowAction(contributor.id, () =>
                                  ignoreContributor(contributor.id, !contributor.ignored)
                                )
                              }
                              disabled={busy}
                              className="glass glass-hover inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-(--text)"
                            >
                              {contributor.ignored ? (
                                <>
                                  <RotateCcw size={13} /> Restore
                                </>
                              ) : (
                                <>
                                  <EyeOff size={13} /> Ignore
                                </>
                              )}
                            </button>
                          </>
                        ) : contributor.mapping ? (
                          <span className="glass-soft inline-flex items-center rounded-full px-3 py-1.5 text-xs font-black text-(--text)">
                            {contributor.mapping.name}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-(--muted)">
                            <X size={13} /> Unmapped
                          </span>
                        )}
                      </div>
                    </div>

                    {rowSuggestions.length > 0 ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-(--surface-soft) px-3 py-2">
                        <Sparkles size={14} className="shrink-0 text-(--accent)" />
                        <span className="text-xs font-black uppercase tracking-wide text-(--muted)">
                          Suggested
                        </span>
                        {rowSuggestions.map((suggestion) => (
                          <button
                            key={suggestion.userId}
                            type="button"
                            title={suggestion.reason}
                            disabled={busy}
                            onClick={() =>
                              runRowAction(contributor.id, () =>
                                mapContributor(contributor.id, suggestion.userId)
                              )
                            }
                            className="inline-flex items-center gap-1.5 rounded-full border border-(--border) bg-(--surface) px-3 py-1.5 text-xs font-bold text-(--text) transition hover:border-transparent hover:bg-(--accent) hover:text-white"
                          >
                            <Check size={13} />
                            {suggestion.name}
                            <span className="text-[10px] font-bold uppercase tracking-wide opacity-70">
                              {suggestion.confidence}
                            </span>
                          </button>
                        ))}
                        <span className="hidden text-[11px] text-(--muted) sm:inline">
                          {rowSuggestions[0].reason}
                        </span>
                        <button
                          type="button"
                          onClick={() => dismissSuggestions(contributor.id)}
                          className="ml-auto text-[11px] font-bold text-(--muted) underline underline-offset-2 transition hover:text-(--text)"
                        >
                          Dismiss
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </DashboardChrome>
  );
}
