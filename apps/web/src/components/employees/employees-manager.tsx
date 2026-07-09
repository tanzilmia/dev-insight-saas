"use client";

import { useCallback, useEffect, useState } from "react";
import { Ban, CheckCircle2, Loader2, UserPlus, Users } from "lucide-react";

import {
  type AssignableRole,
  type Employee,
  createEmployee,
  getApiErrorMessage,
  listEmployees,
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

  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

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
      await createEmployee({ organizationId, name, email, role });
      setName("");
      setEmail("");
      setRole("EMPLOYEE");
      await refresh();
    } catch (error) {
      setFormError(getApiErrorMessage(error));
    } finally {
      setSubmitting(false);
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
        <section className="glass animate-rise rounded-xl p-5">
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

        <section className="animate-rise [animation-delay:80ms]">
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

                      return (
                        <tr
                          key={employee.id}
                          className="border-b border-(--border) transition last:border-0 hover:bg-(--surface-soft)"
                        >
                          <td className="px-4 py-3">
                            <p className="font-semibold text-(--text)">{employee.name}</p>
                            <p className="text-xs text-(--muted)">{employee.email}</p>
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
