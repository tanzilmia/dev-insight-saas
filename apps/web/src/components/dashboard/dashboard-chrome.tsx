"use client";

import type { ReactNode } from "react";

/**
 * The dashboard shell (sidebar + header) now lives in `app/dashboard/layout.tsx`.
 * This wrapper is kept for backwards-compatibility with page managers that still
 * wrap their content in <DashboardChrome> — it simply renders the content. The
 * `email` / `onLogout` props are accepted (so callers compile unchanged) but the
 * header handles those now.
 */
export function DashboardChrome({
  children
}: {
  email?: string;
  onLogout?: () => void;
  children: ReactNode;
}) {
  return <>{children}</>;
}

export function DashboardLoading() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="flex items-center gap-3 rounded-xl border border-(--border) bg-(--surface) px-6 py-4 text-sm font-semibold text-(--text)">
        <span className="pulse-dot h-2 w-2 rounded-full bg-(--accent)" />
        Loading…
      </div>
    </div>
  );
}
