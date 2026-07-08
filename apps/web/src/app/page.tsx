export default function Home() {
  return (
    <main className="flex min-h-screen flex-1 items-center bg-[#f6f4ef] px-6 py-12 text-[#161513]">
      <section className="mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[1fr_420px] lg:items-center">
        <div className="max-w-3xl">
          <p className="mb-5 text-sm font-semibold uppercase tracking-[0.24em] text-[#6f6a5f]">
            Developer Intelligence Platform
          </p>
          <h1 className="text-5xl font-semibold leading-[1.02] md:text-7xl">
            DevInsight AI
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-[#57534a]">
            A workspace for turning Git activity into employee, team, project,
            and risk reports through the OpenClaw orchestration layer.
          </p>
        </div>
        <div className="border border-[#d8d1c3] bg-white p-6 shadow-[12px_12px_0_#1f2937]">
          <div className="mb-8 flex items-center justify-between border-b border-[#e5dfd3] pb-4">
            <span className="text-sm font-semibold text-[#57534a]">
              Bootstrap status
            </span>
            <span className="text-sm font-semibold text-emerald-700">
              Ready
            </span>
          </div>
          <dl className="grid gap-5 text-sm">
            <div>
              <dt className="font-semibold text-[#161513]">Frontend</dt>
              <dd className="mt-1 text-[#6f6a5f]">
                Next.js dashboard in apps/web
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-[#161513]">Backend</dt>
              <dd className="mt-1 text-[#6f6a5f]">
                Express API in apps/api
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-[#161513]">Shared</dt>
              <dd className="mt-1 text-[#6f6a5f]">
                Common TypeScript package in packages/shared
              </dd>
            </div>
          </dl>
        </div>
      </section>
    </main>
  );
}

