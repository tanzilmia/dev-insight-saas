"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  FolderGit2,
  FolderKanban,
  Link2,
  Loader2,
  Unlink,
  UserMinus,
  UserPlus,
  Users
} from "lucide-react";

import {
  type Employee,
  type ProjectDetail,
  type ProjectRole,
  type TrackedRepository,
  addProjectMember,
  assignRepositoryProject,
  getApiErrorMessage,
  getProject,
  listEmployees,
  listRepositories,
  removeProjectMember
} from "@/lib/api";
import { canManage, useSession } from "@/lib/use-session";
import {
  DashboardChrome,
  DashboardLoading
} from "@/components/dashboard/dashboard-chrome";
import { AnalysisManager } from "@/components/analysis/analysis-manager";

const ROLE_OPTIONS: ProjectRole[] = ["DEVELOPER", "LEAD", "REVIEWER"];

function statusPill(status: string) {
  return status === "ACTIVE"
    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
    : "bg-(--surface-soft) text-(--muted)";
}

/**
 * The project hub: everything about one project in one place — connected
 * repositories (attach/detach), the team, and the full analysis experience
 * locked to this project.
 */
export function ProjectDetailPage({ projectId }: { projectId: string }) {
  const { session, status, activeOrganization, logout } = useSession();
  const organizationId = activeOrganization?.id;
  const manageable = canManage(activeOrganization?.role);

  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [repositories, setRepositories] = useState<TrackedRepository[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [attachRepoId, setAttachRepoId] = useState("");
  const [memberUserId, setMemberUserId] = useState("");
  const [memberRole, setMemberRole] = useState<ProjectRole>("DEVELOPER");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // State is set only inside .then/.catch/.finally callbacks (deferred), so
  // this is safe to call from an effect (react-hooks/set-state-in-effect).
  const refresh = useCallback(() => {
    if (!organizationId) {
      return Promise.resolve();
    }
    return Promise.all([getProject(projectId), listRepositories(organizationId)])
      .then(([project, repos]) => {
        setDetail(project);
        setRepositories(repos);
        setLoadError(null);
      })
      .catch((caught) => {
        setLoadError(getApiErrorMessage(caught));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [organizationId, projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!organizationId || !manageable) {
      return;
    }
    listEmployees(organizationId)
      .then(setEmployees)
      .catch(() => setEmployees([]));
  }, [organizationId, manageable]);

  const connectedRepos = useMemo(
    () => repositories.filter((repo) => repo.project?.id === projectId),
    [repositories, projectId]
  );
  const attachableRepos = useMemo(
    () => repositories.filter((repo) => repo.project?.id !== projectId),
    [repositories, projectId]
  );
  const assignableEmployees = useMemo(() => {
    const memberIds = new Set((detail?.members ?? []).map((member) => member.id));
    return employees.filter(
      (employee) => employee.status === "ACTIVE" && !memberIds.has(employee.id)
    );
  }, [employees, detail]);

  async function handleAttach() {
    if (!attachRepoId) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await assignRepositoryProject(attachRepoId, projectId);
      setAttachRepoId("");
      await refresh();
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleDetach(repo: TrackedRepository) {
    if (!window.confirm(`Detach ${repo.fullName} from this project?`)) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await assignRepositoryProject(repo.id, null);
      await refresh();
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleAddMember() {
    if (!memberUserId) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await addProjectMember(projectId, { userId: memberUserId, role: memberRole });
      setMemberUserId("");
      setMemberRole("DEVELOPER");
      await refresh();
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveMember(userId: string, name: string) {
    if (!window.confirm(`Remove ${name} from this project?`)) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await removeProjectMember(projectId, userId);
      await refresh();
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading") {
    return <DashboardLoading />;
  }

  if (!session) {
    return null;
  }

  return (
    <DashboardChrome email={session.user.email} onLogout={logout}>
      <div className="grid gap-5">
        <Link
          href="/dashboard/projects"
          className="inline-flex w-fit items-center gap-1.5 text-xs font-bold text-(--muted) transition hover:text-(--text)"
        >
          <ArrowLeft size={13} />
          All projects
        </Link>

        {loading && !detail ? (
          <div className="glass grid place-items-center rounded-xl p-16 text-(--muted)">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : loadError ? (
          <div className="glass rounded-xl p-6 text-sm font-bold text-red-600 dark:text-red-400">
            {loadError}
          </div>
        ) : detail ? (
          <>
            <section className="glass animate-rise rounded-xl p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="mb-1.5 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-(--accent)">
                    <FolderKanban size={14} />
                    Project
                  </p>
                  <h1 className="text-xl font-bold tracking-tight text-(--text)">
                    {detail.name}
                  </h1>
                  {detail.description ? (
                    <p className="mt-1.5 max-w-xl text-sm leading-6 text-(--muted)">
                      {detail.description}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-black ${statusPill(detail.status)}`}
                  >
                    {detail.status}
                  </span>
                  <span className="rounded-full bg-(--surface-soft) px-2.5 py-1 text-xs font-bold text-(--muted)">
                    {detail.members.length} member{detail.members.length === 1 ? "" : "s"}
                  </span>
                  <span className="rounded-full bg-(--surface-soft) px-2.5 py-1 text-xs font-bold text-(--muted)">
                    {connectedRepos.length} repo{connectedRepos.length === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
            </section>

            {actionError ? (
              <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-600 dark:text-red-400">
                {actionError}
              </p>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="glass rounded-xl p-5">
                <h2 className="mb-3 inline-flex items-center gap-2 text-sm font-bold text-(--text)">
                  <FolderGit2 size={15} />
                  Repositories
                </h2>
                {connectedRepos.length ? (
                  <ul className="grid gap-2">
                    {connectedRepos.map((repo) => (
                      <li
                        key={repo.id}
                        className="glass-soft flex items-center justify-between gap-3 rounded-lg px-3.5 py-2.5"
                      >
                        <div className="min-w-0">
                          <a
                            href={repo.remoteUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="block truncate text-sm font-semibold text-(--text) hover:text-(--accent)"
                          >
                            {repo.fullName}
                          </a>
                          <p className="text-xs text-(--muted)">
                            {repo.commitCount} commit{repo.commitCount === 1 ? "" : "s"}
                            {repo.liveSync.status === "ACTIVE" ? " · live sync" : ""}
                          </p>
                        </div>
                        {manageable ? (
                          <button
                            type="button"
                            onClick={() => handleDetach(repo)}
                            disabled={busy}
                            title="Detach from this project"
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-(--muted) transition hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                          >
                            <Unlink size={13} />
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="glass-soft rounded-lg px-4 py-3 text-sm text-(--muted)">
                    No repositories connected yet.
                  </p>
                )}
                {manageable && attachableRepos.length ? (
                  <div className="mt-3 flex items-center gap-2">
                    <select
                      value={attachRepoId}
                      onChange={(event) => setAttachRepoId(event.target.value)}
                      className="field min-w-0 flex-1 rounded-lg px-3 py-2 text-sm font-medium text-(--text)"
                    >
                      <option value="">Attach a repository…</option>
                      {attachableRepos.map((repo) => (
                        <option key={repo.id} value={repo.id}>
                          {repo.fullName}
                          {repo.project ? ` (in ${repo.project.name})` : ""}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleAttach}
                      disabled={busy || !attachRepoId}
                      className="btn-gradient inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold"
                    >
                      {busy ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Link2 size={14} />
                      )}
                      Attach
                    </button>
                  </div>
                ) : null}
              </section>

              <section className="glass rounded-xl p-5">
                <h2 className="mb-3 inline-flex items-center gap-2 text-sm font-bold text-(--text)">
                  <Users size={15} />
                  Team
                </h2>
                {detail.members.length ? (
                  <ul className="grid gap-2">
                    {detail.members.map((member) => (
                      <li
                        key={member.id}
                        className="glass-soft flex items-center justify-between gap-3 rounded-lg px-3.5 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-(--text)">
                            {member.name}
                          </p>
                          <p className="truncate text-xs text-(--muted)">{member.email}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="rounded-full bg-(--surface-soft) px-2 py-0.5 text-[11px] font-bold text-(--muted)">
                            {member.role}
                          </span>
                          {manageable ? (
                            <button
                              type="button"
                              onClick={() => handleRemoveMember(member.id, member.name)}
                              disabled={busy}
                              title="Remove from project"
                              className="grid h-7 w-7 place-items-center rounded-md text-(--muted) transition hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                            >
                              <UserMinus size={13} />
                            </button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="glass-soft rounded-lg px-4 py-3 text-sm text-(--muted)">
                    No team members yet.
                  </p>
                )}
                {manageable && assignableEmployees.length ? (
                  <div className="mt-3 flex items-center gap-2">
                    <select
                      value={memberUserId}
                      onChange={(event) => setMemberUserId(event.target.value)}
                      className="field min-w-0 flex-1 rounded-lg px-3 py-2 text-sm font-medium text-(--text)"
                    >
                      <option value="">Add a member…</option>
                      {assignableEmployees.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={memberRole}
                      onChange={(event) => setMemberRole(event.target.value as ProjectRole)}
                      className="field shrink-0 rounded-lg px-2.5 py-2 text-sm font-medium text-(--text)"
                    >
                      {ROLE_OPTIONS.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleAddMember}
                      disabled={busy || !memberUserId}
                      className="btn-gradient inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold"
                    >
                      {busy ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <UserPlus size={14} />
                      )}
                      Add
                    </button>
                  </div>
                ) : null}
              </section>
            </div>

            {manageable ? (
              <AnalysisManager initialProjectId={projectId} hideProjectSelector embedded />
            ) : null}
          </>
        ) : null}
      </div>
    </DashboardChrome>
  );
}
