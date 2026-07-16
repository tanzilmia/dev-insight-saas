"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  Loader2,
  PlugZap,
  RefreshCw,
  Trash2
} from "lucide-react";

import {
  type GitHubAppInstallation,
  type GitHubAppStatus,
  disconnectGitHubApp,
  getApiErrorMessage,
  getGitHubAppInstallUrl,
  getGitHubAppStatus,
  syncGitHubAppInstallation
} from "@/lib/api";
import { canManage, useSession } from "@/lib/use-session";

/**
 * GitHub App connection card. Managers connect by installing the DevInside App on
 * their GitHub account/org; DevInside then syncs the approved repositories. No
 * secret ever reaches this component — only account/status metadata.
 */
export function GitHubAppConnection() {
  const { activeOrganization } = useSession();
  const organizationId = activeOrganization?.id;
  const manageable = canManage(activeOrganization?.role);

  const [data, setData] = useState<GitHubAppStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // .then keeps setState deferred (react-hooks/set-state-in-effect).
  const refresh = useCallback(() => {
    if (!organizationId) {
      return Promise.resolve();
    }
    return getGitHubAppStatus(organizationId)
      .then((next) => {
        setData(next);
        setError(null);
      })
      .catch((err) => setError(getApiErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [organizationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleConnect() {
    if (!organizationId) {
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const url = await getGitHubAppInstallUrl(organizationId);
      window.location.href = url; // hand off to GitHub's installation flow
    } catch (err) {
      setError(getApiErrorMessage(err));
      setConnecting(false);
    }
  }

  async function handleSync(installation: GitHubAppInstallation) {
    if (!organizationId) {
      return;
    }
    setBusyId(installation.id);
    setError(null);
    try {
      setData(await syncGitHubAppInstallation(organizationId, installation.id));
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDisconnect(installation: GitHubAppInstallation) {
    if (!organizationId) {
      return;
    }
    if (
      !window.confirm(
        `Disconnect @${installation.accountLogin}? Its repositories and all collected DevInside history will be deleted. To fully revoke GitHub access, also uninstall the app in GitHub settings.`
      )
    ) {
      return;
    }
    setBusyId(installation.id);
    setError(null);
    try {
      setData(await disconnectGitHubApp(organizationId, installation.id));
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="glass animate-rise rounded-xl p-5">
      <p className="mb-2 inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.28em] text-(--accent)">
        <GitBranch size={14} />
        GitHub App
      </p>
      <h2 className="text-xl font-bold tracking-tight text-(--text)">
        Connect with the DevInside GitHub App
      </h2>
      <p className="mt-3 text-sm leading-6 text-(--muted)">
        Install the DevInside GitHub App on your GitHub account or organization and
        approve the repositories to analyze — no Personal Access Token required.
      </p>

      <div className="hairline my-6" />

      {loading ? (
        <div className="grid place-items-center py-8 text-(--muted)">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : (
        <div className="grid gap-4">
          {error ? (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-600 dark:text-red-400">
              {error}
            </div>
          ) : null}

          {data && !data.configured ? (
            <div className="rounded-2xl border border-(--border) bg-(--surface-soft) px-4 py-3 text-sm leading-6 text-(--muted)">
              <span className="inline-flex items-center gap-2 font-bold text-(--text)">
                <AlertTriangle size={15} />
                Not available yet
              </span>
              <p className="mt-1">
                The DevInside GitHub App has not been set up on this server. Once
                the owner registers it, you can connect your GitHub account here.
              </p>
            </div>
          ) : null}

          {data?.configured && data.installations.length > 0 ? (
            <div className="grid gap-3">
              {data.installations.map((installation) => (
                <div
                  key={installation.id}
                  className="glass-soft flex flex-wrap items-center justify-between gap-3 rounded-2xl p-5"
                >
                  <div>
                    <p className="inline-flex items-center gap-2 font-black text-(--text)">
                      <CheckCircle2
                        size={15}
                        className="text-emerald-600 dark:text-emerald-400"
                      />
                      @{installation.accountLogin}
                      <span className="rounded-full bg-(--surface) px-2 py-0.5 text-[11px] font-bold text-(--muted)">
                        {installation.accountType ?? "Account"}
                      </span>
                      {installation.suspended ? (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-600 dark:text-amber-400">
                          Suspended
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-xs text-(--muted)">
                      {installation.repositoryCount} repositor
                      {installation.repositoryCount === 1 ? "y" : "ies"}
                      {installation.repositorySelection
                        ? ` · ${installation.repositorySelection}`
                        : ""}
                      {installation.lastSyncedAt
                        ? ` · synced ${new Date(installation.lastSyncedAt).toLocaleString()}`
                        : " · not synced yet"}
                    </p>
                  </div>

                  {manageable ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleSync(installation)}
                        disabled={busyId === installation.id}
                        className="glass glass-hover inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-(--text)"
                      >
                        {busyId === installation.id ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <RefreshCw size={15} />
                        )}
                        Sync
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDisconnect(installation)}
                        disabled={busyId === installation.id}
                        className="inline-flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-bold text-red-600 transition hover:bg-red-500/20 dark:text-red-400"
                      >
                        <Trash2 size={15} />
                        Disconnect
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {data?.configured && manageable ? (
            <button
              type="button"
              onClick={handleConnect}
              disabled={connecting}
              className="btn-gradient inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold"
            >
              {connecting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <PlugZap size={16} />
              )}
              {data.installations.length > 0 ? "Connect another account" : "Connect GitHub"}
            </button>
          ) : data?.configured && !manageable && data.installations.length === 0 ? (
            <p className="rounded-2xl border border-(--border) bg-(--surface-soft) px-4 py-3 text-sm font-bold text-(--muted)">
              GitHub is not connected yet. Ask an owner or manager to connect it.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
