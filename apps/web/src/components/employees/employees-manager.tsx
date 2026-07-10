"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Ban,
  CheckCircle2,
  GitBranch,
  Loader2,
  Plus,
  Search,
  UserPlus,
  Users,
  X
} from "lucide-react";

import {
  type AssignableRole,
  type Employee,
  type GitUserProfile,
  addEmployeeGitAlias,
  createEmployee,
  getApiErrorMessage,
  listEmployees,
  removeEmployeeGitAlias,
  resolveGitUser,
  updateEmployee
} from "@/lib/api";
import { canManage, useSession } from "@/lib/use-session";
import {
  DashboardChrome,
  DashboardLoading
} from "@/components/dashboard/dashboard-chrome";

const ROLE_OPTIONS: AssignableRole[] = ["EMPLOYEE", "MANAGER", "ADMIN"];

const fieldClass =
  "field w-full rounded-lg px-3.5 py-2.5 text-sm font-medium text-(--text) placeholder:font-normal";

const roleBadgeClass =
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide";

function statusTone(status: Employee["status"]) {
  if (status === "ACTIVE") {
    return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
  }
  if (status === "DISABLED") {
    return "bg-red-500/15 text-red-600 dark:text-red-400";
  }
  return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
}

export function EmployeesManager() {
  const { session, status, activeOrganization, logout } = useSession();
  const organizationId = activeOrganization?.id;
  const manageable = canManage(activeOrganization?.role);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AssignableRole>("EMPLOYEE");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // GitHub identity lookup for the create form.
  const [lookupInput, setLookupInput] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupResult, setLookupResult] = useState<GitUserProfile | null>(null);
  const [lookupMiss, setLookupMiss] = useState(false);
  const [pickedIdentities, setPickedIdentities] = useState<GitUserProfile[]>([]);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  // Per-row draft text for the inline "add git identity" input.
  const [aliasDraft, setAliasDraft] = useState<Record<string, string>>({});
  const [aliasBusyId, setAliasBusyId] = useState<string | null>(null);
  // Which row currently has its "add identity" input open.
  const [openAliasFor, setOpenAliasFor] = useState<string | null>(null);

  // Uses .then callbacks (not async/await) so setState stays deferred and this
  // is safe to call directly from an effect (react-hooks/set-state-in-effect).
  const refresh = useCallback(() => {
    if (!organizationId) {
      return Promise.resolve();
    }

    return listEmployees(organizationId)
      .then((data) => {
        setEmployees(data);
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

  async function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!organizationId) {
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      await createEmployee({
        organizationId,
        name,
        email,
        role,
        gitUsernames: pickedIdentities.map((identity) => identity.login)
      });
      setName("");
      setEmail("");
      setRole("EMPLOYEE");
      resetLookup();
      setPickedIdentities([]);
      await refresh();
    } catch (error) {
      setFormError(getApiErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  function resetLookup() {
    setLookupInput("");
    setLookupResult(null);
    setLookupMiss(false);
  }

  async function handleLookup() {
    const username = lookupInput.trim().replace(/^@+/, "");
    if (!organizationId || !username) {
      return;
    }

    setLookupBusy(true);
    setLookupResult(null);
    setLookupMiss(false);

    try {
      const user = await resolveGitUser(organizationId, username);
      if (user) {
        setLookupResult(user);
      } else {
        setLookupMiss(true);
      }
    } catch (error) {
      setFormError(getApiErrorMessage(error));
    } finally {
      setLookupBusy(false);
    }
  }

  function addPickedIdentity(user: GitUserProfile) {
    setPickedIdentities((current) =>
      current.some((identity) => identity.login.toLowerCase() === user.login.toLowerCase())
        ? current
        : [...current, user]
    );
    resetLookup();
  }

  function removePickedIdentity(login: string) {
    setPickedIdentities((current) =>
      current.filter((identity) => identity.login !== login)
    );
  }

  async function handleAddAlias(employee: Employee) {
    if (!organizationId) {
      return;
    }

    const username = (aliasDraft[employee.id] ?? "").trim().replace(/^@+/, "");
    if (!username) {
      return;
    }

    setAliasBusyId(employee.id);
    setRowError(null);

    try {
      // Validate the handle against GitHub first so a typo can't be saved.
      const user = await resolveGitUser(organizationId, username);
      if (!user) {
        setRowError(`No GitHub user "${username}" — check the spelling.`);
        return;
      }
      await addEmployeeGitAlias(employee.id, { organizationId, username: user.login });
      setAliasDraft((current) => ({ ...current, [employee.id]: "" }));
      setOpenAliasFor(null);
      await refresh();
    } catch (error) {
      setRowError(getApiErrorMessage(error));
    } finally {
      setAliasBusyId(null);
    }
  }

  async function handleRemoveAlias(employee: Employee, aliasId: string) {
    if (!organizationId) {
      return;
    }

    setAliasBusyId(employee.id);
    setRowError(null);

    try {
      await removeEmployeeGitAlias(employee.id, aliasId, organizationId);
      await refresh();
    } catch (error) {
      setRowError(getApiErrorMessage(error));
    } finally {
      setAliasBusyId(null);
    }
  }

  async function handleRoleChange(employee: Employee, nextRole: AssignableRole) {
    if (!organizationId) {
      return;
    }

    setBusyId(employee.id);
    setRowError(null);

    try {
      await updateEmployee(employee.id, { organizationId, role: nextRole });
      await refresh();
    } catch (error) {
      setRowError(getApiErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  async function handleStatusToggle(employee: Employee) {
    if (!organizationId) {
      return;
    }

    setBusyId(employee.id);
    setRowError(null);

    try {
      await updateEmployee(employee.id, {
        organizationId,
        status: employee.status === "ACTIVE" ? "DISABLED" : "ACTIVE"
      });
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

  return (
    <DashboardChrome email={session.user.email} onLogout={logout}>
      <div className="grid gap-6 lg:grid-cols-[340px_1fr] lg:items-start">
        <section className="glass animate-rise min-w-0 rounded-xl p-5">
          <p className="mb-1.5 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-(--accent)">
            <Users size={14} />
            Employees
          </p>
          <h1 className="text-xl font-bold tracking-tight text-(--text)">Team members</h1>
          <p className="mt-1.5 text-sm leading-6 text-(--muted)">
            Add the people in {activeOrganization?.name ?? "your organization"}. They can be
            assigned to projects and mapped to their Git identities.
          </p>

          {manageable ? (
            <form onSubmit={handleAdd} className="mt-5 grid gap-3.5">
              <label className="grid gap-1.5 text-sm font-semibold text-(--text)">
                Name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  minLength={2}
                  className={fieldClass}
                  placeholder="Rahim Uddin"
                />
              </label>
              <label className="grid gap-1.5 text-sm font-semibold text-(--text)">
                Email
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  required
                  className={fieldClass}
                  placeholder="rahim@example.com"
                />
              </label>
              <label className="grid gap-1.5 text-sm font-semibold text-(--text)">
                Role
                <select
                  value={role}
                  onChange={(event) => setRole(event.target.value as AssignableRole)}
                  className={fieldClass}
                >
                  {ROLE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-2 text-sm font-semibold text-(--text)">
                <span className="inline-flex items-center gap-1.5">
                  <GitBranch size={14} />
                  GitHub identities
                </span>

                {pickedIdentities.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {pickedIdentities.map((identity) => (
                      <span
                        key={identity.login}
                        className="inline-flex items-center gap-1.5 rounded-full bg-(--surface-soft) py-1 pr-2 pl-1 text-xs font-semibold text-(--text)"
                      >
                        {identity.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={identity.avatarUrl}
                            alt=""
                            className="h-5 w-5 rounded-full"
                          />
                        ) : null}
                        {identity.name ?? identity.login}
                        <span className="text-(--muted)">@{identity.login}</span>
                        <button
                          type="button"
                          onClick={() => removePickedIdentity(identity.login)}
                          className="text-(--muted) transition hover:text-red-500"
                          aria-label={`Remove ${identity.login}`}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="flex gap-2">
                  <input
                    value={lookupInput}
                    onChange={(event) => {
                      setLookupInput(event.target.value);
                      setLookupMiss(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleLookup();
                      }
                    }}
                    className={`${fieldClass} min-w-0`}
                    placeholder="GitHub username"
                  />
                  <button
                    type="button"
                    onClick={handleLookup}
                    disabled={lookupBusy || !lookupInput.trim()}
                    className="inline-flex shrink-0 items-center rounded-lg border border-(--border) px-3 text-sm font-bold text-(--text) transition hover:bg-(--surface-soft) disabled:opacity-50"
                    aria-label="Look up GitHub user"
                  >
                    {lookupBusy ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Search size={15} />
                    )}
                  </button>
                </div>

                {lookupResult ? (
                  <div className="flex items-center gap-3 rounded-lg border border-(--border) bg-(--surface-soft) p-3">
                    {lookupResult.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={lookupResult.avatarUrl}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-full"
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-(--text)">
                        {lookupResult.name ?? lookupResult.login}
                      </p>
                      <p className="truncate text-xs font-normal text-(--muted)">
                        @{lookupResult.login}
                        {lookupResult.company ? ` · ${lookupResult.company}` : ""}
                        {lookupResult.location ? ` · ${lookupResult.location}` : ""}
                      </p>
                      {lookupResult.type === "Organization" ? (
                        <p className="mt-0.5 text-[11px] font-bold text-amber-600 dark:text-amber-400">
                          This is an organization, not a person.
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => addPickedIdentity(lookupResult)}
                      className="btn-gradient inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-black"
                    >
                      <Plus size={13} /> Add
                    </button>
                  </div>
                ) : lookupMiss ? (
                  <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-600 dark:text-red-400">
                    No GitHub user “{lookupInput.trim().replace(/^@+/, "")}” — check the
                    spelling.
                  </p>
                ) : (
                  <span className="text-xs font-normal text-(--muted)">
                    Look up each GitHub handle and confirm. Their commits map to this person
                    automatically in every repo.
                  </span>
                )}
              </div>

              {formError ? (
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm font-medium text-red-600 dark:text-red-400">
                  {formError}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={submitting}
                className="btn-gradient inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold"
              >
                {submitting ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <UserPlus size={16} />
                )}
                {submitting ? "Adding..." : "Add employee"}
              </button>
            </form>
          ) : (
            <p className="mt-5 rounded-lg border border-(--border) bg-(--surface-soft) px-3.5 py-2.5 text-sm font-medium text-(--muted)">
              You have read-only access. Ask an owner or manager to add employees.
            </p>
          )}
        </section>

        <section className="animate-rise min-w-0 [animation-delay:80ms]">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-(--text)">
              {employees.length} member{employees.length === 1 ? "" : "s"}
            </h2>
          </div>

          {rowError ? (
            <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm font-medium text-red-600 dark:text-red-400">
              {rowError}
            </p>
          ) : null}

          {loading ? (
            <div className="glass grid place-items-center rounded-xl p-10 text-sm font-medium text-(--muted)">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : loadError ? (
            <div className="glass rounded-xl p-6 text-sm font-medium text-red-600 dark:text-red-400">
              {loadError}
            </div>
          ) : employees.length === 0 ? (
            <div className="glass rounded-xl p-8 text-center text-sm font-medium text-(--muted)">
              No employees yet.
            </div>
          ) : (
            <div className="glass overflow-hidden rounded-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-(--border) text-left text-[11px] uppercase tracking-wide text-(--muted)">
                      <th className="px-4 py-2.5 font-semibold">Member</th>
                      <th className="px-4 py-2.5 font-semibold">Status</th>
                      <th className="px-4 py-2.5 font-semibold">Role</th>
                      {manageable ? (
                        <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((employee) => {
                      const isOwner = employee.role === "OWNER";
                      const busy = busyId === employee.id;
                      const aliasBusy = aliasBusyId === employee.id;

                      return (
                        <tr
                          key={employee.id}
                          className="border-b border-(--border) transition last:border-0 hover:bg-(--surface-soft)"
                        >
                          <td className="px-4 py-3">
                            <p className="font-semibold text-(--text)">{employee.name}</p>
                            <p className="text-xs text-(--muted)">{employee.email}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              {employee.gitAliases.map((alias) => (
                                <span
                                  key={alias.id}
                                  className="inline-flex items-center gap-1 rounded-md bg-(--surface-soft) px-2 py-0.5 text-[11px] font-semibold text-(--text)"
                                  title={alias.isPrimary ? "Primary Git identity" : "Git identity"}
                                >
                                  <GitBranch size={11} className="text-(--muted)" />
                                  {alias.username}
                                  {alias.isPrimary ? (
                                    <span className="text-[9px] font-bold uppercase tracking-wide text-(--accent)">
                                      primary
                                    </span>
                                  ) : null}
                                  {manageable ? (
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveAlias(employee, alias.id)}
                                      disabled={aliasBusy}
                                      className="text-(--muted) transition hover:text-red-500"
                                      aria-label={`Remove ${alias.username}`}
                                    >
                                      <X size={11} />
                                    </button>
                                  ) : null}
                                </span>
                              ))}
                              {employee.gitAliases.length === 0 && !manageable ? (
                                <span className="text-[11px] text-(--muted)">
                                  No Git identity
                                </span>
                              ) : null}
                              {manageable && openAliasFor === employee.id ? (
                                <span className="inline-flex items-center gap-1">
                                  <input
                                    value={aliasDraft[employee.id] ?? ""}
                                    onChange={(event) =>
                                      setAliasDraft((current) => ({
                                        ...current,
                                        [employee.id]: event.target.value
                                      }))
                                    }
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        void handleAddAlias(employee);
                                      }
                                    }}
                                    disabled={aliasBusy}
                                    autoFocus
                                    placeholder="GitHub username"
                                    className="field w-32 rounded-md px-2 py-0.5 text-[11px] font-medium text-(--text)"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleAddAlias(employee)}
                                    disabled={aliasBusy}
                                    className="inline-flex items-center rounded-md border border-(--border) p-1 text-(--text) transition hover:bg-(--surface)"
                                    aria-label="Confirm Git identity"
                                  >
                                    {aliasBusy ? (
                                      <Loader2 size={11} className="animate-spin" />
                                    ) : (
                                      <CheckCircle2 size={11} />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setOpenAliasFor(null)}
                                    disabled={aliasBusy}
                                    className="inline-flex items-center rounded-md p-1 text-(--muted) transition hover:text-(--text)"
                                    aria-label="Cancel"
                                  >
                                    <X size={11} />
                                  </button>
                                </span>
                              ) : manageable ? (
                                <button
                                  type="button"
                                  onClick={() => setOpenAliasFor(employee.id)}
                                  className="inline-flex items-center gap-1 rounded-md border border-dashed border-(--border) px-2 py-0.5 text-[11px] font-semibold text-(--muted) transition hover:text-(--text)"
                                >
                                  <Plus size={11} />
                                  {employee.gitAliases.length === 0 ? "Git identity" : "Add"}
                                </button>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`${roleBadgeClass} ${statusTone(employee.status)}`}>
                              {employee.status}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {manageable && !isOwner ? (
                              <select
                                value={employee.role}
                                disabled={busy}
                                onChange={(event) =>
                                  handleRoleChange(
                                    employee,
                                    event.target.value as AssignableRole
                                  )
                                }
                                className="field rounded-md px-2.5 py-1.5 text-xs font-semibold text-(--text)"
                              >
                                {ROLE_OPTIONS.map((option) => (
                                  <option key={option} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-xs font-bold text-(--text)">
                                {employee.role}
                              </span>
                            )}
                          </td>
                          {manageable ? (
                            <td className="px-4 py-3 text-right">
                              {!isOwner ? (
                                <button
                                  type="button"
                                  onClick={() => handleStatusToggle(employee)}
                                  disabled={busy}
                                  className="inline-flex items-center gap-1.5 rounded-md border border-(--border) px-3 py-1.5 text-xs font-semibold text-(--text) transition hover:bg-(--surface)"
                                >
                                  {busy ? (
                                    <Loader2 size={13} className="animate-spin" />
                                  ) : employee.status === "ACTIVE" ? (
                                    <Ban size={13} />
                                  ) : (
                                    <CheckCircle2 size={13} />
                                  )}
                                  {employee.status === "ACTIVE" ? "Disable" : "Enable"}
                                </button>
                              ) : (
                                <span className="text-xs text-(--muted)">—</span>
                              )}
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
