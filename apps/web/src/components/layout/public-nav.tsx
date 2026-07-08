import Link from "next/link";
import { Activity } from "lucide-react";

export function PublicNav() {
  return (
    <header className="fixed left-0 right-0 top-0 z-40 px-4 py-4 md:px-8">
      <nav className="glass mx-auto flex max-w-7xl items-center justify-between rounded-2xl px-3 py-2.5 pl-4">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="btn-gradient grid h-8 w-8 place-items-center rounded-xl">
            <Activity size={16} strokeWidth={2.5} />
          </span>
          <span className="text-sm font-black tracking-[0.22em] text-(--text)">
            DEVINSIGHT
          </span>
        </Link>
        <div className="flex items-center gap-1.5 pr-16 text-sm font-semibold md:pr-20">
          <Link
            href="/login"
            className="rounded-full px-4 py-2 text-(--muted) transition hover:bg-(--glass-strong) hover:text-(--text)"
          >
            Login
          </Link>
          <Link
            href="/dashboard"
            className="btn-gradient rounded-full px-4 py-2 text-sm font-bold"
          >
            Dashboard
          </Link>
        </div>
      </nav>
    </header>
  );
}
