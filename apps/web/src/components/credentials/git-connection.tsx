"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FolderGit2,
  GitBranch,
  KeyRound,
  Loader2,
  PlugZap,
  RefreshCw,
  Trash2,
  Unplug
} from "lucide-react";

import {
  type GitCredential,
  connectCredential,
  deleteCredential,
  getApiErrorMessage,
  listCredentials,
  reconnectCredential,
  updateCredentialRepoAccess,
  validateCredential
} from "@/lib/api";
import { canManage, useSession } from "@/lib/use-session";
import {
  DashboardChrome,
  DashboardLoading
} from "@/components/dashboard/dashboard-chrome";
import { GitHubAppConnection } from "./github-app-connection";

const fieldClass =
  "field w-full rounded-lg px-3.5 py-2.5 font-mono text-sm text-(--text) placeholder:font-sans placeholder:font-normal";

const AFFILIATION_OPTIONS = [
  {
    value: "owner",
    label: "Own repositories",
    hint: "Repositories the connected account owns"
  },
  {
    value: "collaborator",
    label: "Repositories shared with you",
    hint: "Where the account was added as a collaborator"
  },
  {
    value: "organization_member",
    label: "Organization repositories",
    hint: "From GitHub organizations the account belongs to"
  }
] as const;

function statusTone(status: GitCredential["status"]) {
  if (status === "CONNECTED") {
    return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
  }
  if (status === "INVALID") {
    return "bg-red-500/15 text-red-600 dark:text-red-400";
  }
  return "bg-slate-500/15 text-(--muted)";
}

function StatusIcon({ status }: { status: GitCredential["status"] }) {
  if (status === "CONNECTED") {
    return <CheckCircle2 size={15} />;
  }
  if (status === "INVALID") {
    return <AlertTriangle size={15} />;
  }
  return <Unplug size={15} />;
}

export function GitConnection() {
  const { session, status, activeOrganization, logout } = useSession();
  const organizationId = activeOrganization?.id;
  const manageable = canManage(activeOrganization?.role);

  const [credential, setCredential] = useState<GitCredential | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectToken, setReconnectToken] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [affiliations, setAffiliations] = useState<Set<string>>(new Set());
  const [savingAccess, setSavingAccess] = useState(false);
  const [accessNotice, setAccessNotice] = useState<string | null>(null);

  // .then callbacks keep setState deferred (react-hooks/set-state-in-effect).
  const refresh = useCallback(() => {
    if (!organizationId) {
      return Promise.resolve();
    }

    return listCredentials(organizationId)
      .then((credentials) => {
        const found = credentials.find((item) => item.provider === "GITHUB") ?? null;
        setCredential(found);
        setAffiliations(new Set(found?.repoAffiliations ?? []));
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

  async function handleConnect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!organizationId) {
      return;
    }

    setConnecting(true);
    setConnectError(null);

    try {
      await connectCredential({ organizationId, token });
      setToken("");
      await refresh();
    } catch (error) {
      setConnectError(getApiErrorMessage(error));
    } finally {
      setConnecting(false);
    }
  }

  async function handleValidate() {
    if (!credential) {
      return;
    }

    setActionBusy(true);
    setActionError(null);

    try {
      await validateCredential(credential.id);
      await refresh();
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    } finally {
      setActionBusy(false);
    }
  }

  async function handleReconnect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!credential) {
      return;
    }

    setActionBusy(true);
    setActionError(null);

    try {
      await reconnectCredential(credential.id, reconnectToken);
      setReconnectToken("");
      setReconnecting(false);
      await refresh();
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    } finally {
      setActionBusy(false);
    }
  }

  function toggleAffiliation(value: string) {
    setAccessNotice(null);
    setAffiliations((current) => {
      const next = new Set(current);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  }

  async function handleSaveAccess() {
    if (!credential || affiliations.size === 0) {
      return;
    }

    setSavingAccess(true);
    setActionError(null);
    setAccessNotice(null);

    try {
      await updateCredentialRepoAccess(credential.id, [...affiliations]);
      setAccessNotice("Repository access updated.");
      await refresh();
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    } finally {
      setSavingAccess(false);
    }
  }

  async function handleDisconnect() {
    if (!credential) {
      return;
    }
    if (
      !window.confirm(
        "Disconnect this GitHub connection? Repositories that rely on it will stop syncing until you reconnect."
      )
    ) {
      return;
    }

    setActionBusy(true);
    setActionError(null);

    try {
      await deleteCredential(credential.id);
      await refresh();
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    } finally {
      setActionBusy(false);
    }
  }

  if (status === "loading") {
    return <DashboardLoading />;
  }

  if (!session) {
    return null;
  }

  const savedAffiliations = credential?.repoAffiliations ?? [];
  const accessDirty =
    affiliations.size !== savedAffiliations.length ||
    savedAffiliations.some((value) => !affiliations.has(value));

  return (
    <DashboardChrome email={session.user.email} onLogout={logout}>
      <div className="mx-auto grid max-w-2xl gap-6">
        <GitHubAppConnection />
        <div className="glass animate-rise rounded-xl p-5">
          <p className="mb-2 inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.28em] text-(--accent)">
            <GitBranch size={14} />
            Git connection
          </p>
          <h1 className="text-xl font-bold tracking-tight text-(--text)">
            GitHub access
          </h1>
          <p className="mt-3 text-sm leading-6 text-(--muted)">
            Connect a GitHub Personal Access Token so DevInsight can read
            repositories and activity. The token is validated with GitHub,
            encrypted at rest, and never shown again.
          </p>

          <div className="hairline my-6" />

          {loading ? (
            <div className="grid place-items-center py-8 text-(--muted)">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : loadError ? (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-600 dark:text-red-400">
              {loadError}
            </div>
          ) : credential ? (
            <div className="grid gap-5">
              <div className="glass-soft flex flex-wrap items-center justify-between gap-3 rounded-2xl p-5">
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-(--muted)">
                    GitHub
                    {credential.accountLogin ? ` · @${credential.accountLogin}` : ""}
                  </p>
                  <p className="mt-1 font-mono text-lg font-black text-(--text)">
                    •••• {credential.tokenLast4 ?? "????"}
                  </p>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black ${statusTone(credential.status)}`}
                >
                  <StatusIcon status={credential.status} />
                  {credential.status}
                </span>
              </div>

              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="font-bold text-(--muted)">Scopes</dt>
                  <dd className="mt-1 font-black text-(--text)">
                    {credential.scopes.length ? credential.scopes.join(", ") : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="font-bold text-(--muted)">Last validated</dt>
                  <dd className="mt-1 font-black text-(--text)">
                    {credential.lastValidatedAt
                      ? new Date(credential.lastValidatedAt).toLocaleString()
                      : "—"}
                  </dd>
                </div>
              </dl>

              {manageable ? (
                <div className="glass-soft rounded-2xl p-5">
                  <p className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-wide text-(--muted)">
                    <FolderGit2 size={14} />
                    Repository access
                  </p>
                  <p className="mt-1.5 text-xs leading-5 text-(--muted)">
                    Choose which repositories appear in “Sync from GitHub” on the
                    Repositories page. Narrowing this never untracks repositories
                    you already track.
                  </p>

                  <div className="mt-4 grid gap-2.5">
                    {AFFILIATION_OPTIONS.map((option) => (
                      <label
                        key={option.value}
                        className="flex cursor-pointer items-start gap-3 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={affiliations.has(option.value)}
                          onChange={() => toggleAffiliation(option.value)}
                          disabled={savingAccess}
                          className="mt-0.5 h-4 w-4 accent-(--accent)"
                        />
                        <span>
                          <span className="block font-bold text-(--text)">
                            {option.label}
                          </span>
                          <span className="block text-xs text-(--muted)">
                            {option.hint}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={handleSaveAccess}
                      disabled={savingAccess || !accessDirty || affiliations.size === 0}
                      className="btn-gradient inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold"
                    >
                      {savingAccess ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <CheckCircle2 size={14} />
                      )}
                      Save access
                    </button>
                    {affiliations.size === 0 ? (
                      <span className="text-xs font-bold text-amber-600 dark:text-amber-400">
                        Select at least one option.
                      </span>
                    ) : accessNotice ? (
                      <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                        {accessNotice}
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-3 text-[11px] leading-4 text-(--muted)">
                    Note: a fine-grained token only returns repositories it was
                    granted, and organization repositories may require the
                    organization to authorize the token (SSO).
                  </p>
                </div>
              ) : null}

              {actionError ? (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-600 dark:text-red-400">
                  {actionError}
                </div>
              ) : null}

              {manageable ? (
                <>
                  {reconnecting ? (
                    <form onSubmit={handleReconnect} className="grid gap-3">
                      <label className="grid gap-2 text-sm font-bold text-(--text)">
                        New token
                        <input
                          value={reconnectToken}
                          onChange={(event) => setReconnectToken(event.target.value)}
                          type="password"
                          autoComplete="off"
                          required
                          minLength={20}
                          className={fieldClass}
                          placeholder="ghp_… or github_pat_…"
                        />
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="submit"
                          disabled={actionBusy}
                          className="btn-gradient inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-black"
                        >
                          {actionBusy ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : (
                            <KeyRound size={15} />
                          )}
                          Save token
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setReconnecting(false);
                            setReconnectToken("");
                          }}
                          className="glass glass-hover rounded-2xl px-4 py-2.5 text-sm font-bold text-(--text)"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handleValidate}
                        disabled={actionBusy}
                        className="glass glass-hover inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-(--text)"
                      >
                        <RefreshCw size={15} />
                        Re-validate
                      </button>
                      <button
                        type="button"
                        onClick={() => setReconnecting(true)}
                        disabled={actionBusy}
                        className="glass glass-hover inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-(--text)"
                      >
                        <KeyRound size={15} />
                        Reconnect
                      </button>
                      <button
                        type="button"
                        onClick={handleDisconnect}
                        disabled={actionBusy}
                        className="inline-flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-bold text-red-600 transition hover:bg-red-500/20 dark:text-red-400"
                      >
                        <Trash2 size={15} />
                        Disconnect
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <p className="rounded-2xl border border-(--border) bg-(--surface-soft) px-4 py-3 text-sm font-bold text-(--muted)">
                  You have read-only access. Ask an owner or manager to manage the
                  Git connection.
                </p>
              )}
            </div>
          ) : manageable ? (
            <form onSubmit={handleConnect} className="grid gap-4">
              <label className="grid gap-2 text-sm font-bold text-(--text)">
                GitHub Personal Access Token
                <input
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  type="password"
                  autoComplete="off"
                  required
                  minLength={20}
                  className={fieldClass}
                  placeholder="ghp_… or github_pat_…"
                />
              </label>

              {connectError ? (
                <p className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-600 dark:text-red-400">
                  {connectError}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={connecting}
                className="btn-gradient inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold"
              >
                {connecting ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <PlugZap size={16} />
                )}
                {connecting ? "Validating with GitHub..." : "Connect GitHub"}
              </button>
            </form>
          ) : (
            <p className="rounded-2xl border border-(--border) bg-(--surface-soft) px-4 py-3 text-sm font-bold text-(--muted)">
              GitHub is not connected yet. Ask an owner or manager to connect it.
            </p>
          )}
        </div>
      </div>
    </DashboardChrome>
  );
}
