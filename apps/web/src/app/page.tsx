import Link from "next/link";
import { ArrowRight, GitBranch, ShieldCheck, Sparkles } from "lucide-react";

import { PublicNav } from "@/components/layout/public-nav";

const features = [
  {
    icon: ShieldCheck,
    title: "Secure foundation",
    copy: "Organization-scoped auth, roles, and protected dashboard access."
  },
  {
    icon: GitBranch,
    title: "Git-first workflow",
    copy: "Ready for GitHub PAT, repositories, and contributor mapping."
  },
  {
    icon: Sparkles,
    title: "AI report path",
    copy: "Designed so report generation flows through OpenClaw."
  }
];

export default function Home() {
  return (
    <main className="min-h-screen px-5 pb-16 pt-28 md:px-8">
      <PublicNav />
      <section className="mx-auto grid max-w-7xl gap-10 py-10 lg:grid-cols-[1.08fr_0.92fr] lg:items-center">
        <div>
          <p className="mb-5 text-xs font-black uppercase tracking-[0.35em] text-[var(--accent)]">
            DevInsight AI
          </p>
          <h1 className="max-w-4xl text-5xl font-black leading-[0.98] tracking-tight text-[var(--text)] md:text-7xl">
            Developer intelligence without manual status chasing.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-[var(--muted)]">
            Turn Git activity into organization-aware engineering visibility,
            team reports, and risk summaries through a clean SaaS dashboard.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-full bg-[var(--text)] px-5 py-3 text-sm font-black text-[var(--surface)] transition hover:-translate-y-0.5 hover:opacity-90"
            >
              Login now <ArrowRight size={16} />
            </Link>
            <Link
              href="/dashboard"
              className="rounded-full border border-[var(--border)] bg-[var(--glass)] px-5 py-3 text-sm font-black text-[var(--text)] shadow-lg shadow-black/5 backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-[var(--glass-strong)]"
            >
              Open dashboard
            </Link>
          </div>
        </div>

        <div className="rounded-[2.5rem] border border-[var(--border)] bg-[var(--glass)] p-5 shadow-2xl shadow-black/10 backdrop-blur-2xl md:p-8">
          <div className="rounded-[2rem] border border-[var(--border)] bg-[var(--surface-soft)] p-5">
            <div className="mb-8 flex items-center justify-between">
              <span className="text-sm font-black">Engineering Pulse</span>
              <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-black text-emerald-600">
                Foundation ready
              </span>
            </div>
            <div className="grid gap-4">
              {features.map((feature) => (
                <div
                  key={feature.title}
                  className="rounded-3xl border border-[var(--border)] bg-[var(--glass)] p-5 backdrop-blur-xl"
                >
                  <feature.icon className="mb-4 text-[var(--accent)]" size={24} />
                  <h2 className="text-xl font-black">{feature.title}</h2>
                  <p className="mt-2 leading-7 text-[var(--muted)]">
                    {feature.copy}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

