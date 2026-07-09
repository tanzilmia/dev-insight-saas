"use client";

import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";

import { useSession } from "@/lib/use-session";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { NAV_ITEMS } from "./dashboard-sidebar";

function titleFor(pathname: string) {
  const match = [...NAV_ITEMS]
    .filter((item) => (item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href)))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.label ?? "Dashboard";
}

export function DashboardTopbar({ onMenu }: { onMenu: () => void }) {
  const pathname = usePathname();
  const { session, activeOrganization } = useSession();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-(--border) bg-(--surface) px-4 sm:px-6 lg:px-8">
      <button
        type="button"
        onClick={onMenu}
        aria-label="Open menu"
        className="grid h-9 w-9 place-items-center rounded-lg text-(--muted) hover:bg-(--surface-soft) hover:text-(--text) lg:hidden"
      >
        <Menu size={18} />
      </button>

      <h1 className="text-base font-bold tracking-tight text-(--text)">{titleFor(pathname)}</h1>

      <div className="ml-auto flex items-center gap-3">
        {activeOrganization ? (
          <span className="hidden rounded-full border border-(--border) bg-(--surface-soft) px-3 py-1 text-xs font-semibold text-(--muted) sm:inline">
            {activeOrganization.name}
          </span>
        ) : null}
        <ThemeToggle />
        <span className="hidden max-w-[16rem] truncate text-sm font-medium text-(--muted) md:block">
          {session?.user.email}
        </span>
      </div>
    </header>
  );
}
