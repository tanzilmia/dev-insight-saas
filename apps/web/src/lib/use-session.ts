"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { type AuthOrganization, type AuthUser, getCurrentUser } from "./api";
import { clearStoredToken, getStoredToken } from "./auth-storage";

export type Session = {
  user: AuthUser;
  organizations: AuthOrganization[];
};

/**
 * Loads the authenticated session for dashboard pages. Redirects to /login
 * when there is no valid token. Exposes the active organization (the first
 * membership) and a logout helper.
 */
export function useSession() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [, startTransition] = useTransition();

  useEffect(() => {
    const token = getStoredToken();

    if (!token) {
      startTransition(() => router.replace("/login"));
      return;
    }

    getCurrentUser(token)
      .then((result) => {
        setSession({
          user: result.user,
          organizations: result.organizations
        });
      })
      .catch(() => {
        clearStoredToken();
        startTransition(() => router.replace("/login"));
      })
      .finally(() => setStatus("ready"));
  }, [router]);

  const activeOrganization = useMemo(
    () => session?.organizations[0],
    [session?.organizations]
  );

  function logout() {
    clearStoredToken();
    startTransition(() => router.replace("/login"));
  }

  return { session, status, activeOrganization, logout };
}

/** Roles allowed to manage projects and employees from the dashboard. */
export function canManage(role: string | undefined) {
  return role === "OWNER" || role === "MANAGER" || role === "ADMIN";
}
