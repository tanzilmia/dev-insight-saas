"use client";

import { DashboardChrome, DashboardLoading } from "@/components/dashboard/dashboard-chrome";
import { useSession } from "@/lib/use-session";

import { GitHubAppConnection } from "./github-app-connection";

/** GitHub App-only settings page; customer PATs are intentionally unsupported. */
export function GitConnection() {
  const { session, status, logout } = useSession();

  if (status === "loading") {
    return <DashboardLoading />;
  }
  if (!session) {
    return null;
  }

  return (
    <DashboardChrome email={session.user.email} onLogout={logout}>
      <div className="mx-auto grid max-w-2xl gap-6">
        <GitHubAppConnection />
      </div>
    </DashboardChrome>
  );
}
