# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

DevInsight AI — an AI-powered developer-intelligence / team work-report SaaS. Managers connect GitHub (via PAT), sync repositories, map Git contributors to employees, and generate AI reports about developer activity.

The full value chain **works end-to-end on real data**: PAT (encrypted) → repo sync → contributor auto-mapping → branch-aware commit collection → smart report engine (coverage ledger + cache) → executive-readable LLM report (Markdown). Built on top of that: a statistics dashboard, scheduled reports, public share links, an AI chat assistant routed through a real external OpenClaw runtime, **Telegram report delivery**, live **GitHub-webhook** commit sync, **SonarQube code-quality** integration, **PR/review collaboration** metrics, a manager-only **Analysis / Appraisal / Awards** suite (the product's fairness core: evidence-based, deliberately *not* a single score or AI verdict), and **GitHub App + CI-workflow automation** for client repos. Remaining: multi-tenant SonarQube, employee login, integration/web tests, and a first real-VPS deploy run (the Docker stack is scaffolded — see `docs/DEPLOYMENT.md`).

**`docs/PROJECT_STATE.md` is the authoritative state/handoff document** — read it before starting substantial work, and **update it after each completed task** (the repo is handed between different AI agents and relies on it). Other files under `docs/` (blueprints, `TECH_STACK.md`) are product intent, not current state.

## Monorepo layout

npm workspaces (`apps/*`, `packages/*`), Node ≥ 20.

- `apps/api` — Express 5 + Prisma 7 backend (`@devinsight/api`). **ESM** (`"type": "module"`), TypeScript 6, NodeNext.
- `apps/web` — Next.js 16 + React 19 dashboard (`@devinsight/web`). App Router, Tailwind 4.
- `packages/shared` — stub (only exports `APP_NAME`, nothing imports it).
- `integrations/devinsight-mcp-server` — standalone host-run MCP server (`server.mjs`, Streamable HTTP on :4100) exposing `devinsight_context` + `devinsight_generate_report` tools to the OpenClaw agent; **not** a workspace. Its sibling `devinsight-openclaw-plugin/` is superseded, kept for reference only.
- `docs/` — `PROJECT_STATE.md` (state of record), `OPENCLAW_SETUP.md` (how to run the chat stack), plus product blueprints (intent only).

## Commands

Run from the repo root; each fans out across workspaces via `--if-present`:

```bash
npm run dev          # web (:3000) + api (:4000) + MCP (:4100) together — runs ./start-dev.sh (Ctrl+C stops all)
npm run dev:web      # web only  (== npm run dev -w @devinsight/web)
npm run dev:api      # api only  (== npm run dev -w @devinsight/api)
npm run dev:mcp      # MCP server (:4100) for the OpenClaw chat path
./start-dev.sh       # same as `npm run dev` (app processes stay host-run in development)
npm run docker:up    # SonarQube (+ its Postgres) + OpenClaw gateway under one `devinsight` Compose project
npm run docker:down  # stop the unified Docker project without deleting persisted data
npm run docker:status # show unified Docker service status
npm run docker:openclaw:cli -- <args>  # run the OpenClaw helper CLI as a one-off container
npm test             # Vitest unit suite (fans out; currently apps/api only)
npm run build        # tsc / next build across workspaces
npm run lint         # eslint across workspaces
npm run typecheck    # tsc --noEmit across workspaces
npm run prisma:generate                       # regenerate the Prisma client (== -w @devinsight/api)
npm run security:rotate-local-secrets         # rotate local JWT/encryption secrets (scripts/*.mjs)
npm run security:sync-openclaw-mcp-token      # sync the MCP bearer token into OpenClaw's .env
```

Other tooling: `scripts/install-hooks.sh` points `core.hooksPath` at `.githooks/` — its `pre-push` hook launches a **background** SonarQube scan (`scripts/sonar-scan.sh`, log at `.sonar-scan.log`, gitignored) and never blocks the push, skipping cleanly when `SONAR_TOKEN`/the local server is absent. CI is `.github/workflows/ci.yml` (push to `main` + PRs): `npm ci → prisma:generate → typecheck → lint → test → build`, no secrets/deploy.

Prisma (run from `apps/api/`; CLI config in `prisma.config.ts`, DB is PostgreSQL/Neon):

```bash
cd apps/api
npx prisma migrate dev --name <change>
npx prisma generate     # ALWAYS run after schema edits — migrate dev has failed to regenerate the client here before, and tsc won't see new models until you do
```

**Tests: a Vitest unit suite exists for `apps/api`** (added 2026-07-14). Run `npm test` (root, fans out) or `npm run test -w @devinsight/api` (watch: `test:watch`). Config: `apps/api/vitest.config.ts` (Node env, a pre-resolver mapping NodeNext `.js` imports → `.ts`, hermetic `test.env` so `config/env.ts` validates without a real `.env`). Tests live in `apps/api/tests/unit/**` — **outside `src`, so they're excluded from `tsc`/`eslint`** (typecheck/lint/build unaffected). Current coverage is the pure/deterministic cores only: `token-cipher`, `coverage.ts` interval math, `commit-classifier`, `plain-language`, `comparison`, `insights`, `themes`, `computeNextRun` (DST/month-clamp), `resolvePeriod` (custom-range/inclusive-day). **Still no integration tests** (report flow with mocked `GitProvider`/`LLMProvider` is the next step) and **no `apps/web` tests**. Beyond unit tests, verification is still done by driving the running API — see "How to verify" below. Before committing nontrivial changes run `test`, `typecheck`, `lint`, and `build` (all currently pass).

## Critical conventions (easy to get wrong)

- **Backend imports need explicit `.js` extensions**, even when importing a `.ts` file (NodeNext ESM). The build breaks otherwise.
- **Next.js 16 is not the version in your training data.** `apps/web/AGENTS.md`: read the relevant guide under `node_modules/next/dist/docs/` before writing web code. E.g. route `params` is a `Promise` (see `app/share/[token]/page.tsx`).
- **Next.js 16 lint rule `react-hooks/set-state-in-effect`:** never call `setState` synchronously inside an effect. Data-loading effects use `.then()` callbacks (not `async/await`) so `setState` stays deferred — copy the pattern in `lib/use-session.ts` and the manager components.
- **Prisma 7 driver-adapter:** the `datasource` block in `prisma/schema.prisma` intentionally has **no `url`** — the connection is supplied at runtime via `PrismaPg` in `src/config/database.ts` and to the CLI via `prisma.config.ts`. Don't "fix" the schema by adding one.
- **Provider abstractions are mandatory** — external systems always sit behind an interface + registry, so a controller/service never touches a vendor SDK/API directly. The five: `GitProvider` (read-only Git activity — `modules/git-providers/`, impl `modules/github/`); `LLMProvider` (`modules/llm/`, OpenAI-compatible — pointed at Groq via env, swappable with zero code change); `CodeQualityProvider` (`modules/code-quality/`, SonarQube impl, SonarCloud config-swap-ready); `DevOpsProvider` (`modules/devops-providers/`, repo **mutation** + Actions/CI, needs write scopes + GitHub-App installation tokens, impl `modules/github-devops/`); `ChannelProvider` (`modules/channels/`, Telegram impl, Discord/Slack drop-in). Add a new vendor by implementing the interface + registering it, not by branching in business logic.
- **Reports never fail on LLM problems.** If no LLM is configured or the call errors, `orchestrateReport` falls back to a deterministic Markdown template (`status: PARTIAL`, `generatedBy: "template"`). Preserve this.
- **Smart-engine logic lives in the backend, not in OpenClaw/MCP.** The decide/auto-collect/cache pipeline is in the API report service; OpenClaw and the MCP server just ask. Every channel (dashboard, chat, schedules) must reuse `orchestrateReport`.
- **PAT / credential security.** Git PATs are AES-256-GCM encrypted at rest (`common/crypto/token-cipher.ts`, keyed by `GIT_TOKEN_ENCRYPTION_KEY`), never returned to the frontend, logged, or cached decrypted. The OpenClaw gateway token is server-side only.
- Import `env` from `config/env.ts`; never read `process.env` directly.

## Backend architecture (`apps/api/src`)

Modular-by-feature under `modules/<feature>/`: `*.controller.ts` (thin Express `Router`; wrap async handlers in `asyncHandler(...)`, validate with a Zod schema's `.parse()` inline), `*.service.ts` (business logic + Prisma; throw `AppError(status, message, code)`), `*.schemas.ts` (Zod). `common/middleware/error-handler.ts` is the single place errors become responses (`ZodError → 400 VALIDATION_ERROR`, `AppError → status/code`, else 500) and is registered **last** in `app.ts`. Entry: `main.ts` → `createApp()` + `startScheduler()`.

Auth has four request-authentication paths (all authorization still happens in services):
- **JWT** (7-day): `requireAuth` sets `req.authUser` (`{ id, email, memberships }`). Role checks happen in services via `common/access/organization-access.ts` — `requireOrganizationMember` / `requireOrganizationRole`; `MANAGER_ROLES = [OWNER, MANAGER, ADMIN]` can manage, EMPLOYEE is read-only. There is no generic role middleware.
- **Service key**: `requireServiceKey` (`openclaw.middleware.ts`, timing-safe `x-openclaw-key` check) guards the tool endpoints the MCP server calls (`POST /api/openclaw/tools/generate-report`, `GET /api/openclaw/tools/context`). MCP tenant identity is a per-chat-request, API-signed 10-minute context token (`OPENCLAW_CONTEXT_SIGNING_SECRET`), not a fixed org.
- **Webhook HMAC**: `/api/webhooks/github/:repositoryId` (live commit sync) and `/api/webhooks/github-app` verify `X-Hub-Signature-256` against a per-repo/per-app secret with `timingSafeEqual`; no JWT.
- **GitHub App installation tokens**: short-lived tokens minted per call in `github-app/github-app.auth.ts` + `repository-token.ts` (`resolveRepositoryToken` picks the App installation *or* the org PAT), used by the `DevOpsProvider` for write ops and by PR collection. Never stored.

Route-mount order in `app.ts` matters: the two **webhook routers mount before `express.json()`** (they need the raw body for HMAC); the service-key openclaw router mounts **before** the JWT one at `/api/openclaw` (per-route guards let unmatched paths fall through); and `/api/public/reports` (unauthenticated share-link reads) is mounted outside `requireAuth`.

Module map (feature modules): `auth`, `organizations`, `projects`, `employees` (+ git aliases, bulk CSV import), `credentials` (PAT lifecycle at `/api/git-credentials`, incl. GitHub username resolution), `repositories`, `contributors` (discovery, suggestions, auto-link), `activity` (commit collection + aggregation + deep-history `CollectionJob` worker — the largest service, mounted under `/api/repositories`), `webhooks` (live GitHub push → ingest), `report-engine` (pure helpers: commit-classifier, comparison, insights, themes, plain-language), `reports` (persistence, history, share tokens, cache lookup), `schedules`, `statistics`, `analysis` (manager-only: per-project activity, appraisal, awards/employee-of-the-month, daily digest, leaderboard snapshots), `channels` (Telegram delivery), `code-quality` (SonarQube overview/trend/appraisal integration), `pull-requests` (PR + review collaboration metrics), `github-app` (App install/webhook lifecycle) + `github-devops` (`DevOpsProvider` impl), `ci` (detect stack → generate workflow → PR → merge, for onboarded repos), `openclaw` (orchestration hub + chat proxy). Abstraction layers: `git-providers`/`github`/`llm`/`devops-providers`.

**The report pipeline** (`orchestrateReport` in `openclaw.service.ts`) is the heart of the product:
1. Resolve target (repository/project/employee/team) + period (`openclaw.tools.ts`).
2. `ensureActivityCollected` (`activity.service.ts`) — consults the **coverage ledger** (`RepositoryCoverage` + interval math in `activity/coverage.ts`) and fetches only missing sub-ranges from Git, per branch, using the org's stored credential. Repos that error are skipped with warnings, never failing the report.
3. Aggregate + analyze (`analyzeActivity` → categories/modules/risks via `report-engine/commit-classifier.ts`) + `buildEmployeeLeaderboard`.
4. **Report cache**: a data fingerprint + scope + day-bucketed period match reuses a prior LLM report and skips the LLM (custom prompts always regenerate).
5. LLM (or template fallback) → persist `Report` in a `$transaction` with an `AuditLog` row.

Collection is **branch-aware**: commits are stored once (`@@unique[repositoryId, sha]`) and linked to every containing branch via `CommitBranch`, so multi-branch work isn't double-counted; reports read across all branches (unmerged work is intentionally included). Ingestion has hard caps throughout (`MAX_BRANCHES`, `MAX_DETAIL_COMMITS`, page caps).

**Schedules**: in-process `setInterval` scheduler (`schedules/scheduler.ts`, 60s tick), timezone/DST-correct `computeNextRun`, each due row claimed atomically via conditional `updateMany` before running through `orchestrateReport`. Single-instance by design; a multi-instance deploy needs a shared queue (planned "Phase E").

**Statistics** (`getStatisticsOverview`) reads only stored commits — never hits Git. The same is true of the **Analysis/Appraisal** suite: manager-gated, reads stored commit data only, and its scoring/ranking is **deterministic** (the only LLM touch is a best-effort *citation* layer on awards — the numbers never depend on it). Line counts everywhere in this suite exclude **noise** (`isNoisePath`: lockfiles, generated dirs, minified artifacts) so a dependency bump can't inflate anyone. These are framed in-product as *activity signals / evidence, not performance verdicts* — preserve that framing and the deterministic, single-source-of-truth math (`report-engine` pure helpers, `buildEmployeeLeaderboard`). **Code quality** (`code-quality` module) reads the SonarQube Web API through `CodeQualityProvider`, joins issues-by-git-author to employees, and degrades to `available: false` (never hard-fails) when unconfigured — same resilience contract as the LLM fallback.

Writes generally run in `prisma.$transaction` and record an `AuditLog` row. Data model highlights beyond the auth/org foundation: `GitCredential`, `Repository` (+ `webhook*` live-sync fields, `sonarProjectKey`), `ContributorIdentity` (per-repo) + `EmployeeGitMapping` + `EmployeeGitAlias` (org-scoped declared handles that drive auto-linking across repos), `Commit`/`ChangedFile`/`Branch`/`CommitBranch`, `RepositoryCoverage`, `CollectionJob` (deep-history worker), `Report` (+ `shareToken`, `dataFingerprint`) / `ReportContributor`, `ReportSchedule` (+ `channelId`), `NotificationChannel` (encrypted Telegram token), `LeaderboardSnapshot`/`LeaderboardSnapshotRow` + `EmployeeAward` (awards), `PullRequest`/`PullRequestReview`, `CodeQualityConnection` (encrypted Sonar token) / `CodeQualitySnapshot`, plus the GitHub App install models. Migrations live in `apps/api/prisma/migrations/`; several are additive raw-SQL (partial unique indexes, nullable-unique constraints) — see `docs/PROJECT_STATE.md`.

## OpenClaw integration

OpenClaw (openclaw.ai) is an external self-hosted AI-agent runtime, run separately in Docker (gateway on :18789 — setup in `docs/OPENCLAW_SETUP.md`). Two distinct paths:

- **Dashboard report form** → `POST /api/openclaw/reports/generate` → the in-repo `orchestrateReport` directly (no external runtime involved).
- **Chat widget** → `POST /api/openclaw/chat/stream` (NDJSON to the browser) → OpenClaw gateway (OpenAI-compatible SSE) → agent → MCP server (:4100) → service-key tool endpoints → `orchestrateReport`. Chat degrades gracefully to a "not connected" state when `OPENCLAW_GATEWAY_URL`/`TOKEN` are unset. MVP is single-org: the MCP server is pinned to one org/requester via its `run.sh`.

## Frontend architecture (`apps/web/src`)

Routes under `app/` are thin wrappers; each dashboard page renders a `"use client"` feature manager from `components/<area>/*-manager.tsx` (areas: `statistics`/overview, `projects`, `employees`, `repositories`, `contributors`, `reports`, `schedules`, `analysis` (analysis + appraisal + awards), `channels`, `code-quality`, `credentials`, `openclaw` chat). Some nav items are **manager-only** (`NAV_ITEMS[].managerOnly`, filtered via `canManage`): Analysis, Appraisal, Channels, Code Quality. The dashboard shell (sidebar + topbar + floating chat widget) lives in `app/dashboard/layout.tsx`; `components/dashboard/dashboard-chrome.tsx` is a legacy pass-through shim. `app/dashboard/projects/[id]/` is a project-detail hub (embeds the analysis manager); `app/share/[token]/` is the public report page (no auth/chrome). `@/*` aliases `src/*`.

State/data conventions — **what's actually used, not what's installed**:
- All data fetching is plain axios helpers in `lib/api.ts` (the single ~1900-line data layer: shared instance with a JWT request interceptor, ~100 typed helpers grouped by domain, `getApiErrorMessage` for errors). Add new backend calls there, following the existing style. Exception: `streamAssistantMessage` uses `fetch` + `getReader()` to consume the NDJSON chat stream.
- Component-local `useState`/`useEffect` only. TanStack Query/Table and Zustand are in `package.json` but **entirely unused** — don't assume stores or query caches exist.
- Auth: token in `localStorage` (`lib/auth-storage.ts`, key `devinsight.accessToken`); `lib/use-session.ts` is the client-side guard hook (redirects to `/login`, exposes `activeOrganization`, `canManage(role)`). There is no `middleware.ts`.
- Theme: custom `theme-provider.tsx` context (not next-themes) setting `data-theme` on `<html>`; the toggle is hydration-safe via `useSyncExternalStore`.

Styling: Tailwind 4 CSS-first (no `tailwind.config.js`; tokens + `@theme inline` in `app/globals.css`). A custom flat design system of CSS variables and utility classes — `.glass`, `.glass-soft`, `.btn-gradient`, `.field`, `.nav-link`, `.report-md` (rendered-Markdown styles) — restyles all pages centrally. shadcn/ui is configured in `components.json` but **no `components/ui/` primitives exist**; components use raw elements + these utilities, with lucide-react icons. Charts (`components/statistics/charts.tsx`) are hand-rolled SVG/CSS — no charting library. Report Markdown renders via `react-markdown` + `remark-gfm`.

## Env / local setup

Copy `apps/api/.env.example` → `apps/api/.env`. Validated in `config/env.ts`:

- **Required:** `DATABASE_URL`, `JWT_ACCESS_SECRET` (≥ 24 chars), `GIT_TOKEN_ENCRYPTION_KEY` (base64-encoded 32-byte key — checked at boot).
- **Optional (features degrade gracefully — an unset key disables its feature, never crashes):**
  - LLM: `OPENAI_API_KEY`/`OPENAI_BASE_URL`/`OPENAI_MODEL` (any OpenAI-compatible endpoint; unset key → template reports).
  - Misc: `PORT` (4000), `GITHUB_API_BASE_URL` (override to point at a mock), `PUBLIC_API_URL` (externally reachable API base for GitHub webhooks; unset → live sync unavailable, clean 400).
  - OpenClaw chat: `OPENCLAW_SERVICE_KEY`, `OPENCLAW_GATEWAY_URL`, `OPENCLAW_GATEWAY_TOKEN`, `OPENCLAW_CONTEXT_SIGNING_SECRET` (signs the 10-min MCP tenant context).
  - Code quality: `CODE_QUALITY_PROVIDER` (`sonarqube`), `SONAR_BASE_URL`, `SONAR_TOKEN`, `SONAR_ORGANIZATION` (set → SonarCloud branch/PR capabilities). Per-org connections stored in DB override these env defaults.
  - GitHub App (client-repo CI/DevOps): `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_SLUG`, `GITHUB_APP_WEBHOOK_SECRET`.

The standalone MCP server has its own env (`DEVINSIGHT_MCP_TOKEN`, etc.), not validated by `config/env.ts`. Web reads `NEXT_PUBLIC_API_URL` (default `http://localhost:4000`).

## How to verify

Beyond `npm test` (unit suite) + `typecheck`/`lint`/`build`, end-to-end verification is done by driving the running API against mock servers so no real credentials/quota are needed: a mock GitHub on :4999 (`GITHUB_API_BASE_URL=http://localhost:4999`; a token containing `goodtoken` is "valid") and a mock LLM on :4998 (`OPENAI_API_KEY=test OPENAI_BASE_URL=http://localhost:4998`). Typical flow: register → connect credential → sync + select repo → collect activity → discover/map contributors → `POST /api/openclaw/reports/generate` → assert real stats and `status: GENERATED` (LLM) or `PARTIAL` (template). Mock scripts aren't committed — recreate as needed (shapes documented in `docs/PROJECT_STATE.md` §9). Kill background `tsx`/mock processes when done.

Vitest is now installed and the pure-core unit suite is in place (see the Tests note above). The next testing step is **integration coverage**: add Supertest and exercise the report flow (`orchestrateReport`) with mocked `GitProvider`/`LLMProvider` (and a test DB or a Prisma mock), then extend to the auth/RBAC and schedule paths. New pure helpers should get a co-located unit test in `apps/api/tests/unit/`.

## Production deploy (VPS + Docker)

Full guide: `docs/DEPLOYMENT.md`. Everything runs in Docker on one VPS behind a **Caddy** reverse proxy on port 80 (`deploy/Caddyfile`: `/api/*` → api, else → web — single origin, HTTP-only/IP for now). The **DB stays on Neon** (no app Postgres container). Files: `docker-compose.prod.yml` (project `devinsight-prod`; core = caddy/web/api, plus `sonar` + `openclaw` Compose profiles), `apps/{api,web}/Dockerfile`, `integrations/devinsight-mcp-server/Dockerfile`, `deploy/env.prod.example` → `deploy/.env.prod`. Root scripts: `prod:up` / `prod:core` / `prod:down` / `prod:logs` / `prod:config`.

Things easy to get wrong here:
- **Local dev is untouched.** Web standalone output is gated behind `NEXT_OUTPUT=standalone` (set only in `apps/web/Dockerfile`); `next dev`/`next build` see an empty config. Don't remove the gate.
- **Same-origin web build.** The web image builds with `NEXT_PUBLIC_API_URL=""` so the browser calls `/api/...` on its own origin (Caddy routes it). Don't hard-code the VPS IP into the build.
- **Reuse the existing secrets.** Because production points at the same Neon DB, `deploy/.env.prod` must reuse the exact `GIT_TOKEN_ENCRYPTION_KEY` + `JWT_ACCESS_SECRET` from `apps/api/.env`, or existing encrypted PATs won't decrypt.
- **Migrations auto-run** on api container start (`docker-entrypoint.sh` → `prisma migrate deploy`). **Single api instance only** (in-process scheduler + collection worker).
