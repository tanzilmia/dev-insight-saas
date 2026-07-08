import Link from "next/link";
import {
  ArrowRight,
  GitBranch,
  ShieldCheck,
  Sparkles,
  TrendingUp
} from "lucide-react";

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

const stats = [
  ["4", "Roles built in"],
  ["1-click", "Org onboarding"],
  ["100%", "Server-validated"]
];

export default function Home() {
  return (
    <main className="min-h-screen px-5 pb-20 pt-28 md:px-8">
      <PublicNav />
      <section className="mx-auto grid max-w-7xl gap-12 py-10 lg:grid-cols-[1.08fr_0.92fr] lg:items-center">
        <div className="animate-rise">
          <span className="glass-soft mb-6 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-black uppercase tracking-[0.28em] text-(--accent)">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-(--accent)" />
            DevInsight AI
          </span>
          <h1 className="max-w-4xl text-5xl font-black leading-[0.98] tracking-tight text-(--text) md:text-7xl">
            Developer intelligence without{" "}
            <span className="text-gradient">manual status chasing.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-(--muted)">
            Turn Git activity into organization-aware engineering visibility,
            team reports, and risk summaries through a clean SaaS dashboard.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/login"
              className="btn-gradient inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-sm font-black"
            >
              Login now <ArrowRight size={16} />
            </Link>
            <Link
              href="/dashboard"
              className="glass glass-hover rounded-full px-6 py-3.5 text-sm font-black text-(--text)"
            >
              Open dashboard
            </Link>
          </div>

          <div className="mt-12 grid max-w-lg grid-cols-3 gap-4">
            {stats.map(([value, label]) => (
              <div key={label}>
                <p className="text-3xl font-black text-(--text)">{value}</p>
                <p className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-(--muted)">
                  {label}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="glass animate-rise rounded-[2.5rem] p-5 [animation-delay:120ms] md:p-7">
          <div className="glass-soft rounded-4xl p-5 md:p-6">
            <div className="mb-7 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp size={18} className="text-(--accent)" />
                <span className="text-sm font-black text-(--text)">
                  Engineering Pulse
                </span>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-black text-emerald-600 dark:text-emerald-400">
                <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Foundation ready
              </span>
            </div>
            <div className="grid gap-4">
              {features.map((feature) => (
                <div
                  key={feature.title}
                  className="glass glass-hover flex gap-4 rounded-3xl p-5"
                >
                  <span className="btn-gradient grid h-11 w-11 shrink-0 place-items-center rounded-2xl">
                    <feature.icon size={20} />
                  </span>
                  <div>
                    <h2 className="text-lg font-black text-(--text)">
                      {feature.title}
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-(--muted)">
                      {feature.copy}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
