"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  FileText,
  FolderGit2,
  FolderKanban,
  GitBranch,
  LayoutDashboard,
  LogOut,
  UserCheck,
  Users,
  X
} from "lucide-react";

import { useSession } from "@/lib/use-session";

export const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/projects", label: "Projects", icon: FolderKanban },
  { href: "/dashboard/employees", label: "Employees", icon: Users },
  { href: "/dashboard/repositories", label: "Repositories", icon: FolderGit2 },
  { href: "/dashboard/contributors", label: "Contributors", icon: UserCheck },
  { href: "/dashboard/reports", label: "Reports", icon: FileText },
  { href: "/dashboard/git", label: "Git", icon: GitBranch }
];

function isActive(pathname: string, href: string) {
  return href === "/dashboard" ? pathname === href : pathname.startsWith(href);
}

export function DashboardSidebar({
  mobileOpen,
  onClose
}: {
  mobileOpen: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const { session, activeOrganization, logout } = useSession();

  const content = (
    <div className="flex h-full flex-col border-r border-(--border) bg-(--sidebar) px-3 py-4">
      <div className="mb-5 flex items-center justify-between px-2">
        <Link href="/dashboard" className="flex items-center gap-2.5" onClick={onClose}>
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-(--accent) text-white">
            <Activity size={16} strokeWidth={2.5} />
          </span>
          <span className="text-sm font-black tracking-[0.16em] text-(--text)">DEVINSIGHT</span>
        </Link>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className="grid h-8 w-8 place-items-center rounded-lg text-(--muted) hover:bg-(--surface-soft) hover:text-(--text) lg:hidden"
        >
          <X size={18} />
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={onClose}
            className={`nav-link ${isActive(pathname, item.href) ? "nav-link-active" : ""}`}
          >
            <item.icon size={17} />
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="mt-3 border-t border-(--border) pt-3">
        <div className="mb-1 px-2">
          <p className="truncate text-sm font-bold text-(--text)">
            {session?.user.name ?? "—"}
          </p>
          <p className="truncate text-xs text-(--muted)">
            {activeOrganization?.name ?? session?.user.email ?? ""}
          </p>
        </div>
        <button type="button" onClick={logout} className="nav-link w-full">
          <LogOut size={16} />
          Logout
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 lg:block">{content}</aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
          <div className="absolute inset-y-0 left-0 w-64">{content}</div>
        </div>
      ) : null}
    </>
  );
}
