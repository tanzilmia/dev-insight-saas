"use client";

import Link from "next/link";
import {
  Building2,
  FileText,
  FolderKanban,
  GitBranch,
  ShieldCheck,
  Users
} from "lucide-react";

import { useSession } from "@/lib/use-session";
import {
  DashboardChrome,
  DashboardLoading
} from "@/components/dashboard/dashboard-chrome";

export function DashboardShell() {
  const { session, status, activeOrganization, logout } = useSession();

  if (status === "loading") {
    return <DashboardLoading />;
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
    <DashboardChrome email={session.user.email} onLogout={logout}>
      <section className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="glass animate-rise relative overflow-hidden rounded-xl p-7 [animation-delay:80ms] md:p-7">
          <p className="mb-4 inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.28em] text-(--accent)">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-(--accent)" />
            Dashboard
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-(--text) md:text-3xl">
            Welcome back,{" "}
            <span className="text-gradient">{session.user.name}.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-(--muted)">
            Set up your workspace: create projects and add employees, then map
            them to Git identities once repository sync is connected.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/dashboard/projects"
              className="btn-gradient inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-black"
            >
              <FolderKanban size={16} />
              Manage projects
            </Link>
            <Link
              href="/dashboard/employees"
              className="glass glass-hover inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-black text-(--text)"
            >
              <Users size={16} />
              Manage employees
            </Link>
          </div>
        </div>

        <aside className="glass-soft animate-rise rounded-xl p-7 [animation-delay:160ms]">
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
            className="glass glass-hover animate-rise rounded-xl p-5"
          >
            <span className="btn-gradient mb-4 grid h-10 w-10 place-items-center rounded-2xl">
              <card.icon size={18} />
            </span>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-(--muted)">
              {card.label}
            </p>
            <p className="mt-2 text-xl font-black text-(--text)">{card.value}</p>
          </div>
        ))}
      </section>
    </DashboardChrome>
  );
}
