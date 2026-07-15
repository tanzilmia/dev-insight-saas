# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

DevInsight AI — an AI-powered developer-intelligence / team work-report SaaS. Managers connect GitHub (via PAT), sync repositories, map Git contributors to employees, and generate AI reports about developer activity.

The full value chain **works end-to-end on real data**: PAT (encrypted) → repo sync → contributor auto-mapping → branch-aware commit collection → smart report engine (coverage ledger + cache) → LLM report (Markdown), plus a statistics dashboard, scheduled reports, public share links, and an AI chat assistant routed through a real external OpenClaw runtime. Remaining: channel delivery (Telegram/Discord), tests, deployment.

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
./start-dev.sh       # same as `npm run dev` (OpenClaw itself runs separately in Docker on :18789)
npm run build        # tsc / next build across workspaces
npm run lint         # eslint across workspaces
npm run typecheck    # tsc --noEmit across workspaces
```

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
- **Provider abstractions are mandatory.** GitHub specifics stay behind `GitProvider` (`modules/git-providers/`, impl in `modules/github/`); LLM specifics behind `LLMProvider` (`modules/llm/`, OpenAI-compatible — currently pointed at Groq via env, swappable with zero code change). Never call an LLM or the GitHub API directly from a controller/service outside these layers.
- **Reports never fail on LLM problems.** If no LLM is configured or the call errors, `orchestrateReport` falls back to a deterministic Markdown template (`status: PARTIAL`, `generatedBy: "template"`). Preserve this.
- **Smart-engine logic lives in the backend, not in OpenClaw/MCP.** The decide/auto-collect/cache pipeline is in the API report service; OpenClaw and the MCP server just ask. Every channel (dashboard, chat, schedules) must reuse `orchestrateReport`.
- **PAT / credential security.** Git PATs are AES-256-GCM encrypted at rest (`common/crypto/token-cipher.ts`, keyed by `GIT_TOKEN_ENCRYPTION_KEY`), never returned to the frontend, logged, or cached decrypted. The OpenClaw gateway token is server-side only.
- Import `env` from `config/env.ts`; never read `process.env` directly.

## Backend architecture (`apps/api/src`)

Modular-by-feature under `modules/<feature>/`: `*.controller.ts` (thin Express `Router`; wrap async handlers in `asyncHandler(...)`, validate with a Zod schema's `.parse()` inline), `*.service.ts` (business logic + Prisma; throw `AppError(status, message, code)`), `*.schemas.ts` (Zod). `common/middleware/error-handler.ts` is the single place errors become responses (`ZodError → 400 VALIDATION_ERROR`, `AppError → status/code`, else 500) and is registered **last** in `app.ts`. Entry: `main.ts` → `createApp()` + `startScheduler()`.

Auth is two-path:
- **JWT** (7-day): `requireAuth` sets `req.authUser` (`{ id, email, memberships }`). Role checks happen in services via `common/access/organization-access.ts` — `requireOrganizationMember` / `requireOrganizationRole`; `MANAGER_ROLES = [OWNER, MANAGER, ADMIN]` can manage, EMPLOYEE is read-only. There is no generic role middleware.
- **Service key**: `requireServiceKey` (`openclaw.middleware.ts`, timing-safe `x-openclaw-key` check) guards the tool endpoints the MCP server calls (`POST /api/openclaw/tools/generate-report`, `GET /api/openclaw/tools/context`).

Route-mount order in `app.ts` matters: the service-key openclaw router is mounted **before** the JWT one at `/api/openclaw` (per-route guards let unmatched paths fall through), and `/api/public/reports` (unauthenticated share-link reads) is mounted outside `requireAuth`.

Module map: `auth`, `organizations`, `projects`, `employees` (+ git aliases), `credentials` (PAT lifecycle at `/api/git-credentials`, incl. GitHub username resolution), `repositories`, `contributors` (discovery, suggestions, auto-link), `activity` (commit collection + aggregation — the largest service, mounted under `/api/repositories`), `report-engine` (pure commit-classifier helpers), `reports` (persistence, history, share tokens, cache lookup), `schedules`, `statistics`, `openclaw` (orchestration hub + chat proxy), `git-providers`/`github`/`llm` (abstractions).

**The report pipeline** (`orchestrateReport` in `openclaw.service.ts`) is the heart of the product:
1. Resolve target (repository/project/employee/team) + period (`openclaw.tools.ts`).
2. `ensureActivityCollected` (`activity.service.ts`) — consults the **coverage ledger** (`RepositoryCoverage` + interval math in `activity/coverage.ts`) and fetches only missing sub-ranges from Git, per branch, using the org's stored credential. Repos that error are skipped with warnings, never failing the report.
3. Aggregate + analyze (`analyzeActivity` → categories/modules/risks via `report-engine/commit-classifier.ts`) + `buildEmployeeLeaderboard`.
4. **Report cache**: a data fingerprint + scope + day-bucketed period match reuses a prior LLM report and skips the LLM (custom prompts always regenerate).
5. LLM (or template fallback) → persist `Report` in a `$transaction` with an `AuditLog` row.

Collection is **branch-aware**: commits are stored once (`@@unique[repositoryId, sha]`) and linked to every containing branch via `CommitBranch`, so multi-branch work isn't double-counted; reports read across all branches (unmerged work is intentionally included). Ingestion has hard caps throughout (`MAX_BRANCHES`, `MAX_DETAIL_COMMITS`, page caps).

**Schedules**: in-process `setInterval` scheduler (`schedules/scheduler.ts`, 60s tick), timezone/DST-correct `computeNextRun`, each due row claimed atomically via conditional `updateMany` before running through `orchestrateReport`. Single-instance by design; a multi-instance deploy needs a shared queue (planned "Phase E").

**Statistics** (`getStatisticsOverview`) reads only stored commits — never hits Git.

Writes generally run in `prisma.$transaction` and record an `AuditLog` row. Data model highlights beyond the auth/org foundation: `GitCredential`, `Repository`, `ContributorIdentity` (per-repo) + `EmployeeGitMapping` + `EmployeeGitAlias` (org-scoped declared handles that drive auto-linking across repos), `Commit`/`ChangedFile`/`Branch`/`CommitBranch`, `RepositoryCoverage`, `Report` (+ `shareToken`, `dataFingerprint`) / `ReportContributor`, `ReportSchedule`.

## OpenClaw integration

OpenClaw (openclaw.ai) is an external self-hosted AI-agent runtime, run separately in Docker (gateway on :18789 — setup in `docs/OPENCLAW_SETUP.md`). Two distinct paths:

- **Dashboard report form** → `POST /api/openclaw/reports/generate` → the in-repo `orchestrateReport` directly (no external runtime involved).
- **Chat widget** → `POST /api/openclaw/chat/stream` (NDJSON to the browser) → OpenClaw gateway (OpenAI-compatible SSE) → agent → MCP server (:4100) → service-key tool endpoints → `orchestrateReport`. Chat degrades gracefully to a "not connected" state when `OPENCLAW_GATEWAY_URL`/`TOKEN` are unset. MVP is single-org: the MCP server is pinned to one org/requester via its `run.sh`.

## Frontend architecture (`apps/web/src`)

Routes under `app/` are thin wrappers; each dashboard page renders a `"use client"` feature manager from `components/<area>/*-manager.tsx`. The dashboard shell (sidebar + topbar + floating chat widget) lives in `app/dashboard/layout.tsx`; `components/dashboard/dashboard-chrome.tsx` is a legacy pass-through shim. `app/share/[token]/` is the public report page (no auth/chrome). `app/_of_test/` is a disposable CSS scratch page. `@/*` aliases `src/*`.

State/data conventions — **what's actually used, not what's installed**:
- All data fetching is plain axios helpers in `lib/api.ts` (the single ~900-line data layer: shared instance with a JWT request interceptor, ~70 typed helpers grouped by domain, `getApiErrorMessage` for errors). Add new backend calls there, following the existing style. Exception: `streamAssistantMessage` uses `fetch` + `getReader()` to consume the NDJSON chat stream.
- Component-local `useState`/`useEffect` only. TanStack Query/Table and Zustand are in `package.json` but **entirely unused** — don't assume stores or query caches exist.
- Auth: token in `localStorage` (`lib/auth-storage.ts`, key `devinsight.accessToken`); `lib/use-session.ts` is the client-side guard hook (redirects to `/login`, exposes `activeOrganization`, `canManage(role)`). There is no `middleware.ts`.
- Theme: custom `theme-provider.tsx` context (not next-themes) setting `data-theme` on `<html>`; the toggle is hydration-safe via `useSyncExternalStore`.

Styling: Tailwind 4 CSS-first (no `tailwind.config.js`; tokens + `@theme inline` in `app/globals.css`). A custom flat design system of CSS variables and utility classes — `.glass`, `.glass-soft`, `.btn-gradient`, `.field`, `.nav-link`, `.report-md` (rendered-Markdown styles) — restyles all pages centrally. shadcn/ui is configured in `components.json` but **no `components/ui/` primitives exist**; components use raw elements + these utilities, with lucide-react icons. Charts (`components/statistics/charts.tsx`) are hand-rolled SVG/CSS — no charting library. Report Markdown renders via `react-markdown` + `remark-gfm`.

## Env / local setup

Copy `apps/api/.env.example` → `apps/api/.env`. Validated in `config/env.ts`:

- **Required:** `DATABASE_URL`, `JWT_ACCESS_SECRET` (≥ 24 chars), `GIT_TOKEN_ENCRYPTION_KEY` (base64-encoded 32-byte key — checked at boot).
- **Optional (features degrade gracefully):** `PORT` (4000), `GITHUB_API_BASE_URL` (override to point at a mock), `OPENAI_API_KEY`/`OPENAI_BASE_URL`/`OPENAI_MODEL` (any OpenAI-compatible endpoint; unset key → template reports), `OPENCLAW_SERVICE_KEY`, `OPENCLAW_GATEWAY_URL`, `OPENCLAW_GATEWAY_TOKEN`.

Web reads `NEXT_PUBLIC_API_URL` (default `http://localhost:4000`).

## How to verify (no test runner yet)

Drive the running API against mock servers so no real credentials/quota are needed: a mock GitHub on :4999 (`GITHUB_API_BASE_URL=http://localhost:4999`; a token containing `goodtoken` is "valid") and a mock LLM on :4998 (`OPENAI_API_KEY=test OPENAI_BASE_URL=http://localhost:4998`). Typical flow: register → connect credential → sync + select repo → collect activity → discover/map contributors → `POST /api/openclaw/reports/generate` → assert real stats and `status: GENERATED` (LLM) or `PARTIAL` (template). Mock scripts aren't committed — recreate as needed (shapes documented in `docs/PROJECT_STATE.md` §9). Kill background `tsx`/mock processes when done.

Vitest is now installed and the pure-core unit suite is in place (see the Tests note above). The next testing step is **integration coverage**: add Supertest and exercise the report flow (`orchestrateReport`) with mocked `GitProvider`/`LLMProvider` (and a test DB or a Prisma mock), then extend to the auth/RBAC and schedule paths. New pure helpers should get a co-located unit test in `apps/api/tests/unit/`.
