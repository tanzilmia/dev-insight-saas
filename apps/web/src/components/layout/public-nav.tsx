import Link from "next/link";

export function PublicNav() {
  return (
    <header className="fixed left-0 right-0 top-0 z-40 px-4 py-4 md:px-8">
      <nav className="mx-auto flex max-w-7xl items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--glass)] px-4 py-3 shadow-xl shadow-black/5 backdrop-blur-2xl">
        <Link href="/" className="text-sm font-black tracking-[0.22em]">
          DEVINSIGHT
        </Link>
        <div className="flex items-center gap-2 pr-20 text-sm font-semibold md:pr-24">
          <Link
            href="/login"
            className="rounded-full px-4 py-2 text-[var(--muted)] transition hover:bg-[var(--glass-strong)] hover:text-[var(--text)]"
          >
            Login
          </Link>
          <Link
            href="/dashboard"
            className="rounded-full bg-[var(--text)] px-4 py-2 text-[var(--surface)] transition hover:opacity-85"
          >
            Dashboard
          </Link>
        </div>
      </nav>
    </header>
  );
}

