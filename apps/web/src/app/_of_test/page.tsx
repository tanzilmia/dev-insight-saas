import { GitBranch, Plus, Search } from "lucide-react";

const fieldClass =
  "field w-full rounded-lg px-3.5 py-2.5 text-sm font-medium text-(--text) placeholder:font-normal";

const lookupResult = {
  login: "tanzilmia",
  name: "Md tanzil",
  company: "Digital Pylot",
  location: "Dhaka, Bangladesh",
  type: "User",
  avatarUrl: null as string | null
};

function Block({ fixed }: { fixed: boolean }) {
  const ghDivCls = fixed
    ? "grid min-w-0 gap-2 text-sm font-semibold text-(--text)"
    : "grid gap-2 text-sm font-semibold text-(--text)";
  const cardCls = fixed
    ? "flex min-w-0 items-center gap-3 rounded-lg border border-(--border) bg-(--surface-soft) p-3"
    : "flex items-center gap-3 rounded-lg border border-(--border) bg-(--surface-soft) p-3";

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr] lg:items-start">
      <section className="glass animate-rise min-w-0 rounded-xl p-5">
        <h1 className="text-xl font-bold tracking-tight text-(--text)">
          {fixed ? "AFTER (min-w-0)" : "BEFORE (current)"}
        </h1>
        <form className="mt-5 grid gap-3.5">
          <label className="grid gap-1.5 text-sm font-semibold text-(--text)">
            Name
            <input className={fieldClass} placeholder="Rahim Uddin" />
          </label>
          <div className={ghDivCls}>
            <span className="inline-flex items-center gap-1.5">
              <GitBranch size={14} />
              GitHub identities
            </span>
            <div className="flex gap-2">
              <input className={`${fieldClass} min-w-0`} placeholder="GitHub username" />
              <button
                type="button"
                className="inline-flex shrink-0 items-center rounded-lg border border-(--border) px-3 text-sm font-bold text-(--text)"
              >
                <Search size={15} />
              </button>
            </div>
            <div className={cardCls}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-(--text)">
                  {lookupResult.name ?? lookupResult.login}
                </p>
                <p className="truncate text-xs font-normal text-(--muted)">
                  @{lookupResult.login}
                  {lookupResult.company ? ` · ${lookupResult.company}` : ""}
                  {lookupResult.location ? ` · ${lookupResult.location}` : ""}
                </p>
              </div>
              <button
                type="button"
                className="btn-gradient inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-black"
              >
                <Plus size={13} /> Add
              </button>
            </div>
          </div>
        </form>
      </section>
      <section className="animate-rise min-w-0 rounded-xl border-2 border-dashed border-red-400 p-5">
        <h2 className="text-sm font-bold text-(--text)">RIGHT COLUMN (1fr) — should not be overlapped</h2>
        <p className="mt-2 text-sm text-(--muted)">members table area</p>
      </section>
    </div>
  );
}

export default function Page() {
  return (
    <div className="mx-auto max-w-7xl space-y-10 px-8 py-6">
      <Block fixed={false} />
      <Block fixed />
    </div>
  );
}
