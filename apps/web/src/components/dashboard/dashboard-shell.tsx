"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  Building2,
  FileText,
  GitBranch,
  LogOut,
  ShieldCheck
} from "lucide-react";

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
        <div className="glass flex items-center gap-3 rounded-4xl px-8 py-6 font-bold text-(--text)">
          <span className="pulse-dot h-2.5 w-2.5 rounded-full bg-(--accent)" />
          Loading dashboard...
        </div>
      </main>
    );
  }

  if (!session) {
    return null;
  }

  const statCards = [
    {
      icon: Building2,
      label: "Connected org",
      value: activeOrganization?.name ?? "No organization"
    },
    {
      icon: ShieldCheck,
      label: "Role",
      value: activeOrganization?.role ?? "N/A"
    },
    { icon: FileText, label: "Reports", value: "Coming next" },
    { icon: GitBranch, label: "Git sync", value: "Not connected" }
  ];

  return (
    <main className="min-h-screen px-5 py-6 md:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="glass animate-rise mb-8 flex flex-wrap items-center justify-between gap-4 rounded-4xl px-5 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="btn-gradient grid h-8 w-8 place-items-center rounded-xl">
              <Activity size={16} strokeWidth={2.5} />
            </span>
            <span className="text-sm font-black tracking-[0.22em] text-(--text)">
              DEVINSIGHT
            </span>
          </Link>
          <div className="flex items-center gap-3 pr-14 md:pr-16">
            <span className="hidden text-sm font-bold text-(--muted) sm:block">
              {session.user.email}
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="glass glass-hover inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-(--text)"
            >
              <LogOut size={15} />
              Logout
            </button>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="glass animate-rise relative overflow-hidden rounded-[2.25rem] p-7 [animation-delay:80ms] md:p-10">
            <p className="mb-4 inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.28em] text-(--accent)">
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-(--accent)" />
              Dashboard
            </p>
            <h1 className="text-4xl font-black tracking-tight text-(--text) md:text-6xl">
              Welcome back,{" "}
              <span className="text-gradient">{session.user.name}.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-(--muted)">
              Your foundation is ready. The next build step can add projects,
              employees, Git credentials, repository sync, and contributor
              mapping.
            </p>
          </div>

          <aside className="glass-soft animate-rise rounded-[2.25rem] p-7 [animation-delay:160ms]">
            <h2 className="flex items-center gap-2 text-xl font-black text-(--text)">
              <Building2 size={18} className="text-(--accent)" />
              Account
            </h2>
            <div className="hairline my-5" />
            <dl className="grid gap-5 text-sm">
              <div>
                <dt className="font-bold text-(--muted)">Name</dt>
                <dd className="mt-1 font-black text-(--text)">
                  {session.user.name}
                </dd>
              </div>
              <div>
                <dt className="font-bold text-(--muted)">Organization</dt>
                <dd className="mt-1 font-black text-(--text)">
                  {activeOrganization?.name ?? "No organization"}
                </dd>
              </div>
              <div>
                <dt className="font-bold text-(--muted)">Slug</dt>
                <dd className="mt-1 font-black text-(--text)">
                  {activeOrganization?.slug ?? "N/A"}
                </dd>
              </div>
            </dl>
          </aside>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-4">
          {statCards.map((card) => (
            <div
              key={card.label}
              className="glass glass-hover animate-rise rounded-[1.75rem] p-5"
            >
              <span className="btn-gradient mb-4 grid h-10 w-10 place-items-center rounded-2xl">
                <card.icon size={18} />
              </span>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-(--muted)">
                {card.label}
              </p>
              <p className="mt-2 text-xl font-black text-(--text)">
                {card.value}
              </p>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
