"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

import { getApiErrorMessage, linkGitHubAppInstallation } from "@/lib/api";
import { canManage, useSession } from "@/lib/use-session";
import {
  DashboardChrome,
  DashboardLoading
} from "@/components/dashboard/dashboard-chrome";

/**
 * GitHub App post-install redirect target (the App's Setup URL). GitHub sends
 * `installation_id` + `setup_action`; this page (which carries the user's JWT)
 * links that installation to the active DevInside organization, then returns to
 * the Git settings page. All setState is deferred (react-hooks/set-state-in-effect).
 */
export default function GitHubAppCallbackPage() {
  const router = useRouter();
  const { session, status, activeOrganization, logout } = useSession();
  const [phase, setPhase] = useState<"working" | "done" | "error">("working");
  const [message, setMessage] = useState("Finishing your GitHub connection…");
  const startedRef = useRef(false);

  useEffect(() => {
    if (status !== "ready" || startedRef.current) {
      return;
    }
    startedRef.current = true;

    const organizationId = activeOrganization?.id;
    const params = new URLSearchParams(window.location.search);
    const installationId = params.get("installation_id");
    const setupAction = params.get("setup_action") ?? undefined;

    if (!organizationId || !installationId || !canManage(activeOrganization?.role)) {
      const reason = !organizationId
        ? "No active organization was found."
        : !installationId
          ? "GitHub did not return an installation id."
          : "Only an owner or manager can connect GitHub.";
      Promise.resolve().then(() => {
        setPhase("error");
        setMessage(reason);
      });
      return;
    }

    linkGitHubAppInstallation({ organizationId, installationId, setupAction })
      .then(() => {
        setPhase("done");
        setMessage("GitHub connected. Redirecting to settings…");
        setTimeout(() => router.replace("/dashboard/git"), 1200);
      })
      .catch((error) => {
        setPhase("error");
        setMessage(getApiErrorMessage(error));
      });
  }, [status, activeOrganization, router]);

  if (status === "loading") {
    return <DashboardLoading />;
  }
  if (!session) {
    return null;
  }

  return (
    <DashboardChrome email={session.user.email} onLogout={logout}>
      <div className="mx-auto max-w-md">
        <div className="glass animate-rise grid gap-4 rounded-xl p-6 text-center">
          {phase === "working" ? (
            <Loader2 size={28} className="mx-auto animate-spin text-(--accent)" />
          ) : phase === "done" ? (
            <CheckCircle2 size={28} className="mx-auto text-emerald-600 dark:text-emerald-400" />
          ) : (
            <AlertTriangle size={28} className="mx-auto text-red-600 dark:text-red-400" />
          )}
          <h1 className="text-lg font-bold text-(--text)">GitHub App connection</h1>
          <p className="text-sm leading-6 text-(--muted)">{message}</p>
          {phase === "error" ? (
            <Link
              href="/dashboard/git"
              className="btn-gradient inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold"
            >
              Back to Git settings
            </Link>
          ) : null}
        </div>
      </div>
    </DashboardChrome>
  );
}
