"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  FolderKanban,
  Loader2,
  Plus,
  Trash2,
  UserPlus,
  X
} from "lucide-react";

import {
  type Employee,
  type Project,
  type ProjectDetail,
  type ProjectRole,
  addProjectMember,
  createProject,
  deleteProject,
  getApiErrorMessage,
  getProject,
  listEmployees,
  listProjects,
  removeProjectMember,
  updateProject
} from "@/lib/api";
import { canManage, useSession } from "@/lib/use-session";
import {
  DashboardChrome,
  DashboardLoading
} from "@/components/dashboard/dashboard-chrome";

const PROJECT_ROLES: ProjectRole[] = ["LEAD", "DEVELOPER", "REVIEWER"];

const fieldClass =
  "field w-full rounded-lg px-3.5 py-2.5 text-sm font-medium text-(--text) placeholder:font-normal";

function statusTone(status: Project["status"]) {
  return status === "ACTIVE"
    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
    : "bg-amber-500/15 text-amber-600 dark:text-amber-400";
}

export function ProjectsManager() {
  const { session, status, activeOrganization, logout } = useSession();
  const organizationId = activeOrganization?.id;
  const manageable = canManage(activeOrganization?.role);

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [employees, setEmployees] = useState<Employee[]>([]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const [memberUserId, setMemberUserId] = useState("");
  const [memberRole, setMemberRole] = useState<ProjectRole>("DEVELOPER");
  const [memberBusy, setMemberBusy] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);

  // Uses .then callbacks (not async/await) so setState stays deferred and this
  // is safe to call directly from an effect (react-hooks/set-state-in-effect).
  const refreshProjects = useCallback(() => {
    if (!organizationId) {
      return Promise.resolve();
    }

    return listProjects(organizationId)
      .then((data) => {
        setProjects(data);
        setLoadError(null);
      })
      .catch((error) => {
        setLoadError(getApiErrorMessage(error));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [organizationId]);

  const loadDetail = useCallback(async (projectId: string) => {
    setDetailLoading(true);
    setDetailError(null);

    try {
      setDetail(await getProject(projectId));
    } catch (error) {
      setDetailError(getApiErrorMessage(error));
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    if (!organizationId) {
      return;
    }

    listEmployees(organizationId)
      .then(setEmployees)
      .catch(() => setEmployees([]));
  }, [organizationId]);

  const assignableEmployees = useMemo(() => {
    const memberIds = new Set(detail?.members.map((member) => member.id));
    return employees.filter(
      (employee) => employee.status === "ACTIVE" && !memberIds.has(employee.id)
    );
  }, [employees, detail]);

  function handleSelect(projectId: string) {
    setSelectedId(projectId);
    setMemberError(null);
    setMemberUserId("");
    setMemberRole("DEVELOPER");
    void loadDetail(projectId);
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!organizationId) {
      return;
    }

    setCreating(true);
    setCreateError(null);

    try {
      const project = await createProject({
        organizationId,
        name,
        description: description.trim() ? description.trim() : undefined
      });
      setName("");
      setDescription("");
      await refreshProjects();
      handleSelect(project.id);
    } catch (error) {
      setCreateError(getApiErrorMessage(error));
    } finally {
      setCreating(false);
    }
  }

  async function handleArchiveToggle() {
    if (!detail) {
      return;
    }

    setActionBusy(true);
    setDetailError(null);

    try {
      await updateProject(detail.id, {
        status: detail.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE"
      });
      await Promise.all([loadDetail(detail.id), refreshProjects()]);
    } catch (error) {
      setDetailError(getApiErrorMessage(error));
    } finally {
      setActionBusy(false);
    }
  }

  async function handleDelete() {
    if (!detail) {
      return;
    }

    setActionBusy(true);
    setDetailError(null);

    try {
      await deleteProject(detail.id);
      setSelectedId(null);
      setDetail(null);
      await refreshProjects();
    } catch (error) {
      setDetailError(getApiErrorMessage(error));
    } finally {
      setActionBusy(false);
    }
  }

  async function handleAddMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!detail || !memberUserId) {
      return;
    }

    setMemberBusy(true);
    setMemberError(null);

    try {
      await addProjectMember(detail.id, { userId: memberUserId, role: memberRole });
      setMemberUserId("");
      setMemberRole("DEVELOPER");
      await Promise.all([loadDetail(detail.id), refreshProjects()]);
    } catch (error) {
      setMemberError(getApiErrorMessage(error));
    } finally {
      setMemberBusy(false);
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!detail) {
      return;
    }

    setMemberBusy(true);
    setMemberError(null);

    try {
      await removeProjectMember(detail.id, userId);
      await Promise.all([loadDetail(detail.id), refreshProjects()]);
    } catch (error) {
      setMemberError(getApiErrorMessage(error));
    } finally {
      setMemberBusy(false);
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
      <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
        <section className="grid gap-6">
          {manageable ? (
            <div className="glass animate-rise rounded-xl p-5">
              <p className="mb-2 inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.28em] text-(--accent)">
                <FolderKanban size={14} />
                Projects
              </p>
              <h1 className="text-xl font-bold tracking-tight text-(--text)">
                New project
              </h1>
              <form onSubmit={handleCreate} className="mt-5 grid gap-4">
                <label className="grid gap-2 text-sm font-bold text-(--text)">
                  Name
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    minLength={2}
                    className={fieldClass}
                    placeholder="Mobile App"
                  />
                </label>
                <label className="grid gap-2 text-sm font-bold text-(--text)">
                  Description
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={3}
                    className={`${fieldClass} resize-none`}
                    placeholder="Optional summary of the project"
                  />
                </label>

                {createError ? (
                  <p className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-600 dark:text-red-400">
                    {createError}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={creating}
                  className="btn-gradient inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold"
                >
                  {creating ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Plus size={16} />
                  )}
                  {creating ? "Creating..." : "Create project"}
                </button>
              </form>
            </div>
          ) : null}

          <div className="animate-rise [animation-delay:60ms]">
            <h2 className="mb-4 text-lg font-black text-(--text)">
              {projects.length} project{projects.length === 1 ? "" : "s"}
            </h2>

            {loading ? (
              <div className="glass grid place-items-center rounded-xl p-10 text-(--muted)">
                <Loader2 size={20} className="animate-spin" />
              </div>
            ) : loadError ? (
              <div className="glass rounded-xl p-6 text-sm font-bold text-red-600 dark:text-red-400">
                {loadError}
              </div>
            ) : projects.length === 0 ? (
              <div className="glass rounded-xl p-8 text-center text-sm font-bold text-(--muted)">
                No projects yet.
              </div>
            ) : (
              <ul className="grid gap-3">
                {projects.map((project) => (
                  <li key={project.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(project.id)}
                      className={`glass glass-hover w-full rounded-lg p-5 text-left ${
                        selectedId === project.id
                          ? "ring-2 ring-(--accent-2)"
                          : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-base font-black text-(--text)">
                          {project.name}
                        </p>
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-black ${statusTone(project.status)}`}
                        >
                          {project.status}
                        </span>
                      </div>
                      {project.description ? (
                        <p className="mt-1.5 line-clamp-2 text-sm font-medium text-(--muted)">
                          {project.description}
                        </p>
                      ) : null}
                      <p className="mt-2 text-xs font-bold uppercase tracking-wide text-(--muted)">
                        {project.memberCount} member
                        {project.memberCount === 1 ? "" : "s"}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="animate-rise [animation-delay:80ms] lg:sticky lg:top-6">
          {!selectedId ? (
            <div className="glass-soft grid place-items-center rounded-xl p-10 text-center text-sm font-bold text-(--muted)">
              Select a project to view members and settings.
            </div>
          ) : detailLoading ? (
            <div className="glass grid place-items-center rounded-xl p-10 text-(--muted)">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : detailError ? (
            <div className="glass rounded-xl p-6 text-sm font-bold text-red-600 dark:text-red-400">
              {detailError}
            </div>
          ) : detail ? (
            <div className="glass rounded-xl p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-2xl font-black tracking-tight text-(--text)">
                    {detail.name}
                  </h2>
                  <p className="mt-1 text-sm font-medium text-(--muted)">
                    {detail.description ?? "No description"}
                  </p>
                </div>
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-black ${statusTone(detail.status)}`}
                >
                  {detail.status}
                </span>
              </div>

              {manageable ? (
                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleArchiveToggle}
                    disabled={actionBusy}
                    className="glass glass-hover inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-(--text)"
                  >
                    {detail.status === "ACTIVE" ? (
                      <Archive size={15} />
                    ) : (
                      <ArchiveRestore size={15} />
                    )}
                    {detail.status === "ACTIVE" ? "Archive" : "Reactivate"}
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={actionBusy}
                    className="inline-flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-bold text-red-600 transition hover:bg-red-500/20 dark:text-red-400"
                  >
                    <Trash2 size={15} />
                    Delete
                  </button>
                </div>
              ) : null}

              <div className="hairline my-6" />

              <h3 className="text-lg font-black text-(--text)">
                Members ({detail.members.length})
              </h3>

              {manageable ? (
                <form
                  onSubmit={handleAddMember}
                  className="mt-4 flex flex-wrap items-end gap-2"
                >
                  <label className="grid flex-1 gap-1.5 text-xs font-bold uppercase tracking-wide text-(--muted)">
                    Employee
                    <select
                      value={memberUserId}
                      onChange={(event) => setMemberUserId(event.target.value)}
                      required
                      className="field min-w-40 rounded-2xl px-3 py-2.5 text-sm font-medium text-(--text)"
                    >
                      <option value="">Select…</option>
                      {assignableEmployees.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1.5 text-xs font-bold uppercase tracking-wide text-(--muted)">
                    Role
                    <select
                      value={memberRole}
                      onChange={(event) =>
                        setMemberRole(event.target.value as ProjectRole)
                      }
                      className="field rounded-2xl px-3 py-2.5 text-sm font-medium text-(--text)"
                    >
                      {PROJECT_ROLES.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="submit"
                    disabled={memberBusy || !memberUserId}
                    className="btn-gradient inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-black"
                  >
                    {memberBusy ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <UserPlus size={15} />
                    )}
                    Add
                  </button>
                </form>
              ) : null}

              {memberError ? (
                <p className="mt-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm font-bold text-red-600 dark:text-red-400">
                  {memberError}
                </p>
              ) : null}

              <ul className="mt-4 grid gap-2">
                {detail.members.length === 0 ? (
                  <li className="glass-soft rounded-2xl px-4 py-4 text-center text-sm font-bold text-(--muted)">
                    No members assigned yet.
                  </li>
                ) : (
                  detail.members.map((member) => (
                    <li
                      key={member.id}
                      className="glass-soft flex items-center justify-between gap-3 rounded-2xl px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-(--text)">
                          {member.name}
                        </p>
                        <p className="truncate text-xs font-medium text-(--muted)">
                          {member.email}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="glass inline-flex items-center rounded-full px-2.5 py-1 text-xs font-black text-(--text)">
                          {member.role}
                        </span>
                        {manageable ? (
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(member.id)}
                            disabled={memberBusy}
                            aria-label={`Remove ${member.name}`}
                            className="grid h-7 w-7 place-items-center rounded-full text-(--muted) transition hover:bg-red-500/15 hover:text-red-600 dark:hover:text-red-400"
                          >
                            <X size={15} />
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </div>
          ) : null}
        </section>
      </div>
    </DashboardChrome>
  );
}
