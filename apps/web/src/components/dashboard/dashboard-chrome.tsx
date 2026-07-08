"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  FolderGit2,
  FolderKanban,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Users
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/projects", label: "Projects", icon: FolderKanban },
  { href: "/dashboard/employees", label: "Employees", icon: Users },
  { href: "/dashboard/repositories", label: "Repos", icon: FolderGit2 },
  { href: "/dashboard/git", label: "Git", icon: GitBranch }
];

function isActive(pathname: string, href: string) {
  return href === "/dashboard" ? pathname === href : pathname.startsWith(href);
}

export function DashboardLoading() {
  return (
    <main className="grid min-h-screen place-items-center px-5">
      <div className="glass flex items-center gap-3 rounded-4xl px-8 py-6 font-bold text-(--text)">
        <span className="pulse-dot h-2.5 w-2.5 rounded-full bg-(--accent)" />
        Loading dashboard...
      </div>
    </main>
  );
}

export function DashboardChrome({
  email,
  onLogout,
  children
}: {
  email: string;
  onLogout: () => void;
  children: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <main className="min-h-screen px-5 py-6 md:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="glass animate-rise mb-8 flex flex-wrap items-center justify-between gap-4 rounded-4xl px-5 py-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="btn-gradient grid h-8 w-8 place-items-center rounded-xl">
                <Activity size={16} strokeWidth={2.5} />
              </span>
              <span className="text-sm font-black tracking-[0.22em] text-(--text)">
                DEVINSIGHT
              </span>
            </Link>
            <nav className="flex items-center gap-1">
              {NAV_ITEMS.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-bold transition ${
                      active
                        ? "btn-gradient"
                        : "text-(--muted) hover:text-(--text)"
                    }`}
                  >
                    <item.icon size={15} />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-3 pr-14 md:pr-16">
            <span className="hidden text-sm font-bold text-(--muted) sm:block">
              {email}
            </span>
            <button
              type="button"
              onClick={onLogout}
              className="glass glass-hover inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-(--text)"
            >
              <LogOut size={15} />
              Logout
            </button>
          </div>
        </header>

        {children}
      </div>
    </main>
  );
}
