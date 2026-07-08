"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { type AuthOrganization, type AuthUser, getCurrentUser } from "@/lib/api";
import { clearStoredToken, getStoredToken } from "@/lib/auth-storage";

type SessionState = {
  user: AuthUser;
  organizations: AuthOrganization[];
};

export function DashboardShell() {
  const router = useRouter();
  const [session, setSession] = useState<SessionState | null>(null);
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

  function handleLogout() {
    clearStoredToken();
    startTransition(() => router.replace("/login"));
  }

  if (status === "loading") {
    return (
      <main className="grid min-h-screen place-items-center px-5">
        <div className="rounded-[2rem] border border-[var(--border)] bg-[var(--glass)] px-8 py-6 font-bold shadow-2xl shadow-black/10 backdrop-blur-2xl">
          Loading dashboard...
        </div>
      </main>
    );
  }

  if (!session) {
    return null;
  }

  const statCards = [
    ["Connected org", activeOrganization?.name ?? "No organization"],
    ["Role", activeOrganization?.role ?? "N/A"],
    ["Reports", "Coming next"],
    ["Git sync", "Not connected"]
  ];

  return (
    <main className="min-h-screen px-5 py-6 md:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4 rounded-[2rem] border border-[var(--border)] bg-[var(--glass)] px-5 py-4 shadow-xl shadow-black/5 backdrop-blur-2xl">
          <Link href="/" className="text-sm font-black tracking-[0.22em]">
            DEVINSIGHT
          </Link>
          <div className="flex items-center gap-3 pr-20 md:pr-24">
            <span className="hidden text-sm font-bold text-[var(--muted)] sm:block">
              {session.user.email}
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2 text-sm font-bold transition hover:bg-[var(--glass-strong)]"
            >
              Logout
            </button>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="rounded-[2.25rem] border border-[var(--border)] bg-[var(--glass)] p-7 shadow-2xl shadow-black/10 backdrop-blur-2xl md:p-10">
            <p className="mb-4 text-xs font-black uppercase tracking-[0.32em] text-[var(--accent)]">
              Dashboard
            </p>
            <h1 className="text-4xl font-black tracking-tight md:text-6xl">
              Welcome back, {session.user.name}.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--muted)]">
              Your foundation is ready. The next build step can add projects,
              employees, Git credentials, repository sync, and contributor
              mapping.
            </p>
          </div>

          <aside className="rounded-[2.25rem] border border-[var(--border)] bg-[var(--surface-soft)] p-7">
            <h2 className="text-xl font-black">Account</h2>
            <dl className="mt-6 grid gap-5 text-sm">
              <div>
                <dt className="font-bold text-[var(--muted)]">Name</dt>
                <dd className="mt-1 font-black">{session.user.name}</dd>
              </div>
              <div>
                <dt className="font-bold text-[var(--muted)]">Organization</dt>
                <dd className="mt-1 font-black">
                  {activeOrganization?.name ?? "No organization"}
                </dd>
              </div>
              <div>
                <dt className="font-bold text-[var(--muted)]">Slug</dt>
                <dd className="mt-1 font-black">
                  {activeOrganization?.slug ?? "N/A"}
                </dd>
              </div>
            </dl>
          </aside>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-4">
          {statCards.map(([label, value]) => (
            <div
              key={label}
              className="rounded-[1.75rem] border border-[var(--border)] bg-[var(--glass)] p-5 shadow-xl shadow-black/5 backdrop-blur-2xl"
            >
              <p className="text-xs font-black uppercase tracking-[0.22em] text-[var(--muted)]">
                {label}
              </p>
              <p className="mt-3 text-xl font-black">{value}</p>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}

