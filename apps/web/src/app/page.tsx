import Link from "next/link";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  BarChart3,
  Bot,
  CheckCircle2,
  CircleGauge,
  Code2,
  GitBranch,
  GitCommit,
  LockKeyhole,
  Radar,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Target,
  TriangleAlert,
  Users,
  Workflow,
  Zap
} from "lucide-react";

import { PublicNav } from "@/components/layout/public-nav";

const proofSignals = [
  { icon: GitBranch, label: "GitHub App connected" },
  { icon: Bot, label: "AI-assisted reports" },
  { icon: ScanLine, label: "SonarQube quality signals" },
  { icon: ShieldCheck, label: "Role-aware by default" }
];

const workflowSteps = [
  {
    number: "01",
    icon: GitBranch,
    title: "Connect",
    copy: "Bring in the repositories your team actually ships from with a secure GitHub App connection."
  },
  {
    number: "02",
    icon: Activity,
    title: "Collect",
    copy: "Capture commits, branches, contributors, pull requests, and quality signals as they happen."
  },
  {
    number: "03",
    icon: Sparkles,
    title: "Understand",
    copy: "Turn raw activity into clear themes, risk signals, trends, and manager-ready reports."
  },
  {
    number: "04",
    icon: Target,
    title: "Act",
    copy: "Use one shared picture to unblock delivery, recognize work, and have better conversations."
  }
];

const outcomes = [
  {
    icon: CircleGauge,
    eyebrow: "Less noise",
    title: "Replace status chasing",
    copy: "See what moved, what slowed down, and where attention is needed without another round of manual updates."
  },
  {
    icon: TriangleAlert,
    eyebrow: "More signal",
    title: "Spot delivery risk early",
    copy: "Bring commit patterns, quality gates, and engineering friction into the same calm operating view."
  },
  {
    icon: Users,
    eyebrow: "Fairer context",
    title: "Recognize invisible work",
    copy: "Make reviews, maintenance, collaboration, and steady progress visible—not just the loudest launches."
  }
];

const capabilities = [
  {
    icon: BarChart3,
    title: "Activity intelligence",
    copy: "Branch-aware Git activity with trends, summaries, and the context behind the numbers."
  },
  {
    icon: Users,
    title: "Contributor mapping",
    copy: "Connect Git identities to real team members so reports stay accurate and useful."
  },
  {
    icon: ScanLine,
    title: "Code quality",
    copy: "Bring SonarQube health, issues, coverage, and quality gates into the engineering picture."
  },
  {
    icon: Bot,
    title: "AI reports",
    copy: "Generate plain-language updates that explain what shipped, why it matters, and what to watch."
  },
  {
    icon: LockKeyhole,
    title: "Secure workspace",
    copy: "Organization-scoped access, roles, audit trails, and protected data boundaries by default."
  },
  {
    icon: Workflow,
    title: "Automated CI",
    copy: "Manage repeatable checks and quality scans through a reviewed GitHub Actions workflow."
  }
];

const pulseRows = [
  { label: "Delivery momentum", value: "+18%", tone: "emerald" },
  { label: "Quality gate", value: "Passed", tone: "indigo" },
  { label: "Attention needed", value: "2 signals", tone: "amber" }
];

export default function Home() {
  return (
    <main className="landing-page min-h-screen overflow-hidden">
      <div className="landing-grid" aria-hidden="true" />
      <div className="landing-orb landing-orb-one" aria-hidden="true" />
      <div className="landing-orb landing-orb-two" aria-hidden="true" />
      <PublicNav />

      <section className="relative mx-auto grid max-w-7xl gap-14 px-5 pb-20 pt-36 md:px-8 md:pt-44 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:gap-16 lg:pb-28">
        <div className="animate-rise max-w-3xl">
          <span className="glass-soft mb-7 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[0.68rem] font-black uppercase tracking-[0.26em] text-(--accent)">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-(--accent)" />
            Engineering signal, made useful
          </span>
          <h1 className="max-w-4xl text-[3.15rem] font-black leading-[0.94] tracking-[-0.055em] text-(--text) sm:text-6xl md:text-7xl lg:text-[5.4rem]">
            Turn engineering activity into a{" "}
            <span className="text-gradient">story your team can act on.</span>
          </h1>
          <p className="mt-7 max-w-xl text-base leading-8 text-(--muted) md:text-lg">
            DevInsight turns GitHub activity, contributor context, and code-quality signals into clear reports for the people responsible for helping teams ship well.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/login"
              className="landing-focus btn-gradient inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-sm font-black"
            >
              Get started <ArrowRight size={16} />
            </Link>
            <Link
              href="#how-it-works"
              className="landing-focus glass glass-hover inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-sm font-black text-(--text)"
            >
              See how it works <ArrowDownRight size={16} className="text-(--accent)" />
            </Link>
          </div>
          <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-bold uppercase tracking-[0.13em] text-(--muted)">
            <span className="inline-flex items-center gap-2">
              <CheckCircle2 size={15} className="text-emerald-500" /> Built for engineering teams
            </span>
            <span className="hidden h-1 w-1 rounded-full bg-(--border-strong) sm:block" />
            <span className="inline-flex items-center gap-2">
              <LockKeyhole size={15} className="text-(--accent)" /> Access stays scoped
            </span>
          </div>
        </div>

        <div className="landing-signal-wrap animate-rise [animation-delay:120ms]" aria-label="DevInsight engineering signal preview">
          <div className="landing-signal-frame relative p-3 sm:p-4">
            <div className="landing-signal-inner overflow-hidden rounded-[1.55rem]">
              <div className="flex items-center justify-between border-b border-(--border) px-5 py-4 sm:px-6">
                <div className="flex items-center gap-3">
                  <span className="btn-gradient grid h-9 w-9 place-items-center rounded-xl">
                    <Radar size={17} />
                  </span>
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-(--muted)">Live workspace</p>
                    <p className="mt-0.5 text-sm font-black text-(--text)">Engineering Signal</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[0.65rem] font-black text-emerald-600 dark:text-emerald-400">
                  <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-500" /> Healthy
                </span>
              </div>

              <div className="grid gap-4 p-4 sm:p-6">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="signal-metric signal-metric-accent">
                    <div className="flex items-center justify-between text-(--muted)">
                      <span className="text-[0.65rem] font-black uppercase tracking-[0.13em]">Commits</span>
                      <GitCommit size={14} />
                    </div>
                    <p className="mt-4 text-2xl font-black text-(--text)">284</p>
                    <p className="mt-1 text-xs font-bold text-emerald-500">+18.4% this period</p>
                  </div>
                  <div className="signal-metric">
                    <div className="flex items-center justify-between text-(--muted)">
                      <span className="text-[0.65rem] font-black uppercase tracking-[0.13em]">Contributors</span>
                      <Users size={14} />
                    </div>
                    <p className="mt-4 text-2xl font-black text-(--text)">12</p>
                    <p className="mt-1 text-xs font-bold text-(--muted)">Across 4 repositories</p>
                  </div>
                  <div className="signal-metric">
                    <div className="flex items-center justify-between text-(--muted)">
                      <span className="text-[0.65rem] font-black uppercase tracking-[0.13em]">Quality</span>
                      <ScanLine size={14} />
                    </div>
                    <p className="mt-4 text-2xl font-black text-(--text)">A</p>
                    <p className="mt-1 text-xs font-bold text-emerald-500">Quality gate passed</p>
                  </div>
                </div>

                <div className="glass-soft rounded-3xl p-4 sm:p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-black text-(--text)">Delivery momentum</p>
                      <p className="mt-1 text-xs font-medium text-(--muted)">Last 30 days · all repositories</p>
                    </div>
                    <span className="rounded-full bg-(--accent-soft) px-2.5 py-1 text-xs font-black text-(--accent)">On track</span>
                  </div>
                  <svg viewBox="0 0 560 150" className="h-32 w-full overflow-visible" role="img" aria-label="Rising delivery momentum chart">
                    <defs>
                      <linearGradient id="pulse-fill" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path d="M0 126 C45 120, 55 94, 95 101 S145 117, 177 78 S222 83, 259 88 S308 62, 342 69 S388 46, 422 54 S462 24, 502 39 S535 21, 560 16 V150 H0 Z" fill="url(#pulse-fill)" />
                    <path d="M0 126 C45 120, 55 94, 95 101 S145 117, 177 78 S222 83, 259 88 S308 62, 342 69 S388 46, 422 54 S462 24, 502 39 S535 21, 560 16" fill="none" stroke="var(--accent)" strokeLinecap="round" strokeWidth="3" />
                    <circle cx="560" cy="16" r="5" fill="var(--accent)" />
                    <circle cx="560" cy="16" r="10" fill="var(--accent)" opacity="0.16" />
                  </svg>
                  <div className="mt-1 flex justify-between text-[0.65rem] font-bold uppercase tracking-[0.12em] text-(--muted)">
                    <span>Jun 20</span><span>Today</span>
                  </div>
                </div>

                <div className="grid gap-2">
                  {pulseRows.map((row) => (
                    <div key={row.label} className="signal-row">
                      <span className={"signal-status signal-status-" + row.tone} />
                      <span className="text-xs font-bold text-(--muted)">{row.label}</span>
                      <span className="ml-auto text-xs font-black text-(--text)">{row.value}</span>
                    </div>
                  ))}
                </div>

                <div className="flex items-start gap-3 rounded-2xl border border-(--accent)/20 bg-(--accent-soft) px-4 py-3">
                  <Sparkles size={16} className="mt-0.5 shrink-0 text-(--accent)" />
                  <p className="text-xs font-semibold leading-5 text-(--text)">
                    <span className="font-black">AI summary:</span> Platform work accelerated this period, with quality holding steady across the main branch.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative border-y border-(--border) bg-(--surface-soft)/55" aria-label="DevInsight capabilities at a glance">
        <div className="mx-auto grid max-w-7xl gap-px px-5 md:grid-cols-2 md:px-8 lg:grid-cols-4">
          {proofSignals.map((signal) => (
            <div key={signal.label} className="flex items-center gap-3 py-5 text-sm font-bold text-(--muted) lg:justify-center">
              <signal.icon size={17} className="text-(--accent)" />
              <span>{signal.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="relative mx-auto max-w-7xl scroll-mt-24 px-5 py-24 md:px-8 md:py-32">
        <div className="max-w-2xl">
          <p className="section-kicker"><Zap size={14} /> From signal to story</p>
          <h2 className="section-title">A calmer way to understand how work moves.</h2>
          <p className="section-copy">DevInsight keeps the mechanics in the background and gives your team a shared, explainable view of the work.</p>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {workflowSteps.map((step, index) => (
            <article key={step.number} className="workflow-card glass glass-hover relative rounded-3xl p-5">
              <div className="mb-12 flex items-start justify-between">
                <span className="btn-gradient grid h-10 w-10 place-items-center rounded-2xl"><step.icon size={18} /></span>
                <span className="font-mono text-xs font-bold tracking-[0.18em] text-(--muted)">{step.number}</span>
              </div>
              <h3 className="text-xl font-black text-(--text)">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-(--muted)">{step.copy}</p>
              {index < workflowSteps.length - 1 ? <ArrowRight size={16} className="workflow-arrow hidden text-(--accent) lg:block" /> : null}
            </article>
          ))}
        </div>
      </section>

      <section className="relative border-y border-(--border) bg-(--surface-soft)/45">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-24 md:px-8 md:py-32 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
          <div className="lg:sticky lg:top-28">
            <p className="section-kicker"><Target size={14} /> Why it matters</p>
            <h2 className="section-title">Better visibility should make teams feel lighter.</h2>
            <p className="section-copy">The point is not to create another dashboard to monitor. It is to create enough shared context that your team can spend more energy on the work itself.</p>
          </div>
          <div className="grid gap-4">
            {outcomes.map((outcome, index) => (
              <article key={outcome.title} className="outcome-card glass glass-hover grid gap-5 rounded-3xl p-6 sm:grid-cols-[auto_1fr_auto] sm:items-start">
                <span className="signal-icon grid h-12 w-12 place-items-center rounded-2xl"><outcome.icon size={21} /></span>
                <div>
                  <p className="text-[0.68rem] font-black uppercase tracking-[0.2em] text-(--accent)">{outcome.eyebrow}</p>
                  <h3 className="mt-2 text-xl font-black text-(--text)">{outcome.title}</h3>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-(--muted)">{outcome.copy}</p>
                </div>
                <span className="font-mono text-xs font-bold text-(--muted)">0{index + 1}</span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="relative mx-auto max-w-7xl px-5 py-24 md:px-8 md:py-32">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <p className="section-kicker"><Code2 size={14} /> One operating picture</p>
            <h2 className="section-title">The context behind the commit count.</h2>
          </div>
          <p className="max-w-sm text-sm leading-6 text-(--muted)">A focused toolkit for the signals engineering leaders need most—without pretending one metric tells the whole story.</p>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map((capability) => (
            <article key={capability.title} className="capability-card glass glass-hover rounded-3xl p-6">
              <span className="signal-icon grid h-11 w-11 place-items-center rounded-2xl"><capability.icon size={19} /></span>
              <h3 className="mt-6 text-lg font-black text-(--text)">{capability.title}</h3>
              <p className="mt-2 text-sm leading-6 text-(--muted)">{capability.copy}</p>
              <span className="mt-6 inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.14em] text-(--accent)">Built into the signal <ArrowRight size={13} /></span>
            </article>
          ))}
        </div>
      </section>

      <section className="relative mx-auto max-w-7xl px-5 pb-24 md:px-8 md:pb-32">
        <div className="landing-cta relative overflow-hidden rounded-[2rem] px-6 py-12 sm:px-10 sm:py-14 lg:px-16">
          <div className="relative z-10 max-w-2xl">
            <p className="section-kicker text-indigo-100"><Activity size={14} /> Ready when your team is</p>
            <h2 className="mt-5 text-3xl font-black tracking-[-0.04em] text-white sm:text-5xl">Give every engineering decision better signal.</h2>
            <p className="mt-5 max-w-xl text-sm leading-7 text-indigo-100/75 sm:text-base">Start with the repositories you already have. Build a clearer picture of delivery, quality, and the people behind the work.</p>
            <Link href="/login" className="landing-focus mt-8 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3.5 text-sm font-black text-indigo-700 transition hover:bg-indigo-50">Get started <ArrowRight size={16} /></Link>
          </div>
          <div className="landing-cta-mark" aria-hidden="true"><Activity size={170} strokeWidth={0.7} /></div>
        </div>
      </section>

      <footer className="border-t border-(--border) px-5 py-7 md:px-8">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-3 text-xs font-bold uppercase tracking-[0.14em] text-(--muted) sm:flex-row sm:items-center">
          <span>DevInsight AI</span>
          <span>Engineering signal, made useful.</span>
        </div>
      </footer>
    </main>
  );
}
