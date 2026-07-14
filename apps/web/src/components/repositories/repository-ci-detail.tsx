"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleDot,
  ExternalLink,
  Loader2,
  PlugZap,
  RefreshCw,
  Search,
  XCircle
} from "lucide-react";

import {
  type CiInspection,
  type CiStatus,
  type CiWorkflowRun,
  disableCi,
  enableCi,
  getApiErrorMessage,
  getCiStatus,
  inspectRepositoryCi,
  listCiRuns,
  syncCi
} from "@/lib/api";
import { canManage, useSession } from "@/lib/use-session";
import {
  DashboardChrome,
  DashboardLoading
} from "@/components/dashboard/dashboard-chrome";

function statusTone(status: string) {
  if (status === "ENABLED") return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
  if (status === "PENDING") return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  return "bg-slate-500/15 text-(--muted)";
}

function RunIcon({ run }: { run: CiWorkflowRun }) {
  if (run.status !== "completed") return <CircleDot size={15} className="text-amber-500" />;
  if (run.conclusion === "success")
    return <CheckCircle2 size={15} className="text-emerald-600 dark:text-emerald-400" />;
  if (run.conclusion === "failure")
    return <XCircle size={15} className="text-red-600 dark:text-red-400" />;
  return <CircleDot size={15} className="text-(--muted)" />;
}

function duration(ms: number | null) {
  if (ms == null || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function RepositoryCiDetail({ repositoryId }: { repositoryId: string }) {
  const { session, status: sessionStatus, activeOrganization, logout } = useSession();
  const manageable = canManage(activeOrganization?.role);

  const [status, setStatus] = useState<CiStatus | null>(null);
  const [runs, setRuns] = useState<CiWorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "enable" | "disable" | "sync" | "inspect">(null);
  const [inspection, setInspection] = useState<CiInspection | null>(null);

  const refresh = useCallback(() => {
    return Promise.all([getCiStatus(repositoryId), listCiRuns(repositoryId)])
      .then(([nextStatus, nextRuns]) => {
        setStatus(nextStatus);
        setRuns(nextRuns);
        setError(null);
      })
      .catch((err) => setError(getApiErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [repositoryId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(action: "enable" | "disable" | "sync") {
    setBusy(action);
    setError(null);
    try {
      const next =
        action === "enable"
          ? await enableCi(repositoryId)
          : action === "disable"
            ? await disableCi(repositoryId)
            : await syncCi(repositoryId);
      setStatus(next);
      setRuns(await listCiRuns(repositoryId));
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleInspect() {
    setBusy("inspect");
    setError(null);
    try {
      setInspection(await inspectRepositoryCi(repositoryId));
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (sessionStatus === "loading") return <DashboardLoading />;
  if (!session) return null;

  return (
    <DashboardChrome email={session.user.email} onLogout={logout}>
      <div className="mx-auto grid max-w-3xl gap-6">
        <Link
          href="/dashboard/repositories"
          className="inline-flex items-center gap-1.5 text-sm font-bold text-(--muted) hover:text-(--text)"
        >
          <ArrowLeft size={15} /> Repositories
        </Link>

        {loading ? (
          <div className="glass grid place-items-center rounded-xl p-10 text-(--muted)">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : status ? (
          <>
            <div className="glass animate-rise rounded-xl p-5">
              <p className="mb-2 inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.28em] text-(--accent)">
                <PlugZap size={14} /> CI · GitHub Actions
              </p>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="font-mono text-lg font-black text-(--text)">{status.fullName}</h1>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black ${statusTone(status.status)}`}
                >
                  {status.status.replace("_", " ")}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-(--muted)">
                DevInside installs and manages a GitHub Actions workflow for this repository through
                a pull request — never a direct push to <code>{status.defaultBranch ?? "the default branch"}</code>.
                It runs lint / typecheck / tests / build for the scripts your repo actually has.
              </p>

              <div className="hairline my-5" />

              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="font-bold text-(--muted)">Template version</dt>
                  <dd className="mt-1 font-black text-(--text)">
                    {status.templateId ? `${status.templateId}@v${status.templateVersion}` : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="font-bold text-(--muted)">Last synchronized</dt>
                  <dd className="mt-1 font-black text-(--text)">
                    {status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString() : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="font-bold text-(--muted)">Setup pull request</dt>
                  <dd className="mt-1 font-black text-(--text)">
                    {status.pullRequest ? (
                      <a
                        href={status.pullRequest.url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-(--accent) hover:underline"
                      >
                        #{status.pullRequest.number} ({status.pullRequest.state})
                        <ExternalLink size={13} />
                      </a>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="font-bold text-(--muted)">Links</dt>
                  <dd className="mt-1 flex flex-wrap gap-3 font-black">
                    <a
                      href={status.actionsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-(--accent) hover:underline"
                    >
                      Actions <ExternalLink size={13} />
                    </a>
                    {status.workflowUrl ? (
                      <a
                        href={status.workflowUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-(--accent) hover:underline"
                      >
                        Workflow <ExternalLink size={13} />
                      </a>
                    ) : null}
                  </dd>
                </div>
              </dl>

              {error ? (
                <div className="mt-5 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-600 dark:text-red-400">
                  {error}
                </div>
              ) : null}

              {manageable ? (
                <div className="mt-5 flex flex-wrap gap-2">
                  {status.status !== "ENABLED" ? (
                    <button
                      type="button"
                      onClick={() => run("enable")}
                      disabled={busy !== null}
                      className="btn-gradient inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold"
                    >
                      {busy === "enable" ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <PlugZap size={15} />
                      )}
                      Enable CI
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => run("disable")}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm font-bold text-red-600 hover:bg-red-500/20 dark:text-red-400"
                    >
                      Disable CI
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => run("sync")}
                    disabled={busy !== null}
                    className="glass glass-hover inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold text-(--text)"
                  >
                    {busy === "sync" ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <RefreshCw size={15} />
                    )}
                    Sync
                  </button>
                  <button
                    type="button"
                    onClick={handleInspect}
                    disabled={busy !== null}
                    className="glass glass-hover inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold text-(--text)"
                  >
                    {busy === "inspect" ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Search size={15} />
                    )}
                    Inspect
                  </button>
                </div>
              ) : (
                <p className="mt-5 rounded-2xl border border-(--border) bg-(--surface-soft) px-4 py-3 text-sm font-bold text-(--muted)">
                  You have read-only access. Ask an owner or manager to manage CI.
                </p>
              )}

              {inspection ? (
                <div className="glass-soft mt-5 rounded-2xl p-4 text-sm">
                  {inspection.supported ? (
                    <>
                      <p className="font-black text-(--text)">
                        Detected: Node.js · {inspection.packageManager}
                        {inspection.isMonorepo ? " · monorepo" : ""}
                        {inspection.framework ? ` · ${inspection.framework}` : ""} · Node{" "}
                        {inspection.nodeVersion}
                      </p>
                      <p className="mt-1 text-(--muted)">
                        Scripts:{" "}
                        {(["lint", "typecheck", "test", "build"] as const)
                          .filter((s) => inspection.scripts[s])
                          .join(", ") || "none detected"}
                      </p>
                    </>
                  ) : (
                    <p className="inline-flex items-center gap-2 font-bold text-amber-600 dark:text-amber-400">
                      <AlertTriangle size={15} /> {inspection.reason}
                    </p>
                  )}
                </div>
              ) : null}
            </div>

            <div className="glass animate-rise rounded-xl p-5">
              <h2 className="text-sm font-black uppercase tracking-wide text-(--muted)">
                Workflow runs
              </h2>
              {runs.length === 0 ? (
                <p className="mt-3 text-sm text-(--muted)">
                  No runs synced yet. Enable CI and merge the setup PR, then Sync.
                </p>
              ) : (
                <div className="mt-3 grid gap-2">
                  {runs.map((r) => (
                    <a
                      key={r.runId}
                      href={r.url ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="glass-soft glass-hover flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-2.5 text-sm"
                    >
                      <span className="inline-flex items-center gap-2 font-bold text-(--text)">
                        <RunIcon run={r} />
                        {r.name ?? "CI"} · {r.branch ?? "?"}
                      </span>
                      <span className="text-xs text-(--muted)">
                        {r.event} · {r.conclusion ?? r.status} · {duration(r.durationMs)} ·{" "}
                        {r.startedAt ? new Date(r.startedAt).toLocaleString() : "—"}
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="glass rounded-xl p-5 text-sm font-bold text-red-600 dark:text-red-400">
            {error ?? "Could not load CI status."}
          </div>
        )}
      </div>
    </DashboardChrome>
  );
}
