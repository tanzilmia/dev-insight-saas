# DevInsight AI — Project State & Handoff

> **Purpose of this file:** a single, self-contained context document so any AI
> coding agent (Codex, Claude, etc.) can pick up the project with full context.
> It records **what the product is, what has been built, how it works, the key
> decisions, and what remains**. Keep it updated as work continues.
>
> Last updated: 2026-07-09.

---

## 1. What this product is

**DevInsight AI** — an AI-powered developer-intelligence / team work-report SaaS.
Managers connect GitHub (via a Personal Access Token), sync repositories, map Git
contributors to employees, collect commit activity, and generate **AI-written
work reports** ("what did this repo / person / team ship this period?") from real
Git data.

Core value chain (all of this is **working end-to-end today on real data**):

```
GitHub PAT (encrypted) → repo sync → contributor/collaborator mapping →
commit + file-change collection → OpenClaw orchestration → LLM report (Markdown)
```

The product vision (`docs/DevInsight_AI_Docs/`) treats **OpenClaw** as the AI
orchestration layer that every report request flows through. See §7 for the
important nuance about what OpenClaw actually is vs. what is built today.

---

## 2. Current status — what is built (Phases 2–11)

The `docs/.../DevInsight_AI_Development_Roadmap.md` defines Phases 0–16. Built so far:

| Phase | Feature | Status |
|------|---------|--------|
| 0–1 | Monorepo + backend foundation (Express 5, Prisma 7, env, error handling) | ✅ done (pre-existing) |
| 2 | Auth + Organizations (JWT, register/login, org membership, RBAC roles) | ✅ done (pre-existing) |
| 3 | Projects + Employees (CRUD, project members, role checks) | ✅ done |
| 4 | Git credential management (PAT: validate → AES-256-GCM encrypt → store) | ✅ done |
| 5 | Repository sync (list from GitHub, select/track, assign to project, resync) | ✅ done |
| 6 | Contributor discovery + mapping (contributors **and** collaborators → employees) | ✅ done |
| 7 | OpenClaw orchestration (in-repo stand-in) + report tool layer | ✅ done (see §7) |
| 8 | Git activity collection (commits + changed files, per-commit stats) | ✅ done |
| 9 | Report engine (commit classification, module breakdown, risk signals → prompt) | ✅ done |
| 10 | LLM report generation (provider-agnostic; OpenAI-compatible) | ✅ done |
| 11 | Report persistence + history/detail in dashboard | ✅ done |

**Verified working on real data:** a repository report for a real repo produced an
accurate AI narrative (e.g. correctly summarized "RADIUS CoA controls" work from
real commit messages, with correct line-change math), badge `GENERATED`.

**Also done:** proper Markdown rendering on the Reports page (`react-markdown` +
`remark-gfm`) instead of raw `<pre>` output.

**Real external OpenClaw integration — IN PROGRESS:** the **backend foundation +
website chat box are DONE** (service-key tool endpoints, chat proxy, floating chat
widget — see §11.4). The chat widget shows "not connected" until the OpenClaw
runtime is up. **Next OpenClaw step = OpenClaw runtime (Docker, operator task) +
DevInsight tool plugin + channels.**

**NOT yet built:** the OpenClaw runtime/plugin/channels (§11.4), and
Phase 12–16 (statistics dashboard, sharing, tests, deployment).

---

## 3. Monorepo layout & how to run

npm workspaces, Node ≥ 20. `apps/api` (Express 5 + Prisma 7, **ESM**, TS 6,
NodeNext), `apps/web` (Next.js **16** + React 19, App Router, Tailwind 4,
shadcn/ui), `packages/shared` (stub), `docs/`.

```bash
# from repo root
npm run dev          # start web (:3000) + api (:4000)
npm run dev:api      # api only
npm run dev:web      # web only
npm run build        # tsc / next build across workspaces
npm run lint         # eslint across workspaces
npm run typecheck    # tsc --noEmit across workspaces

# Prisma (run from apps/api/ — config in prisma.config.ts, DB is PostgreSQL/Neon)
cd apps/api
npx prisma migrate dev --name <change>
npx prisma generate
```

**No test runner is installed yet.** Verification so far is done by driving the
running API with curl against mock GitHub / mock LLM servers (see §9).

---

## 4. Environment variables (`apps/api/.env`, gitignored)

Required: `DATABASE_URL`, `JWT_ACCESS_SECRET` (≥24 chars),
`GIT_TOKEN_ENCRYPTION_KEY` (base64-encoded **32-byte** key — validated at boot).
`PORT` defaults to 4000. Web reads `NEXT_PUBLIC_API_URL` (default
`http://localhost:4000`).

Added for provider integration (all have safe defaults / are optional):

| Var | Default | Purpose |
|-----|---------|---------|
| `GITHUB_API_BASE_URL` | `https://api.github.com` | overridable so tests point the GitHub provider at a mock |
| `OPENAI_API_KEY` | *(unset)* | LLM key. **If unset, reports fall back to a deterministic template** (no crash). |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | any OpenAI-compatible endpoint |
| `OPENAI_MODEL` | `gpt-4o-mini` | model id |
| `OPENCLAW_SERVICE_KEY` | *(unset)* | shared secret the OpenClaw plugin uses to call our tool endpoints (`x-openclaw-key` header) |
| `OPENCLAW_GATEWAY_URL` | *(unset)* | OpenClaw runtime base URL for the website chat proxy (e.g. `http://localhost:18789`) |
| `OPENCLAW_GATEWAY_TOKEN` | *(unset)* | bearer token for the gateway (server-side only) |

**Currently configured LLM:** Groq (OpenAI-compatible, free tier). The `.env` has:
`OPENAI_BASE_URL="https://api.groq.com/openai/v1"`,
`OPENAI_MODEL="llama-3.3-70b-versatile"`, and a Groq `gsk_...` key.
To swap providers, only change these three env vars (no code change) — e.g.
Gemini (`.../v1beta/openai`), Ollama (`http://localhost:11434/v1`), or OpenAI.

---

## 5. Backend architecture & conventions (`apps/api/src`)

Modular-by-feature under `modules/<feature>/` (`*.controller.ts` thin Express
router; `*.service.ts` business logic + Prisma; `*.schemas.ts` Zod).

**Conventions that are easy to get wrong — follow them:**
- **Imports use explicit `.js` extensions** even for `.ts` files (NodeNext ESM). The build breaks otherwise.
- Wrap async handlers in `asyncHandler(...)`; validate with a Zod schema's `.parse()` inline in the controller; throw `AppError(status, message, code)` from services for expected failures. `errorHandler` is the single place errors become responses (`ZodError → 400 VALIDATION_ERROR`, `AppError → status/code`, else 500).
- Import `env` from `config/env.ts`; never read `process.env` directly.
- **Prisma 7 driver-adapter:** `datasource` in `schema.prisma` has **no `url`** — the connection is supplied at runtime via `PrismaPg` in `config/database.ts` and to the CLI via `prisma.config.ts`. Do not add a `url`.
- Auth: JWT (7-day) via `requireAuth` middleware → sets `req.authUser` (`{ id, email, memberships }`). RBAC roles `OWNER | MANAGER | EMPLOYEE | ADMIN`.
- **Org-scoped permission checks:** `common/access/organization-access.ts` →
  `requireOrganizationMember(userId, orgId)` (any active member) and
  `requireOrganizationRole(userId, orgId, roles)`; `MANAGER_ROLES = [OWNER, MANAGER, ADMIN]` can manage; EMPLOYEE is read-only. Every write also records an `AuditLog` row.

**Cross-cutting modules added:**
- `common/crypto/token-cipher.ts` — AES-256-GCM `encryptToken`/`decryptToken`/`tokenLast4`. Format: `iv:authTag:ciphertext` (base64). PATs are **only** stored encrypted, never logged/returned/cached in plaintext.
- `modules/git-providers/git-provider.ts` — the `GitProvider` interface (validateCredential, listRepositories, listContributors, listCollaborators, listCommits, getCommitDetail) + normalized DTO types. `provider-registry.ts` resolves the impl by `GitProvider` enum.
- `modules/github/github.provider.ts` — GitHub REST implementation using global `fetch` (no HTTP dep). Paginated (100/page, 10-page cap, warns when capped). Bad token → `INVALID_CREDENTIAL`; empty repo → 204/409 handled.
- `modules/llm/` — `LLMProvider` interface + `OpenAIProvider` (OpenAI-compatible chat completions) + `llm-registry.ts`. Provider-agnostic per project rule ("never hardcode a single LLM provider"). `available` is true when a key is set; surfaces the provider's error message on failure.

**Feature modules:** `auth`, `organizations`, `projects`, `employees`,
`credentials` (git PAT), `repositories`, `activity` (commits), `contributors`,
`openclaw` (report orchestration), plus `git-providers`/`github`/`llm`.

### API routes (all under `/api`, all `requireAuth` unless noted)
```
auth:          POST /auth/register, POST /auth/login, GET /auth/me
organizations: GET /organizations
projects:      POST /projects, GET /projects, GET /projects/:id, PATCH /projects/:id,
               DELETE /projects/:id, POST /projects/:id/members, DELETE /projects/:id/members/:userId
employees:     GET /employees, POST /employees, GET /employees/:userId, PATCH /employees/:userId
git-credentials: GET, POST, POST /:id/validate, PATCH /:id/reconnect, DELETE /:id
repositories:  GET /repositories, POST /repositories/sync, POST /repositories/select,
               GET /repositories/:id, PATCH /repositories/:id, POST /repositories/:id/resync,
               DELETE /repositories/:id
activity:      POST /repositories/:id/activity (collect commits), GET /repositories/:id/activity (summary)
contributors:  GET /contributors?repositoryId=, GET /contributors/unmapped?repositoryId=,
               POST /contributors/discover, POST /contributors/:id/map, DELETE /contributors/:id/map,
               POST /contributors/:id/ignore
openclaw:      GET /openclaw/tools, POST /openclaw/reports/generate  (JWT)
               GET /openclaw/chat/status, POST /openclaw/chat        (JWT — website chat proxy)
               POST /openclaw/tools/generate-report, GET /openclaw/tools/context  (service-key)
reports:       GET /reports, GET /reports/:id                       (persisted report history)
reports:       GET /reports?organizationId=&reportType=&limit=, GET /reports/:id
```

---

## 6. Data model (Prisma) — models added on top of auth/org foundation

Applied migrations (in `apps/api/prisma/migrations/`):
`auth_organization_foundation`, `projects_and_project_members`, `git_credentials`,
`repositories`, `contributor_identity_mapping`, `commits_and_changed_files`,
`reports`.

- **User, Organization, OrganizationMember** (role + status), **RequestLog**, **AuditLog** — foundation.
- **Project**, **ProjectMember** (`ProjectStatus`, `ProjectRole` enums).
- **GitCredential** — `provider (GitProvider)`, `encryptedToken`, `tokenLast4`, `accountLogin`, `scopes`, `status (CredentialStatus)`, `lastValidatedAt`, `createdById`. Unique per `[organizationId, provider]`.
- **Repository** — `owner/name/fullName/remoteUrl/isPrivate/defaultBranch`, `externalId`, `projectId?`, `credentialId`, `lastSyncedAt`. Unique per `[organizationId, provider, externalId]`.
- **ContributorIdentity** — per-repo Git identity: `externalId`, `username`, `authorName?`, `authorEmail?`, `avatarUrl?`, `contributions`, `ignored`. Unique per `[repositoryId, externalId]`. One-to-one optional `mapping`.
- **EmployeeGitMapping** — maps `userId ↔ contributorIdentityId` (identity `@unique` → one identity → one employee).
- **Commit** — `sha`, `message`, `authorName/authorEmail/username`, `committedAt`, `additions`, `deletions`, `changedFilesCount`. Unique per `[repositoryId, sha]`. **ChangedFile** — per-file `filePath/status/additions/deletions/changes`.
- **Report** (Phase 11) — persisted generated report: `organizationId`, `requestedById?`, `reportType`, `targetLabel`, `repositoryId?/projectId?` (snapshot, no FK), `periodStart/End`, `title`, `markdownContent`, `statisticsJson`, `status` (`GENERATED|PARTIAL`), `generatedBy` (`llm|template`). **ReportContributor** — per-report contributor snapshot. Migration `20260709111500_reports`. Reads via `GET /api/reports` + `/api/reports/:id`.
- **Report** — immutable report snapshot: `reportType`, `targetLabel`,
  `repositoryId?`, `projectId?` (snapshot ids, no FK), `periodStart/End`,
  `title`, `markdownContent`, `statisticsJson`, `status`, `generatedBy`,
  `requestedById`, `createdAt`.
- **ReportContributor** — rows attached to saved reports for resolved employees
  (`userId?`, `contributorIdentityId?`, `name?`, `commitCount`).

Enums: `OrgRole`, `MemberStatus`, `UserStatus`, `ProjectStatus`, `ProjectRole`,
`GitProvider (GITHUB|GITLAB|BITBUCKET)`, `CredentialStatus (CONNECTED|INVALID|DISCONNECTED)`.

---

## 7. OpenClaw — important nuance (read before touching report generation)

The product docs say every report must flow through **OpenClaw**. "OpenClaw" is a
**real external framework** — <https://openclaw.ai> (`docs.openclaw.ai`): an
open-source, self-hosted AI-agent runtime that connects chat channels
(Telegram/Discord/Slack/…) to LLM agents, extended via a **plugin-sdk**
(`defineToolPlugin`, TypeBox schemas) and `SKILL.md` files. It exposes an HTTP API
(port 18789: `/v1/chat/completions`, `/tools/invoke`, bearer-token auth).

**What is built today:** an **in-repo orchestration stand-in** (`modules/openclaw/`)
that plays OpenClaw's role for the dashboard/website path:
- `openclaw.tools.ts` — the resolvable "tools": `resolve_project`, `resolve_employee`,
  `resolve_repository`, `resolve_period`, `fetch_git_activity` (real — aggregates
  stored commits), `generate_report` (LLM), `save_report` (real persistence),
  plus the prompt builder + template fallback.
- `openclaw.service.ts` — `orchestrateReport()`: resolves target/period → gathers
  real commit activity (filtered by employees' mapped Git usernames for
  employee/team reports) → calls the LLM to write the Markdown, or falls back to a
  deterministic template if no LLM is configured or the call errors (never crashes)
  → persists the generated report snapshot and returns `reportId`.
- Report `status`: `GENERATED` (LLM) or `PARTIAL` (template fallback).

**What is NOT built (future):** the real OpenClaw integration — running the external
OpenClaw runtime, a **DevInsight tool plugin** (using `openclaw/plugin-sdk`) whose
tools call the DevInsight backend, a backend↔OpenClaw HTTP bridge + service-key
auth, a `SKILL.md`, and chat channels (Telegram/Discord). Contract details were
researched: tools use **TypeBox** (not Zod); `package.json` needs an
`openclaw.extensions` entry; plugins are installed via `openclaw plugins install`.
When wiring this, the backend tool functions in `modules/openclaw` are exactly what
the plugin should call.

**Decision on record:** the user's priority was website-first + OpenAI/GPT, so the
LLM report generation was done directly in the backend (Phase 10) with a
provider-agnostic abstraction; the external OpenClaw runtime + chat channels are a
later, separate track.

---

## 8. Frontend (`apps/web/src`)

Next.js **16** App Router (⚠️ not the version in most training data — read
`node_modules/next/dist/docs/` before writing web code; heed deprecations).
Client-side data fetching via Axios (`lib/api.ts`, token auto-attached by a request
interceptor). Auth token in `localStorage` (`lib/auth-storage.ts`). `lib/use-session.ts`
is the shared session-guard hook. Design tokens/utility classes live in
`app/globals.css` (`glass`, `btn-gradient`, `text-gradient`, `field`, `animate-rise`).

⚠️ **Next.js 16 lint rule `react-hooks/set-state-in-effect`:** never call `setState`
synchronously from an effect. Data-loading effects use **`.then()` callbacks** (not
`async/await`) so `setState` stays deferred — see `use-session.ts` and the manager
components for the pattern. Copy it.

Dashboard shell = `components/dashboard/dashboard-chrome.tsx` (nav: Overview,
Projects, Employees, Repos, Contributors, Reports, Git). Pages under
`app/dashboard/*` render manager components in `components/<area>/*-manager.tsx`.
Reports page (`components/reports/reports-manager.tsx`) posts a structured request to
`/api/openclaw/reports/generate`, renders the returned Markdown, and shows saved
report history from `/api/reports`.
Report types: `repository | project | employee | team`; periods:
`today | last_7_days | last_30_days | custom` (custom needs a from/to range).

Reports use `react-markdown` + `remark-gfm` and `.report-md` styles in
`app/globals.css`; saved report detail reuses the same renderer.

---

## 9. How to test / verify (no test runner yet)

The pattern used: run the API against **mock servers** so no real credentials/quota
are needed. Mock scripts live in the session scratchpad (not committed) — recreate as
needed:
- **Mock GitHub** on `:4999` serving `/user`, `/user/repos`, `/repos/:o/:r/contributors`,
  `.../collaborators`, `.../commits`, `.../commits/:sha`. A token containing
  `goodtoken` is "valid". Start API with `GITHUB_API_BASE_URL=http://localhost:4999`.
- **Mock LLM** on `:4998` serving `POST /chat/completions` (OpenAI shape). Start API
  with `OPENAI_API_KEY=test OPENAI_BASE_URL=http://localhost:4998`.

Typical flow: register → connect credential (`goodtoken`) → sync + select repo →
collect activity → discover + map contributors → `POST /api/openclaw/reports/generate`
→ assert real stats + `status: GENERATED` (with LLM) or `PARTIAL` (without).
Always `git status` and kill background `tsx`/mock processes when done.

Before committing nontrivial changes: `npm run typecheck` + `npm run lint` +
`npm run build` for both workspaces (all currently pass).

---

## 10. Remaining roadmap & recommended next steps

Recommended order:
1. **Phase 9 — Report engine** — classify commits (feature/fix/chore from messages
   + file categories), risk detection, richer statistics; feed into the LLM prompt.
2. **Real OpenClaw integration (§7)** — external runtime + DevInsight tool plugin +
   HTTP bridge + service-key auth + `SKILL.md`, then Telegram/Discord channels.
3. **Phase 13 Statistics dashboard, Phase 14 Sharing, Phase 15 Tests
   (set up Vitest/Supertest first), Phase 16 Deployment (Docker).**

### Guardrails to preserve
- PATs encrypted at rest; never log/return/cache plaintext tokens.
- Keep GitHub logic behind `GitProvider`; keep LLM behind `LLMProvider`.
- Every report path stays resilient: if the LLM isn't configured/errors, fall back
  to the template — never fail the request.
- Backend `.js` import extensions; frontend `.then`-in-effect pattern; Prisma no-`url`.

---

## 11. Next phases — implementation blueprints

Concrete, pattern-matching plans for the next items. Follow the existing module
conventions (§5) and frontend patterns (§8). After each: `npm run typecheck && npm
run lint && npm run build` for both workspaces, then drive it via the running app.

### 11.1 Completed — Markdown rendering polish

Reports now use `react-markdown` + `remark-gfm`; `.report-md` in
`apps/web/src/app/globals.css` styles headings, lists, strong text, code,
blockquote, links, and tables.

### 11.2 Completed — Report persistence + history

Phase 11 is implemented:
- Prisma migration `20260709111500_reports` adds `Report` and
  `ReportContributor`.
- `modules/reports/` exposes `GET /api/reports` and `GET /api/reports/:id`.
- `openclaw.service.ts` saves every generated/template report and returns
  `reportId`.
- `components/reports/reports-manager.tsx` shows saved report history and loads
  saved details into the same Markdown preview.

### 11.3 Completed — Phase 9 Report engine (richer signal for the LLM)

Done (verified — categories/modules/risks correct on mock data):
- `modules/report-engine/commit-classifier.ts` — pure helpers: `classifyCommit`
  (conventional-commit prefix + keyword fallback → Feature/Fix/Refactor/Docs/Test/
  Chore/Perf/Build/Other), `hasRiskKeyword`, `isSensitivePath`, `moduleFromPath`.
- `activity.service.ts` `analyzeActivity(query)` (reuses `buildCommitWhere`, capped) →
  `{ categories, topModules, risks }`: category tally, top modules by changes, and
  risk signals (risky-keyword commits, unusually large commits, sensitive-path hits).
- `openclaw.tools.ts` — `ReportContext.analysis` + `buildReportPrompt` now includes a
  work breakdown, most-changed areas, and risk signals so the LLM narrative is grounded.
- `openclaw.service.ts` — `orchestrateReport` calls `analyzeActivity` and returns
  `analysis` on the report response.
- Optional follow-up: persist `analysis` in `Report.statisticsJson`; add a dedicated
  `risk` report type; add `category`/`module` columns to `ChangedFile`.

### 11.4 Real OpenClaw integration (external runtime) — IN PROGRESS

Goal: route the **website chat box** first, then chat (Telegram/Discord) report
requests, through the real OpenClaw runtime, reusing the backend tools. Order:
website chat → Telegram → Discord (each later channel is just OpenClaw config, no
rework). Contract (researched, see §7).

**✅ DONE — Milestone 1: backend foundation** (verified with mock GitHub + a mock
gateway; no OpenClaw runtime required to build/test):
- `env.ts`: `OPENCLAW_SERVICE_KEY`, `OPENCLAW_GATEWAY_URL`, `OPENCLAW_GATEWAY_TOKEN`
  (all optional; features degrade gracefully when unset).
- `openclaw.middleware.ts` — `requireServiceKey` (timing-safe `x-openclaw-key` check).
- `openclaw.service-tools.controller.ts` — service-key tool endpoints:
  `POST /api/openclaw/tools/generate-report` (body has `requesterId` + the report
  input; wraps `orchestrateReport`, still enforces org membership → 403 for
  non-members) and `GET /api/openclaw/tools/context` (repos/projects/employees for
  name resolution). Mounted **before** the JWT `openclawRouter` at `/api/openclaw`,
  using **per-route** `requireServiceKey` so non-matching paths fall through.
- `openclaw.gateway.ts` + controller — `POST /api/openclaw/chat` (JWT: browser sends
  `{organizationId, message}`, backend enforces membership, forwards to the gateway
  `/v1/chat/completions` with the server-side token + org/requester context) and
  `GET /api/openclaw/chat/status` (so the UI knows if chat is available). Returns a
  clear 503 when the gateway isn't configured.

**✅ DONE — Milestone 1b: frontend chat box.** `lib/api.ts` `getChatStatus()` +
`sendAssistantMessage()`; `components/openclaw/chat-widget.tsx` (floating widget,
bottom-right, rendered inside `dashboard-chrome.tsx` so it's on every dashboard
page). Shows a "not connected" state until `OPENCLAW_GATEWAY_URL`/`TOKEN` are set;
renders assistant replies with `react-markdown` (`.report-md`). typecheck/lint/build
pass. **Next: the OpenClaw runtime + plugin + channels below.**

<details><summary>Original 1b plan (for reference)</summary>
1. **Frontend chat box** (Milestone 1b). Concrete plan:
   - `lib/api.ts`: add `getChatStatus()` → `GET /api/openclaw/chat/status` (returns
     `boolean`), and `sendAssistantMessage(organizationId, message)` →
     `POST /api/openclaw/chat` (returns `reply` string). (Interceptor already adds the
     JWT; follow the existing helper style; `getApiErrorMessage` exists for errors.)
   - `components/openclaw/chat-widget.tsx` (client) — a **floating widget** (fixed
     bottom-right button → glass panel). Gets `organizationId` from `useSession()`
     (`activeOrganization`). On mount, call `getChatStatus()` (via a `.then` effect to
     respect the `set-state-in-effect` rule). States: `loading` (spinner), `unconfigured`
     (friendly "assistant will be available once OpenClaw is connected", input disabled),
     `configured` (chat UI: message list of `{role:'user'|'assistant', content}`, input +
     send). On send: append the user message, `POST /chat`, append the assistant reply
     (render with the existing `react-markdown` + `remark-gfm`); on error use
     `getApiErrorMessage`. Use the design tokens (`glass`, `btn-gradient`, `field`,
     `--text/--muted/--accent`) and lucide icons (`MessageCircle`, `Send`, `X`, `Loader2`).
   - Render `<ChatWidget />` inside `components/dashboard/dashboard-chrome.tsx` (it's
     `position: fixed`, so it appears on every dashboard page). No nav item needed.
   - Verify: `npm run typecheck && lint && build` for web; the widget shows the
     "not connected" state until `OPENCLAW_GATEWAY_URL`/`TOKEN` are set on the API.
</details>

2. **DevInsight OpenClaw plugin — WRITTEN (verify-pending on the runtime).** Lives in
   `integrations/devinsight-openclaw-plugin/` (NOT an app workspace — deployed into
   OpenClaw). `defineToolPlugin` (TypeBox), config `{serviceUrl, apiKey, organizationId,
   requesterId}`, tools `devinsight_context` + `devinsight_generate_report` calling
   `/api/openclaw/tools/*` with `x-openclaw-key`. **Not compiled against OpenClaw types
   here** — the operator runs `npm install && npm run build` in that dir and fixes any
   SDK-API mismatch (esp. the `defineToolPlugin` import path), then `openclaw plugins
   install <path>` + configures the 4 keys. See its `README.md`.
3. **Backend chat proxy** — DONE (§11.4 Milestone 1: `POST /api/openclaw/chat` already
   forwards to the gateway `/v1/chat/completions` with `model: "openclaw:main"`). The
   dashboard form still uses the in-repo orchestrator; only the chat box uses OpenClaw.
4. **`SKILL.md`** — WRITTEN at `integrations/devinsight-openclaw-plugin/SKILL.md`
   (teaches the agent to resolve names via `devinsight_context`, then call
   `devinsight_generate_report`, and relay the Markdown).
5. **Channels** — configure Telegram/Discord in OpenClaw so managers can request
   reports by chat (`Chat → OpenClaw → DevInsight tools → report`). Not started.

**✅ STATUS — chat → REPORTS is LIVE end-to-end (verified on real data).** Full chain:
`chat box → /api/openclaw/chat → OpenClaw gateway (Docker, GLM-5.2) → agent →
DevInsight MCP server → /api/openclaw/tools/* → real Git report (with Phase 9
breakdown + risk signals) → chat`. Natural requests work ("give me this month's report
for the backend repo") — the agent picks the tools itself; **no SKILL needed**.

How it was wired (this machine):
- OpenClaw in Docker: repo cloned to `../openclaw`, image `ghcr.io/openclaw/openclaw:latest`,
  gateway on 18789. LLM = **Z.ai GLM-5.2** on the **Coding Plan endpoint** (see
  `docs/OPENCLAW_SETUP.md`). OpenAI-compat HTTP endpoint enabled
  (`gateway.http.endpoints.chatCompletions`). Chat model alias = `openclaw/default`.
- **Report tools via an MCP server, NOT the TS plugin.** `integrations/devinsight-mcp-server/`
  (streamable-HTTP, host-run on :4100) exposes `devinsight_context` +
  `devinsight_generate_report` calling `/api/openclaw/tools/*`. Registered with
  `openclaw mcp set devinsight '{"url":"http://host.docker.internal:4100/mcp","transport":"streamable-http"}'`.
  The `../devinsight-openclaw-plugin/` (TS plugin) was superseded by this — kept for reference.

**To run the whole thing** (see `docs/OPENCLAW_SETUP.md` §"Run everything"): OpenClaw
(Docker, persistent) + DevInsight `npm run dev` (web+api) + `integrations/devinsight-mcp-server/run.sh`.
MVP is **single-org** (the MCP server is pinned to one org/requester via `run.sh`).

Prereqs from the operator: run OpenClaw self-hosted (Docker) — **step-by-step guide in
`docs/OPENCLAW_SETUP.md`** (clone openclaw repo → `./scripts/docker/setup.sh` → set the
Groq `models.openaiCompatible` provider → copy the gateway token + set
`OPENCLAW_SERVICE_KEY` into `apps/api/.env`). Gateway is on port 18789. Once the
operator has done that, the **next assistant task is the DevInsight tool plugin +
`SKILL.md`** so the chat box goes live. Networking (dev): DevInsight backend → gateway
= `http://localhost:18789`; plugin (in container) → DevInsight API = `http://host.docker.internal:4000`.

### 11.5 Later — Statistics (13), Sharing (14), Tests (15), Deployment (16)

- **Statistics dashboard — ✅ DONE (Phase 13, 2026-07-10).** Backend module
  `apps/api/src/modules/statistics/` — `GET /api/statistics/overview?organizationId=&period=`
  (JWT + org-member). `getStatisticsOverview` aggregates stored commits for the org over a
  period (reuses `resolvePeriod`, `buildEmployeeLeaderboard`, `analyzeActivity`): headline
  totals (commits, +/- lines, files, active repos, distinct contributors), a **gap-filled
  daily commit series**, top contributors, per-repository + per-project breakdowns, and the
  work-breakdown/risk summary. Reads only the DB — never hits Git. Frontend: the **Overview
  page IS the dashboard now** (`components/statistics/statistics-dashboard.tsx` replaced
  `dashboard-shell.tsx`, which was deleted) — period selector + KPI tiles + charts.
  Charts are dependency-free `components/statistics/charts.tsx`: `StatTile`, `BarList`
  (single-hue horizontal bars), `AreaChart` (SVG area+line, hover crosshair/tooltip) — all
  single-series indigo (`--accent`), text in text tokens, recessive grid, per dataviz-skill
  guidance. `getStatisticsOverview` + types in web `api.ts`. Typecheck + lint clean.
- **Sharing**: `ReportShare` model + share action + channel placeholders.
- **Tests**: set up Vitest + Supertest first (none installed). Unit-test
  `token-cipher`, permission helpers, commit classification; integration-test the
  report flow with a mocked GitProvider/LLMProvider.
- **Deployment**: Dockerfiles (web, api) + `docker-compose.yml` (add postgres) +
  production env guide.

### 11.6 Smart Data & Reporting Engine (agreed plan, in progress)

Goal (from product owner): reports over **any date window** (not just last 90 days) —
e.g. the first 90 days of a year, a specific month, an arbitrary `from→to`. A report
request must be **self-sufficient**: the backend decides whether the requested range
is already in the DB (serve from DB, no Git call) or must be collected first
(auto-collect only the missing sub-range from Git, using the org's stored credential —
never a personal PAT). Generated reports are cached so identical requests skip the LLM.
Plus multi-branch awareness, deep/background history, and a per-employee leaderboard.
**Key architectural decision: the "decide / auto-collect / cache" logic lives in the
DevInsight backend report service — NOT in the MCP server or OpenClaw.** OpenClaw just
asks; the backend is smart, so every channel (dashboard, chat, future Telegram) benefits.

Phases (build in this order, small & verifiable, update this doc after each):

- **A — Flexible date range everywhere — ✅ DONE.**
  - `periodSchema` (`openclaw.schemas.ts`) + `ReportPeriod` (web `api.ts`) now include
    `last_90_days`, `this_month`, `last_month` (plus existing `custom` `{from,to}`).
  - `resolvePeriod` (`openclaw.tools.ts`) computes the new windows (month math handles
    year boundary; `last_month` = full previous calendar month).
  - MCP tool `devinsight_generate_report` (`integrations/devinsight-mcp-server/server.mjs`)
    exposes all periods **+ `customRange`**, so the chat agent can request any window
    ("Jan 1 to Mar 31"). Frontend `PERIODS` selector lists the new options.
  - Verified: `npm run typecheck` clean (all workspaces); date-math sanity-checked.
- **B — Coverage ledger — ✅ DONE.**
  - New model `RepositoryCoverage` (repositoryId, branch, rangeStart, rangeEnd,
    commitCount, collectedAt) — migration `repository_coverage` applied.
  - Pure interval math in `apps/api/src/modules/activity/coverage.ts`:
    `mergeIntervals` (compact, non-overlapping) + `subtractCovered(from, to, covered)`
    (returns uncovered sub-ranges). Sanity-checked on 6 edge cases incl. "ask 15 days
    when 30 days already collected → fully covered, no Git call".
  - `activity.service.ts`: `recordCoverage(repoId, branch, since, until)` merges the
    window into the ledger (branch = `coverageBranch(repo)` = defaultBranch ?? "default");
    `getMissingRanges(repoId, branch, from, until)` returns the gaps for Phase C.
  - `collectActivity` records coverage **only when the run was not detail-capped**
    (a capped run left commits unfetched, so the range stays "missing"); returns
    `coverageRecorded`. Reminder: run `npx prisma generate` after schema edits or tsc
    won't see the new model.
- **C — Smart report engine — ✅ DONE.**
  - `activity.service.ts`: extracted `ingestCommitRange(repo, token, provider, since,
    until)` (core fetch+store+coverage, no access checks — shared by manual collect and
    auto-collect). New `ensureActivityCollected(scope, from, until)`: resolves the repos
    a report touches (`resolveScopeRepositories`: repository → project's repos →
    employees' mapped repos → all org repos) and, per repo, fetches ONLY the ledger's
    missing sub-ranges from Git using the **org's stored credential**. Resilient:
    per-repo try/catch, a repo with no credential / a Git error is skipped with a
    warning so the report is still produced from stored data.
  - `reports.service.ts`: `Report.dataFingerprint` column (migration
    `report_data_fingerprint`) + `findCachedReport(...)` — reuses a prior **LLM**
    report when scope + day-bucketed period + fingerprint all match (skips the LLM).
  - `openclaw.service.ts` `orchestrateReport`: now (1) `ensureActivityCollected`
    BEFORE reading the DB, (2) computes `computeFingerprint(activity)` =
    `c{commits}-a{adds}-d{dels}-f{files}`, (3) on a cache hit returns the saved report
    (no LLM), else generates + saves with the fingerprint. Custom prompts always
    regenerate. Response gained `cached: boolean` + `collection` summary
    (`repositoriesChecked`, `rangesCollected`, `warnings`).
  - Behaviour: **fixed past ranges** (e.g. `last_month`, custom `from→to`) → repeat
    request does ZERO Git calls + ZERO LLM. **Relative windows** (`today`,
    `last_30_days`) → one cheap `listCommits` per repo to collect the fresh tail; if no
    new commits, fingerprint is unchanged → cache hit (no LLM). "Ask last-15 when
    last-30 is collected" → served from DB (only a tiny tail fetch). Verified via
    typecheck + lint + 4 cache-decision logic checks.
  - Note: report auto-collect is gated only by `requireOrganizationMember` (any member
    who can request the report), and always uses the org credential — not the manual
    collect endpoint's MANAGER-role check. Intentional (report data is org-visible).
- **D — Multi-branch — ✅ DONE.**
  - `GitProvider.listBranches` + GitHub impl (`GitBranch` = name/headSha/isProtected,
    paginated). New models `Branch` (per repo; isDefault/headSha/isProtected) +
    `CommitBranch` join (migration `branches_and_commit_branch`). A commit's SHA is
    stored once (deduped); `CommitBranch` records every branch it is reachable from,
    so a commit merged into several branches is **not double-counted** in reports.
  - `activity.service.ts` ingestion is now branch-aware: `syncBranches` (upserts Branch
    rows, default first, capped at `MAX_BRANCHES = 25`), `ingestBranchRange` (collects a
    branch's window, links stored commits via `CommitBranch`, per-branch coverage),
    `ingestRepository` (drives all branches; **fast-path: 0 Git calls when every known
    branch already covers the window** — preserves "fixed-range repeat = no Git"). Both
    manual `collectActivity` and report auto-collect (`ensureActivityCollected`) use it.
  - Coverage ledger is now keyed by the **real branch name** (Phase B/C used
    `defaultBranch ?? "default"`; `coverageBranch` helper removed). Old coverage rows are
    harmless — at worst a one-time re-collect.
  - Visibility: `getRepositoryBranches` + `GET /api/repositories/:id/branches` (branches
    with per-branch commit counts). `collectActivity` response now returns
    `newCollected` + `branchesChecked`/`branchesCollected`/`rangesCollected` (web
    `CollectActivityResult` + the collect toast updated).
  - **Product note:** reports/aggregates read the Commit table across ALL branches
    (deduped) — so in-progress (unmerged) work is now included, which is intended. A
    branch-filtered report (via `CommitBranch`) is a future option (relevant to Phase F).
    Typecheck + lint clean.
- **E — Background deep-history collection**: move collection to an in-process worker
  (Redis later), paginate full 1–2yr history respecting GitHub rate limits, lift the
  150-detail cap; progress/status tracking + UI.
- **F — Per-employee project report (leaderboard) — ✅ DONE.**
  - `activity.service.ts` `buildEmployeeLeaderboard(query)`: `commit.groupBy(username)`
    for stats, folds **multiple Git usernames of the same mapped employee together**
    (via `EmployeeGitMapping`), ranks by **lines changed (additions+deletions)**, and
    attaches a few recent commit messages per person. Unmapped usernames appear under
    their own name (`mapped: false`); null-username commits bucket as "Unknown".
    Returns `EmployeeLeaderboardRow[]` (rank, name, usernames, commits, +/-, lines,
    sampleMessages). Works for any scope (project/repository/team/employee) — the
    report's `buildCommitWhere` filter applies.
  - `openclaw.tools.ts`: `ReportContext.leaderboard` feeds the prompt (LLM is told to
    write a ranked "## Who did what" section — most-active first, one line each on what
    they worked on) and the **template fallback renders a deterministic Markdown table**,
    so the ranked view is guaranteed even without an LLM.
  - `orchestrateReport` computes the leaderboard once (before the cache check) and
    returns it structured (`leaderboard`) on both the cache-hit and generated paths; web
    `GeneratedReport.leaderboard` + `EmployeeLeaderboardRow` typed. It renders inside the
    report Markdown (shows live + in history + in chat via the existing `.report-md`
    table styling — no duplicate UI table). Verified: typecheck + lint clean; merge/rank
    logic checked (two usernames → one employee, ranked by lines).
  - Follow-on: branch-filtered leaderboards (Phase D's `CommitBranch`) + a dedicated
    chart UI belong with Statistics (Phase 13).

**UX fix (2026-07-09):** opening a saved report from History now syncs the generate
form to it (`syncFormToReport` in `reports-manager.tsx` — report type, repo/project,
employee selection from contributors, and period shown as a custom range since only
exact dates are stored). Previously the form kept its old selection while the panel
showed a different saved report.

**UI redesign — lightweight, sidebar layout (2026-07-09):** replaced the heavy
glassmorphism look (animated aurora orbs, backdrop-blur, gradient shadows) with a flat,
professional design and a persistent **sidebar + header + main** shell.
- `globals.css`: new flat token palette (solid `--surface`/`--border`, subtle
  `--card-shadow`, indigo `--accent`; `--card-shadow`/`--accent-soft`/`--btn` tokens),
  light+dark. Utility classes `.glass`/`.glass-soft`/`.glass-hover`/`.btn-gradient`/
  `.field` redefined to flat (no blur) so **all pages restyle without per-page edits**.
  Added `.nav-link`/`.nav-link-active` + `.theme-icon-*`. Removed `.aurora`/`.orb-*` +
  the body grid overlay.
- Shell lives in `app/dashboard/layout.tsx` (persistent) → `DashboardSidebar`
  (vertical nav + logo + user/logout) + `DashboardTopbar` (page title + org + theme
  toggle) + `<main>` (max-w-7xl). Mobile: sidebar becomes a drawer.
  `DashboardChrome` is now a pass-through (`email`/`onLogout` props kept optional so the
  page managers compile unchanged); `ChatWidget` moved into the layout.
- Theme: `theme-provider.tsx` now exposes a `useTheme()` context (no aurora/global
  button); `theme/theme-toggle.tsx` renders both icons with CSS visibility keyed on
  `[data-theme]` (identical server/client HTML → no hydration mismatch). The toggle sits
  in the dashboard header and in `PublicNav` (landing + login).
- Verified: typecheck + lint clean; all routes 200; hydration error gone. Per-page
  spacing/rounding can still be tightened iteratively.

**UI polish round 2 (2026-07-09):**
- Theme toggle rewritten to be hydration-safe via `useSyncExternalStore` (renders a
  stable icon during SSR + first client render, then the real theme icon) — single
  correct icon, no set-state-in-effect, no mismatch. Removed the `.theme-icon-*` CSS.
- **Card lists → tables:** Employees and Repositories manager lists are now real
  `<table>`s (Member/Status/Role/Actions; Repository/Visibility/Project/Actions) inside a
  `.glass` container, instead of stacked cards.
- **Tightened form density** across projects/reports/git/contributors/overview: card
  radius `rounded-[2rem]`/`[2.25rem]` → `rounded-xl`, padding `p-6 md:p-7` → `p-5`,
  headings `text-3xl`/`text-4xl…md:text-6xl` → `text-xl`/`text-2xl…md:text-3xl`, buttons
  `rounded-2xl px-5 py-3.5 font-black` → `rounded-lg px-4 py-2.5 font-bold`, and the
  shared `fieldClass` → `rounded-lg px-3.5 py-2.5 text-sm`. Typecheck + lint clean.

Note (Phase A follow-up): `collectActivity`'s `DEFAULT_LOOKBACK_DAYS = 90` in
`activity.service.ts` is still the fallback when a collect call omits a range; Phase C
drives collection with explicit ranges, so this becomes a fallback-only default.
