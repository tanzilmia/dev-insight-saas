# DevInsight AI — Project State & Handoff

> **Purpose of this file:** a single, self-contained context document so any AI
> coding agent (Codex, Claude, etc.) can pick up the project with full context.
> It records **what the product is, what has been built, how it works, the key
> decisions, and what remains**. Keep it updated as work continues.
>
> Last updated: 2026-07-20.

## 0.1 Current analysis handoff

The exhaustive current-code audit and API contract reference is now available at
docs/DEVINSIGHT_PROJECT_ANALYSIS_FOR_CHATGPT.md. It documents the implemented
frontend features, backend modules, all 97 current HTTP routes, request/query
validation, response DTO shapes, authentication boundaries, database models,
report pipeline, integrations, tests, and known stale-doc mismatches. Future AI
agents should read it together with this file and CLAUDE.md.

---

## 0. Current production architecture override (2026-07-17)

The GitHub integration is now **GitHub App-only**. This section supersedes older
chronological notes below that describe the retired customer PAT/repository-picker
path; those notes remain as implementation history, not current behavior.

- Customer repository access uses short-lived installation tokens from
  `GitHubAppInstallation` + tenant-scoped `RepositoryAccess`. There is no
  `GitCredential` model, `/api/git-credentials`, PAT UI, PAT fallback, or
  per-repository webhook registration.
- Repositories selected in GitHub are reconciled automatically on App link,
  App Sync, and installation repository events. GitHub selection is the source
  of truth; DevInside no longer exposes local select/untrack or live-toggle APIs.
- Every selected repo gets one persistent, system-owned 90-day `CollectionJob`
  (`verify=true`), covering all GitHub branches up to the existing 25-branch cap.
  The worker also refreshes contributor identities/alias mappings before the
  onboarding job completes.
- `POST /api/webhooks/github-app` is the only GitHub webhook endpoint. Its raw
  body is verified with `GITHUB_APP_WEBHOOK_SECRET`; `push` deliveries are
  tenant-mapped by installation ID + organization + numeric repository ID +
  `appInstallationId` + active access grant, acknowledged with `202`, then
  processed through a per-repository FIFO. Exact pushed SHAs/branches/details
  update Neon, missing contributors are discovered, SHA uniqueness makes
  redelivery idempotent, and `webhookStatus`/`lastWebhookAt` expose health.
- GitHub username resolution moved to `GET /api/github-app/resolve-user`.
- Destructive migration `20260717090000_github_app_only` deletes every repository
  without a matching same-tenant active App grant and its local repository-scoped
  data, then drops `GitCredential`, `CredentialStatus`, `Repository.credentialId`,
  `webhookExternalId`, and `webhookSecret`. `Repository.appInstallationId` is now
  required with `ON DELETE CASCADE`. Runtime App deselect/disconnect/uninstall
  applies the same transactional cleanup rules.
- Bot commit exclusion (2026-07-20): a shared GitHub bot-identity predicate now
  filters `[bot]` usernames and known service accounts before commit details,
  `Commit`, `ChangedFile`, or `CommitBranch` rows are written. The filter is
  active for push webhooks, manual/automatic collection, and backfills. Branch
  head metadata still advances on bot-only pushes; historical bot rows are kept
  and are not deleted by this behavior change.
- `PUBLIC_API_URL` was removed. The public App webhook URL is configured once in
  GitHub as `https://devinside.softathena.com/api/webhooks/github-app`.
- Production is live at `https://devinside.softathena.com` on the Docker/nginx VPS;
  Neon remains the application database and SonarQube is served at `/sonarqube`.
- Rollout operator steps after deploying this commit: enable the GitHub App
  **Push** event, re-approve any updated App permissions, run App Sync, watch the
  90-day jobs, and verify one pushed test commit plus a `202` delivery.

Verification added for this change: App-only token/grant resolution, App push
tenant routing, rapid-push FIFO preservation, initial-backfill fields/idempotency,
existing HMAC tests, and a disposable PGlite migration test that applies every
prior migration, seeds App/PAT/orphan data, runs the destructive migration, and
asserts data/schema cleanup. The standard release gate remains Prisma generate/
validate, typecheck, lint, full tests, and production builds.

Local release gate result: Prisma generate/validate passed; API/web/shared
typecheck passed; API/web lint passed; **23 test files / 153 tests passed**; API,
Next.js, and shared production builds passed.

### Hosted OpenClaw + private MCP rollout (2026-07-17)

The hosted gateway, private MCP bridge, and restricted nginx ingress are live on
the VPS. The active provider was restored to the paid Z.AI Coding Plan after the
temporary Groq route exhausted its separate organization quota.

- `openclaw-gateway` now follows the official `/home/node/.openclaw` persistent
  layout, starts explicitly in local/lan mode, has a health check, and exposes
  port 18789 only to the Compose network. `mcp` is health-checked and stays
  internal on 4100. A separate one-off `openclaw-cli` profile shares the state
  without being started by the normal `openclaw` profile.
- nginx publishes only `POST /openclaw/v1/chat/completions` (Bearer-authenticated
  by OpenClaw, streaming, rate-limited) and `GET /openclaw/healthz`. Every other
  `/openclaw` path is `404`; the Control UI, WebSockets, MCP, and direct gateway
  port are not public.
- Hosted API config uses `OPENCLAW_GATEWAY_URL=http://openclaw-gateway:18789`.
  Local API config uses `https://devinside.softathena.com/openclaw` with the same
  gateway token and context-signing secret, so local chat reaches hosted
  OpenClaw → private MCP → VPS API and verifies against shared Neon identities.
- OpenClaw uses its official Z.AI provider (`ZAI_API_KEY`, paid Coding Plan) with
  `zai/glm-5.2`. The DevInsight API report writer uses the same key through the
  Global Coding Plan OpenAI-compatible endpoint.
- The one-off production secret rotation script atomically replaces the gateway,
  service, MCP, and context secrets without printing values. The previously
  shared gateway/service values must not be reused.
- Operator guide: `docs/OPENCLAW_SETUP.md`; design:
  `docs/superpowers/specs/2026-07-17-hosted-openclaw-gateway-design.md`.
- Release gate after the Z.AI restoration and streamed-error guard:
  API/web/shared typecheck, API/web lint, all production builds, and **26 test
  files / 160 tests** pass. Production logs confirm `zai/glm-5.2` with thinking
  disabled; the remaining acceptance checks are authenticated chat and a real
  report request. The Z.AI report writer also explicitly disables thinking so
  its response budget produces visible Markdown instead of reasoning-only output.

---

## 1. What this product is

**DevInsight AI** — an AI-powered developer-intelligence / team work-report SaaS.
Managers connect the DevInside GitHub App, select repositories in GitHub, map Git
contributors to employees, collect commit activity, and generate **AI-written
work reports** ("what did this repo / person / team ship this period?") from real
Git data.

Core value chain (all of this is **working end-to-end today on real data**):

```
GitHub App selection → automatic backfill + signed push sync → contributor mapping →
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
| 4 | Legacy Git credential management | 🗑️ retired; GitHub App-only |
| 5 | App repository reconciliation + automatic 90-day/live push sync | ✅ done |
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

**Code Quality (SonarQube) — DONE (local dogfood), multi-tenant NEXT:** self-hosted
SonarQube Community Edition (Docker) is wired end-to-end — a `CodeQualityProvider`
abstraction (SonarCloud-swap-ready) feeds a per-developer **Code Quality** dashboard
page, plus a pre-push git hook that auto-scans in the background. Full details and
the remaining client-repo provisioning plan in **§12**.

**Public landing page (2026-07-20):** the root Next.js page now follows a
“Signal → Story” narrative with a product preview, trust strip, Connect → Collect
→ Understand → Act workflow, outcome cards, capability grid, and closing CTA. It
remains static, theme-aware, responsive, and uses only existing local routes and
Lucide icons.

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

Vitest is installed for the API. Run `npm test`; repository-wide release checks
also include typecheck, lint, and production builds.

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
| `OPENCLAW_CONTEXT_SIGNING_SECRET` | *(unset)* | API-only secret used to sign ten-minute tenant context; never shared with OpenClaw/MCP |
| `MCP_ACCESS_TOKEN` | *(unset)* | bearer credential OpenClaw sends to the standalone MCP HTTP endpoint |
| `OPENCLAW_GATEWAY_URL` | *(unset)* | OpenClaw runtime base URL for the website chat proxy (e.g. `http://localhost:18789`) |
| `OPENCLAW_GATEWAY_TOKEN` | *(unset)* | bearer token for the gateway (server-side only) |
| `CODE_QUALITY_PROVIDER` | `sonarqube` | code-quality provider selector (SonarCloud slots in behind the same interface) |
| `SONAR_BASE_URL` | `http://localhost:9000` | SonarQube (or SonarCloud) base URL |
| `SONAR_TOKEN` | *(unset)* | server-side token to read the SonarQube Web API. **Unset → Code Quality page shows "not connected"** (graceful, like the LLM fallback) |
| `SONAR_ORGANIZATION` | *(unset)* | empty for self-hosted; set for SonarCloud (also flips on branch/PR capabilities) |

**Currently configured LLM:** Z.AI Coding Plan (OpenAI-compatible). The `.env` has:
`OPENAI_BASE_URL="https://api.z.ai/api/coding/paas/v4"`,
`OPENAI_MODEL="glm-5.2"`, and the paid Z.AI key.
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
- **Unified Docker project:** root `compose.yml` includes both
  `docker-compose.sonar.yml` and `../openclaw/docker-compose.yml` under the explicit
  project name `devinsight`. OpenClaw's `.env`, source, and host-mounted state remain in
  the sibling repository. `npm run docker:up` starts SonarDB, SonarQube, and only the
  long-running gateway; `npm run docker:down` stops them without deleting data;
  `npm run docker:openclaw:cli -- <args>` runs the helper CLI as a one-off container.
- **Report tools via an MCP server, NOT the TS plugin.** `integrations/devinsight-mcp-server/`
  (streamable-HTTP, host-run on :4100) exposes `devinsight_context` +
  `devinsight_generate_report` calling `/api/openclaw/tools/*`. Registered with
  `openclaw mcp set devinsight '{"url":"http://host.docker.internal:4100/mcp","transport":"streamable-http","headers":{"Authorization":"Bearer ${DEVINSIGHT_MCP_TOKEN}"}}'`;
  the ignored OpenClaw `.env` supplies `DEVINSIGHT_MCP_TOKEN`.
  The `../devinsight-openclaw-plugin/` (TS plugin) was superseded by this — kept for reference.

**To run the whole thing** (see `docs/OPENCLAW_SETUP.md` §"Run everything"):
`npm run docker:up` (SonarQube + OpenClaw, persistent) + DevInsight `npm run dev`
(web+api) + `integrations/devinsight-mcp-server/run.sh`.
MCP tenant identity is now **per website-chat request** via a ten-minute API-signed
context token. The bridge has no fixed organization/requester fallback.

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
- **Scheduled reports — ✅ DONE (Phase 14a, 2026-07-09).** `ReportSchedule` model + enum
  `ScheduleCadence` (DAILY/WEEKLY/MONTHLY) (migration `report_schedules`). Backend module
  `apps/api/src/modules/schedules/`: CRUD + `runScheduleNow` + `runDueSchedules` (service),
  `computeNextRun` per cadence, and an **in-process scheduler** (`scheduler.ts`,
  `setInterval` every 60s, `startScheduler()` called from `main.ts` after listen). Due
  schedules run `orchestrateReport` (so they auto-collect + cache via the smart engine),
  record `lastRunAt`/`lastReportId`/`lastStatus`/`lastError`, and advance `nextRunAt` even
  on failure (no tight retry loop). Routes `GET/POST /api/schedules`, `PATCH/DELETE
  /api/schedules/:id`, `POST /api/schedules/:id/run` (JWT; create/update/delete/run gated to
  MANAGER_ROLES). Frontend: new **Schedules** page + nav item (`CalendarClock`) +
  `schedules-manager.tsx` (create form: name/type/target/period/cadence + a schedules table
  with Run-now / Pause-resume / Delete, next/last-run status, link to the last report).
  `main.ts` had to be edited to start the scheduler. Note: single-instance scheduler — a
  multi-instance deploy needs a shared lock/queue (Phase E). Typecheck + lint clean.
  **Remaining in Phase 14:** 14b share/export (shareable link + Markdown/PDF), 14c channels
  (Telegram/Discord delivery).

**Streaming chat (2026-07-10):** the website chat box now streams the assistant reply
token-by-token (ChatGPT-style). `openclaw.gateway.ts` `streamChatWithAgent` asks the
gateway for `stream: true` and yields OpenAI-compatible SSE `delta.content` chunks (falls
back to yielding the whole reply once if the gateway ignores `stream`). New endpoint
`POST /api/openclaw/chat/stream` streams **NDJSON** — one JSON event per line,
`{type:"delta",text}` or `{type:"error",message}` (checks `isGatewayConfigured` before
flushing headers so config errors stay JSON). Web `streamAssistantMessage(orgId, msg, onDelta)` uses `fetch`
+ `response.body.getReader()` (not axios). `chat-widget.tsx` streams into a live bubble
(`streamingText` state) and shows "Thinking…" only until the first chunk (covers the
agent's tool-call phase). The old non-stream `/chat` + `sendAssistantMessage` remain.
Note: token-by-token only if the OpenClaw gateway streams; otherwise one chunk (no
regression). Typecheck + lint clean.

**Hardening / bug-fix pass (2026-07-10)** — first of a multi-batch audit of existing
features (Chat/Reports/Statistics/Schedules). Batch 1 = 4 High-severity bugs, all fixed
(typecheck + lint clean; date logic unit-verified):
1. **Chat stream error surfacing** — a mid-stream gateway failure used to be written into
   the 200 body as text, so the client rendered the error as a normal assistant reply.
   Stream is now NDJSON (`delta`/`error` events); `streamAssistantMessage` buffers by line
   and **throws** on an `error` event so the chat widget shows its error banner instead.
   (`openclaw.controller.ts` `/chat/stream`, web `lib/api.ts`.)
2. **Reports custom-range end date dropped** — `new Date("YYYY-MM-DD")` parsed as UTC
   midnight (start of day), so every commit on the end date was excluded. `resolvePeriod`
   now parses a bare `YYYY-MM-DD` as a whole **local** day: `from`=00:00:00.000,
   `to`=23:59:59.999 (inclusive; commit query is `lte`). (`openclaw.tools.ts`
   `parseRangeBoundary`.)
3. **Schedules MONTHLY month-end overflow** — `new Date(y, m+1, 31)` turned Jan 31 into
   "Feb 31"→Mar 3, skipping February. `computeNextRun` now clamps the day to the target
   month's length (Jan 31 → Feb 28/29). (`schedules.service.ts`.)
4. **Schedules missing org-ownership check** — `createSchedule` accepted foreign/deleted
   `repositoryId`/`projectId`/`employeeIds`. It now reuses `resolveRepository`/
   `resolveProject`/`resolveEmployees` (404 if not in org). (`schedules.service.ts`.)

**Batch 2 — Statistics feature pass (2026-07-10)** — all Medium + a few Low, done
(typecheck + lint clean; chart path logic unit-verified):
- **Single-day chart** — a one-point series (e.g. "Yesterday") drew an empty `M x,y`
  moveto; `AreaChart` now draws a flat band + a marker so it reads. (`charts.tsx`.)
- **Day-label TZ bug** — daily buckets are keyed by *local* midnight but were labelled
  via `toISOString()` (UTC), so every bucket was a day off in TZs ahead of UTC.
  New `toLocalDateKey`. (`statistics.service.ts`.)
- **Squashed marker** — the hover/point dot was an SVG `<circle>` distorted into an
  ellipse by `preserveAspectRatio="none"`; markers + y-axis labels are now HTML overlays
  positioned by %. Added y-axis value labels + `role`/`aria-label`. (`charts.tsx`.)
- **Period-switch feedback** — `loading` never reset on period change; the selector now
  sets it and shows a spinner (stale data no longer looks final). (`statistics-dashboard.tsx`.)
- **Unused payload rendered** — `totals.filesChanged` (new tile) and `topModules` (new
  "Most changed areas" panel) were computed but never shown. `byProject` capped at 8.
  (`statistics-dashboard.tsx`, `statistics.service.ts`.)

**Batch 3 — Reports feature pass (2026-07-10)** — Med + Low, done (typecheck + lint
clean; fingerprint logic unit-verified):
- **Cache fingerprint collision** — the fingerprint was 4 aggregate counts, so two
  different commit sets with equal totals (or an amend) reused a stale report.
  `aggregateActivity` now also returns `_max` `committedAt`/`sha`, folded into the
  fingerprint. (`activity.service.ts`, `openclaw.service.ts`, `openclaw.tools.ts`.)
- **Partial reports looked complete** — the backend's collection `warnings` (e.g. "repo:
  no Git credential, skipped") and `cached` flag are now surfaced: an amber "Heads up"
  banner + a "Cached" badge. (`openclaw.service.ts` returns `warnings`; web `api.ts`,
  `reports-manager.tsx`.)
- **No export / delete / expand** — Copy, Download (.md), and Delete (new
  `DELETE /api/reports/:id`, manager-gated, confirm dialog) actions + an Expand/Collapse
  toggle on the preview (was locked at `max-h-96`). (`reports.service.ts`/`.controller.ts`,
  `reports-manager.tsx`.)
- **Custom range not validated** — an inverted `from > to` silently produced a 0-commit
  report; now blocked in the form (submit disabled + hint) and in `resolvePeriod`
  (400 `PERIOD_RANGE_INVALID`). (`reports-manager.tsx`, `openclaw.tools.ts`.)
- **Stale phase scaffolding** — dropped the user-facing "Pending in later phases" roadmap
  list (shipped items like "Statistics (Phase 13)") and the "(Phase 10)" template line;
  the panel is now "Notes" and only shows a genuine LLM-not-configured note. Removed the
  dead `GitActivity.pending` field. (`openclaw.service.ts`, `openclaw.tools.ts`,
  `reports-manager.tsx`.)

**Batch 4 — Chat feature pass (2026-07-10)** — Med + Low, done (typecheck + lint clean;
memory-windowing logic unit-verified):
- **Conversation memory** — the chat was stateless (only the latest message sent). The
  stream endpoint now takes a `messages[]` array; the browser sends the recent tail
  (`toPayload`: last 8 turns, drop a leading assistant turn, clamp long report content),
  and `streamChatWithAgent` forwards it after the system turn. (`openclaw.controller.ts`,
  `openclaw.gateway.ts`, web `api.ts`, `chat-widget.tsx`.)
- **Abort / Stop** — `streamAssistantMessage` takes an `AbortSignal`; the widget aborts on
  unmount and via a **Stop** button (partial reply is kept). The stream endpoint also
  aborts the upstream LLM fetch on `res` `close`, so cancelling stops the token spend.
- **Empty reply** — a blank reply no longer renders an empty assistant bubble; it surfaces
  as a soft error with Retry.
- **Retry after error** — the failed user turn is kept and a **Retry** button re-answers it
  (was: message lost, input already cleared).
- **Scroll** — auto-scroll only when pinned to the bottom (`pinnedRef` via `onScroll`), so a
  user reading earlier messages isn't yanked down on every streamed token.
- **Cleanup** — removed the dead non-stream path: `POST /api/openclaw/chat`, gateway
  `chatWithAgent`, web `sendAssistantMessage`.

**Batch 5 — Schedules feature pass (2026-07-10)** — Med + Low, done (typecheck + lint
clean; retry/resume decision logic unit-verified). (Batch 1 already fixed the MONTHLY
month-end overflow + create-time org-ownership check.)
- **Cross-instance double-run** — `runDueSchedules` now *claims* each due schedule with an
  atomic `updateMany` conditioned on the `nextRunAt` it read (advancing it); only the
  instance whose update matches (`count === 1`) runs it, so two API instances can't
  double-generate the same report (double LLM spend). (`schedules.service.ts`.)
- **Failure skipped a whole cadence** — a first transient failure now retries in ~5 min
  (if sooner than the next scheduled run); a *repeat* failure (`lastStatus === "error"`)
  falls back to the normal cadence, so no tight retry loop. (`schedules.service.ts`.)
- **Resume fired instantly** — re-enabling a long-paused schedule kept its past `nextRunAt`
  and fired on the next tick; `updateSchedule` now recomputes `nextRunAt` from now when
  re-enabling a past-due schedule. (`schedules.service.ts`.)
- **No confirm on destructive actions** — added `window.confirm` to delete-schedule,
  untrack-repo, and disconnect-GitHub. (`schedules-manager.tsx`, `repositories-manager.tsx`,
  `credentials/git-connection.tsx`.)
- **Cleanup** — dropped the dead required `organizationId` from `updateScheduleSchema` (and
  the web patch type / toggle call); authz is derived from the loaded row.

**Batch 6 — Reports deferred (shared-logic) pass (2026-07-10)** — Med + Low, done
(typecheck + lint clean; identity-folding logic unit-verified):
- **`Unknown` contributor folding** — `buildEmployeeLeaderboard` grouped by `username`
  only, so every commit with a null username collapsed into one "Unknown" row (distinct
  email-only authors merged + misattributed). It now groups by
  `["username", "authorEmail", "authorName"]` and keys identity as: mapped employee (folds
  their usernames) → unmapped username → **author email/name** (null-username authors stay
  distinct) → "Unknown" only when there's no identity at all. Shared logic, so Statistics
  `topContributors` benefits too. (`activity.service.ts`.)
- **Contributor `commitCount` stored as 0** — `orchestrateReport` now fills each stored
  contributor's `commitCount` from the leaderboard. (`openclaw.service.ts`.)
- Still deferred (low value): persisting the *structured* leaderboard/analysis in report
  history — the saved report's **markdown already carries** the "Who did what" table, so
  history is not blank; a structured re-render is a larger UI change for little gain.

**Audit hardening complete for all four features + setup (Batches 1–6).**

**Batch 7 — Schedules time-of-day + timezone (2026-07-10, migration)** — the deferred
Schedules UX gap, done (typecheck + lint clean; timezone/DST next-run logic unit-verified):
- Migration `20260710055154_schedule_time_of_day` adds `runHour` (default 9), `runMinute`
  (default 0), `timeZone` (nullable) to `ReportSchedule`. Additive/safe; existing rows get
  09:00. **Note:** `prisma migrate dev` did NOT regenerate the client here — had to run
  `npx prisma generate` after, then typecheck passed.
- `computeNextRun(from, spec)` is now **timezone-aware**: it fires at `runHour:runMinute`
  interpreted in the schedule's `timeZone` (falls back to the server zone when null),
  DST-correct via a two-pass `Intl.DateTimeFormat` offset (verified: Dhaka no-DST +
  America/New_York EST/EDT boundaries). Candidate = today's target time; if past, advance
  one cadence step (MONTHLY still clamps Jan 31 → Feb 28/29). Signature changed from
  `(from, cadence)` → `(from, spec)`; `specOf(row)` builds the spec, and create/update/
  `runDueSchedules` were updated. (`schedules.service.ts`.)
- Create/update schemas take `runHour`/`runMinute`/`timeZone`; the Schedules form has a
  **Time of day** `<input type="time">` (default 09:00) and sends the browser timezone
  (read after mount to avoid a hydration mismatch); the table shows "at HH:MM" under the
  cadence. (`schedules.schemas.ts`, web `api.ts`, `schedules-manager.tsx`.)

**Batch 8 — Low cleanup (2026-07-10)** — deep-link a schedule's "view" to its report: the
Schedules table now links to `/dashboard/reports?report=<lastReportId>` and `reports-manager`
reads that query param on mount (client-only via `window.location.search`, no
`useSearchParams`/Suspense needed) and opens the report. (Skipped the other Low item —
persisting the *structured* leaderboard/analysis in history — as dead data: the report
markdown already carries the "Who did what" table, and no UI renders structured leaderboard.)

### 14b — Report sharing + export (2026-07-10) ✅

Markdown export was already shipped (Batch 3: Copy + Download `.md`). This adds a **public
share link** + print/PDF:
- Migration `20260710121349_report_share_token` adds `Report.shareToken String? @unique`
  (nullable unique; hand-written SQL + `prisma migrate deploy` because the unique-constraint
  warning makes `migrate dev` refuse in a non-interactive shell — then `npx prisma generate`).
- Backend `reports.service.ts`: `shareReport` (manager-gated; mints a `randomBytes(24)`
  base64url token, idempotent), `unshareReport` (sets it null), `getPublicReport(token)`
  (returns only presentational fields — title/markdown/stats/period, never org ids or
  contributor rows). Routes `POST`/`DELETE /api/reports/:id/share` (JWT); a **new
  unauthenticated** `GET /api/public/reports/:token` via `reports.public.controller.ts`,
  mounted in `app.ts` at `/api/public/reports` **outside** `requireAuth`.
- Frontend: `shareReport`/`unshareReport`/`getPublicReport` + `PublicReport` type in
  `api.ts`; a **Share** button in the report toolbar that mints + copies the link, plus a
  link box (copy / unshare); a public **`/share/[token]`** page (`app/share/[token]/page.tsx`
  server component awaits Next 16 async `params` → client `shared-report.tsx`) that renders
  the markdown + stat tiles with a **Print / PDF** button (`window.print()`), no auth/chrome.
- Verified: API boots with the new router; `GET /api/public/reports/<bogus>` → 404
  `SHARED_REPORT_NOT_FOUND` **with no auth** (open); `POST /api/reports/:id/share` without a
  token → 401 (JWT-gated). typecheck + lint clean.

Remaining: **Feature phases** — channel delivery (14c: Telegram/Discord auto-send, scheduler
is ready), employee login/invite. (Phase E background deep-history collection ✅ done
2026-07-12 — see §11.6 E.) No audit rough edges left.
- **Sharing**: `ReportShare` model + share action + channel placeholders.
- **Tests**: set up Vitest + Supertest first (none installed). Unit-test
  `token-cipher`, permission helpers, commit classification; integration-test the
  report flow with a mocked GitProvider/LLMProvider.
- **Deployment**: Dockerfiles (web, api) + `docker-compose.yml` (add postgres) +
  production env guide.

### Auto contributor-mapping via declared git aliases (2026-07-10) ✅

Removes the biggest manual chore: previously a manager had to hand-map every
discovered `ContributorIdentity` → employee, **per repo** (identities are
per-repo: `@@unique([repositoryId, externalId])`), so each new repo meant
re-mapping the same people. Now the employee **declares** their git handle once
and every repo links automatically.

- **New model `EmployeeGitAlias`** (org-scoped, employee-owned; migration
  `20260710063618_employee_git_alias`): `{ organizationId, userId, provider,
  username?, email?, name?, isPrimary }`, `@@unique([organizationId, provider,
  username])`. This is the source of truth for auto-mapping — it survives across
  repos, unlike the per-repo `ContributorIdentity`. An employee can own several
  aliases → multiple GitHub accounts per person (also reflected as multiple
  `EmployeeGitMapping` rows). Values normalized (trim + lowercase, leading `@`
  stripped) on write.
- **Match key is the GitHub `username` (login), not the git author *name*.**
  Name is unreliable (collisions/renames); email isn't available from the
  contributors API (only from collected commits). Only an **exact username match
  is auto-applied** (the "silent auto, else confirm" decision); email/name are
  reserved for future *suggested* matches. `GitContributor` gives us
  `username`+`externalId`, so username matching works today.
- **Auto-link helper** `modules/contributors/auto-link.ts` — two directions,
  both transaction-scoped, both create `EmployeeGitMapping` with
  `isPrimary` from the alias:
  - `autoLinkRepositoryContributors(tx, orgId, repoId)` — runs at the end of
    `discoverContributors`; links unmapped, non-ignored identities whose
    `username` matches an alias (case-insensitive). Count recorded in the
    `contributor.discover` audit as `autoLinked`.
  - `autoLinkAlias(tx, {...})` — reverse pass; when an alias is declared it
    retro-links already-discovered identities across **all** the org's repos, so
    repos connected *before* the employee existed link up too.
- **Employees**: `createEmployee` accepts `gitUsernames: string[]` (first =
  primary); new `POST/DELETE /api/employees/:userId/git-aliases[/:aliasId]`
  (manager-gated) to add/remove handles later; employee DTOs now include
  `gitAliases`. Alias creation is idempotent per (org, username) and rejects a
  username already owned by another employee (`GIT_ALIAS_TAKEN`). Removing an
  alias stops *future* auto-linking but leaves existing mappings intact.
- **Manual map now propagates**: `mapContributor` also upserts an
  `EmployeeGitAlias` for the username, so a one-off manual map auto-applies to
  every other repo going forward.
- **Projects**: `createProject` accepts optional `members: {userId, role}[]`
  (validated as active org members) so a team is assigned in the same step as
  creating the project.
- **Frontend**: employees page has a "GitHub username(s)" field (comma-separated)
  on create + per-row git-identity chips with inline add/remove; projects create
  form has an "Assign team" toggle list (added as Developers). New `api.ts`
  helpers: `addEmployeeGitAlias`, `removeEmployeeGitAlias`, `EmployeeGitAlias`
  type, `createEmployee.gitUsernames`, `createProject.members`.
- typecheck + lint clean across workspaces.

**Follow-up done same day (2026-07-10):**
- **Auto-discover-on-connect** — `discoverContributors` refactored: its core is now
  exported as `discoverContributorsForRepository(repository, actorId)` (auth-free
  core; the public fn loads + authorizes + delegates). `selectRepositories` calls
  it **best-effort, sequentially** for each just-tracked repo after the select
  transaction commits, so contributors are discovered **and auto-linked the moment
  a repo is connected** — no manual "Discover" press. A repo whose contributors
  can't be fetched (permissions/rate-limit) is skipped with a `console.warn`,
  never failing the selection. Trade-off: select now blocks on those GitHub calls
  (fine for a handful; a background job is the future improvement for bulk
  selects). The manual Discover button still works as a refresh.
- **Bot auto-ignore** — `isBotUsername` (`[bot]` login suffix + a `KNOWN_BOT_LOGINS`
  set: web-flow, dependabot, github-actions, renovate, snyk-bot, …) sets
  `ignored: true` on **first insert** only (refresh preserves manual choices).
  Ignored identities are skipped by auto-link and the unmapped list, so bots never
  clutter mapping or reports.

**Suggested matches (confirm-before-map) — DONE (2026-07-10):** the other half of
the chosen strategy. For still-unmapped, non-ignored identities, the backend
computes *lower-confidence* candidate employees (exact-username already
auto-links, so it never shows here) and the manager confirms with one click.
- `suggestContributorMatches(actorId, repositoryId)` in `contributors.service.ts`
  (manager-gated). Signals: **email (strong, 0.95→"high")** — a repo commit's
  `authorEmail` equals an employee's account email or a declared alias email
  (GitHub `…@users.noreply.github.com` relay addresses are excluded so they never
  false-match); **name/username similarity (medium)** — `nameSimilarity()` =
  fraction of the employee's name tokens (≥2 chars) found in the git
  username/commit author name ("Rahim Uddin" vs "rahim-uddin" → 1.0, vs
  "rahim-dev" → 0.5; threshold 0.5, capped 0.85). Distinct `{username,
  authorEmail, authorName}` pulled once from `Commit` (index `[repositoryId,
  username]`). Returns per-identity top-3 `{userId, name, confidence, reason,
  score}`. Works right after discovery via the username signal even before any
  commits are collected; email signal kicks in once activity exists.
- `GET /api/contributors/suggestions?repositoryId=` (registered before the
  `/:id` routes). Frontend `listContributorSuggestions` + `ContributorSuggestion`
  type; contributors page shows a "Suggested: {name} {confidence}" chip row under
  each unmapped contributor with one-click **Confirm** (calls `mapContributor`,
  which also records the alias so it propagates) and a local **Dismiss**. The
  chip auto-hides once mapped/ignored; suggestions reload after Discover.

**Create-employee-from-author — DONE (2026-07-10):** frontend-only (no backend
change — it rides the existing `createEmployee({ gitUsernames })` + reverse
auto-link). Each unmapped, non-ignored contributor with a username gets a "New
employee" button that opens an inline form (name prefilled from the username,
email required, role EMPLOYEE); submit calls `createEmployee` with the author's
username as an alias, which the backend immediately auto-links to that identity
(and any other repo). On success it refetches contributors + employees +
suggestions, so the row flips to mapped. Closes the loop: discover → author isn't
an employee → create them right there → auto-mapped.

**GitHub identity resolver + preview card — DONE (2026-07-10):** stops typo'd /
non-existent usernames from being saved, GitHub-picker style. Distinguishes
"account exists" (global `GET /users/{login}`, independent of repo access) from
"is a contributor" — so a real hire who hasn't committed anywhere yet still
validates.
- GitProvider gains `getUser(token, username): Promise<GitUser | null>` (null on
  404); GitHub impl hits `/users/{login}` and returns `{ login, name, avatarUrl,
  htmlUrl, company, location, bio, type }` (`type` flags User vs Organization).
- `resolveGitUser(actorId, orgId, username)` in `credentials.service.ts`
  (manager-gated, uses the org's stored credential) + `GET
  /api/git-credentials/resolve-user?organizationId=&username=` (returns `{ user }`
  or `{ user: null }`).
- Frontend `resolveGitUser` + `GitUserProfile`. **Employees create form** replaced
  the comma text field with a lookup: type a handle → **preview card** (avatar +
  real name + @login + company/location, org-warning if `type==="Organization"`)
  → **Add** pushes a confirmed-identity chip; several chips = several accounts;
  submit sends their canonical logins. A miss shows "No GitHub user …". The
  **per-row inline alias add** now also resolves first and blocks a bad handle.
- Verified end-to-end against the real stored token: `tanzilmia`→User "Md tanzil",
  `github`→Organization, bogus login→null. Email lookup was intentionally NOT
  built (GitHub only resolves *public* emails; the commit-email suggestion engine
  already covers the private-email case) — deferred as best-effort.

**Still deferred:** email-based resolve (best-effort, public emails only);
unmapped-contributors dashboard nudge; bulk CSV employee import.

**Repository access control (affiliations) — DONE (2026-07-12):** the provider
hardcoded `affiliation=owner`, so only the PAT owner's own repos appeared in
"Sync from GitHub" — collaborator + organization repos were invisible. Now:
- `GitCredential.repoAffiliations` (CSV, migration `credential_repo_affiliations`,
  **default `owner,collaborator,organization_member`** — existing credential
  backfilled to all-on per product decision). Surfaced in the credential DTO as
  `repoAffiliations: string[]`.
- `GitProvider.listRepositories(token, { affiliations? })` + exported
  `REPO_AFFILIATIONS`; GitHub impl builds the `affiliation=` param (omitted →
  all three). `syncRepositories` passes the credential's setting;
  **`resyncRepository` deliberately passes none (= all)** so narrowing the
  filter can't fail metadata refresh of an already-tracked repo.
- **Semantics: a browse/sync-list filter, not access revocation** — narrowing
  never untracks tracked repos (verified).
- `PATCH /api/git-credentials/:id/repo-access` (manager-gated, zod `.min(1)`,
  AuditLog `credential.repo_access.update`).
- Web: `/dashboard/git` connected card gains a **"Repository access"** section —
  three checkboxes (Own / Shared with you / Organization), Save disabled when
  unchanged or zero selected, copy notes the sync-list-only semantics + the
  fine-grained-PAT/org-SSO caveat. `updateCredentialRepoAccess` in `api.ts`.
- Verified against an affiliation-aware mock (3 repos, one per affiliation):
  default all-three, owner-only narrowing hides the other two, tracked
  collaborator repo survives + resyncs, empty array → 400. typecheck + lint +
  build clean both workspaces.

### Project Analysis page — per-employee activity cards (2026-07-12) ✅

Phase 1 of the management-analysis vision (per-employee cards → compare view →
daily digest/leaderboard history → employee-of-the-month). **Manager-only**
(first fully manager-gated page): pick a project + period → one card per
project member with activity signals. Explicitly framed as **activity signals,
not performance verdicts** (UI carries the disclaimer).

- **`isNoisePath`** (`report-engine/commit-classifier.ts`) — lockfiles
  (package-lock/yarn/pnpm/Cargo/Gemfile/composer/poetry/go.sum), generated dirs
  (node_modules/dist/build/out/.next/vendor/coverage/__snapshots__), minified/
  artifacts (.min.js/.min.css/.map/.snap). Analysis line counts exclude these
  so a dependency bump can't inflate anyone (verified: 11,460 raw → 1,260
  filtered on mock data). 22 unit cases checked (incl. `distribution/`,
  `locksmith.ts` negatives).
- **`modules/analysis/`** — `GET /api/analysis/project?organizationId=&projectId=&period=`
  (JWT + `requireOrganizationRole(MANAGER_ROLES)`, 404 on foreign project).
  `getProjectAnalysis`: resolvePeriod → project members + their
  `EmployeeGitMapping` usernames → **single-pass** over the project window's
  commits (cap 2000) + changed files (cap 10,000; `truncated` flag) →
  per-member buckets: commits, raw vs **filtered** lines, excludedLines,
  activeDays (`toLocalDateKey`, now exported from statistics.service), module
  count + top-3 (`moduleFromPath`, noise excluded), category mix
  (`classifyCommit`), risky/large commits, lastCommitAt, 3 sample messages.
  Ranked by filteredLines. Zero-activity members still get a card with a
  `hasGitIdentity` flag; non-member git activity returns as `unmapped[]`.
- **Web:** nav item **Analysis** (`BarChart3`) — first role-gated nav entry
  (`NAV_ITEMS` gained `managerOnly?`, sidebar filters with `canManage`).
  `/dashboard/analysis` → `components/analysis/analysis-manager.tsx`
  (statistics-dashboard template): project + period selectors, StatTile totals,
  employee card grid (rank, role chip, commits/lines/active-days, BarList
  category mix, areas line, amber risk line, sample messages, "No GitHub
  identity linked" nudge), "Unattributed activity" panel linking to
  Contributors, truncation note, footer disclaimer. EMPLOYEE role sees an
  access notice (backend enforces anyway).
- Verified end-to-end vs mock (19 assertions): totals/cards/rank/noise-filter/
  activeDays/categories/idle-member flag/403 non-member/404/401. typecheck +
  lint + build clean both workspaces. No schema changes.
- Next phases (agreed): compare view → daily digest + leaderboard history →
  employee-of-the-month (LLM shortlist, management confirms).

**Analysis page v2 (2026-07-12) ✅ — custom range, commit details, AI report:**
- **Custom range:** frontend-only (backend already accepted `period=custom` +
  `from`/`to`) — `AnalysisPeriod = StatPeriod | "custom"` in web `api.ts`, period
  select gains "Custom range" → two date inputs + inverted-range guard (loading
  is skipped until the range is valid). Reminder: bare dates parse as whole
  LOCAL days (inclusive end), by design.
- **Per-employee commit details:** `GET /api/analysis/project/commits?...&userId=`
  (manager-gated; matching by the employee's mapped usernames, case-insensitive
  `in`; cap 100 newest). Each card gets a **Details** button → full-width panel
  with a table (Date | Commit+sha | Category pill | +/- | Files). Unmapped
  employee → empty table.
- **AI narrative report:** header **AI report** button calls the EXISTING
  `POST /api/openclaw/reports/generate` (project + same window) — orchestration,
  auto-collect, fingerprint cache, persistence, template fallback all reused.
  Result renders inline (react-markdown, `.report-md`, Cached/Template badges,
  "View in Reports →" deep-link). **Prompt enrichment (all channels benefit):**
  `buildProjectEmployeeSignals` (analysis.service; org-wide mapping keyed by
  userId, caps 1000 commits/5000 files, noise-excluded) feeds new
  `ReportContext.employeeSignals`; leaderboard prompt lines gain
  `focus: 108 Fix, 47 Feature · areas: src` and the template table gains a
  **Focus** column. Computed only for project reports, non-fatal on error.
- Verified (mock GitHub + mock LLM that records the prompt): custom window =
  51.00 local days inclusive; inverted → 400 `PERIOD_RANGE_INVALID`; details
  rows (sha7/category/date); template PARTIAL report has the Focus column; LLM
  report GENERATED with `focus:`/`areas:` lines in the received prompt;
  identical repeat → `cached: true`. typecheck + lint + build clean.

**Analysis Phase 2 — employee comparison view (2026-07-12) ✅ (frontend-only):**
No API change — the loaded `ProjectAnalysis` already carries every per-employee
signal, so the same-project/same-period fairness guard holds by construction.
- Each card's footer gains a **Compare** toggle (`GitCompareArrows`; max 2,
  others disable at 2; available on zero-commit cards too); 1 selected → hint
  bar; 2 → `components/analysis/compare-panel.tsx` renders above the grid.
- Panel: two-person header (rank/role/@usernames) + "vs"; neutral metric rows
  with two-sided magnitude bars (Commits, filtered Lines, Active days, Areas,
  Feature/Fix commits — larger value bolder, NO good/bad coloring); a
  no-emphasis caution row (risky/very-large); side-by-side `BarList` work
  breakdowns; area chips with **shared** highlight (module overlap); sample
  messages + last commit per side; the standing activity-signals disclaimer.
- Selection resets on project/period reload. typecheck + lint + build clean.

**Branch-filtered analysis (2026-07-12) ✅ (pulled forward from Phase 4):**
- Backend: `projectAnalysisQuerySchema`/`employeeCommitsQuerySchema` gain
  optional `branch` (name); `branchFilter()` adds a `CommitBranch` relation
  filter (`branches.some.branch.name`) to both single-pass queries — data model
  was Phase-D-ready, no migration. New `GET /api/analysis/project/branches`
  (manager-gated): distinct branch names across the project's repos,
  default-first.
- Web: **branch selector** on the Analysis page between project and period
  (default "All branches"; options reload + reset on project change). Cards,
  totals, unmapped panel, and the Details table all follow the filter. The
  **AI report button disables** while a branch is selected (report engine is
  not branch-aware yet — tooltip explains; that part stays in Phase 4 scope
  if wanted).
- Verified vs mock (main=27 / develop=90 incl. 27 shared / all=90 deduped in
  the 30-day window; details table filtered; unknown branch → 0 commits, not
  an error; default-first ordering). typecheck + lint + build clean.
- Analysis roadmap remaining: Phase 3 (daily digest enrichment + leaderboard
  snapshot history), Phase 4 (employee-of-the-month LLM shortlist +
  branch-aware report generation).

### Live sync — GitHub webhooks, zero-friction (2026-07-13) ✅

Real-time commit ingestion: an employee pushes → GitHub delivers a signed
webhook → DevInsight ingests the fresh tail immediately. **Zero user setup**:
tracking a repo auto-registers the webhook via the org's stored PAT (user never
opens GitHub settings). Verified end-to-end vs mock (14 assertions incl. the
real-time flow: `__addcommit` → signed delivery → commitCount incremented).

- **Env `PUBLIC_API_URL`** (optional): the externally reachable API base GitHub
  calls. Unset (localhost) → live sync unavailable with a clean 400
  `LIVE_SYNC_UNAVAILABLE` hint; everything else unaffected. Documented in
  `.env.example`.
- **Schema** (migration `repository_webhooks`, additive): `Repository.
  webhookExternalId / webhookSecret (encrypted, token-cipher) / webhookStatus
  (ACTIVE|ERROR|null) / lastWebhookAt`.
- **Provider**: `createWebhook`/`deleteWebhook` on `GitProvider` + GitHub impl
  (`request()` gained method/body support). 403/404 → `WEBHOOK_PERMISSION_DENIED`
  with the exact scope hint (classic `admin:repo_hook` / fine-grained Webhooks
  write); delete is 404-tolerant.
- **Receive endpoint** `POST /api/webhooks/github/:repositoryId` — no JWT; the
  row id in the URL picks the exact Repository (two orgs tracking the same
  GitHub repo each have their own hook+secret). Mounted **before**
  `express.json()` with `express.raw` (HMAC needs raw bytes). Verifies
  `X-Hub-Signature-256` (timingSafeEqual); `ping`→200; `push`→**202
  immediately** then fire-and-forget ingest: window = earliest pushed-commit
  ts − 5 min → now via `ingestRepository` (now exported; ledger keeps it cheap,
  sha-dedup makes redeliveries idempotent — verified). Per-repo in-memory
  debounce with one trailing re-run; ingest failure → `webhookStatus: ERROR`.
- **Lifecycle** (`repositories.service.ts`): `enableLiveSync`/`disableLiveSync`
  (manager; `POST`/`DELETE /api/repositories/:id/live-sync`; re-enable rotates
  the secret; AuditLog both ways). **Auto-enable on track** inside
  `selectRepositories`' best-effort loop (skips silently when PUBLIC_API_URL
  unset; permission failure warns, never fails selection). `untrackRepository`
  deletes the hook best-effort. DTO gains `liveSync {status,lastWebhookAt}` —
  the secret never leaves the backend.
- **Web**: Live badge (emerald pulse "Live" / red "Sync error", last-push
  tooltip) next to the visibility badge + a Zap toggle in row actions;
  permission/unavailable errors surface with actionable text.
- **Ops note**: production needs `PUBLIC_API_URL` + PAT webhook scope; local
  dev needs a tunnel or relies on manual/report collection. Missed deliveries
  are backfilled by any later collect (ledger). Future belt-and-braces: a
  scheduled poller (deliberately out of scope).

### Data-integrity fix — the "commit-first, push-later" hole (2026-07-13) ✅

**Bug (confirmed on real data):** coverage means "listed at collection time T" —
commits made earlier but PUSHED after T have committer dates inside covered
ranges; GitHub's `since` filters by committer date, so they were excluded from
every later listing and the ledger never re-opened the range (deep collect
planned 0 chunks). Real case: `dev-insight-saas` had `7ed0cf9`/`d662c06`
missing while their descendant `c647b03` was stored. Four-layer fix, each
verified against a mock that reproduces the hole (`__addcommit?backdateMinutes=`;
CONTROL assertion shows the ledger path missing the commit before the fixes):

1. **Manual Collect = force re-list** — `ingestRepository` gained
   `IngestRepositoryOptions { forceRelist, relistTailFrom }`; `collectActivity`
   passes `forceRelist: true`. Collect now means "make the DB match GitHub for
   this window" (sha-dedup keeps re-listing cheap).
2. **Report auto-collect trailing overlap** — `ensureActivityCollected` passes
   `relistTailFrom = now − 48h` when the window is near-now (`until > now − 6h`),
   so any report/schedule self-heals recent holes. Fixed past ranges keep the
   0-Git-call fast path. Constants `NEAR_NOW_MS`/`AUTO_RELIST_TAIL_MS`.
3. **Deep collect "verify" mode** — migration `collection_job_verify`
   (`CollectionJob.verify`), `deepCollectBodySchema.verify`, `runCollectionJob`
   plans the ENTIRE range ignoring the ledger; web deep-collect form gained a
   "Re-verify" checkbox. The repair tool for old holes at any depth.
4. **Webhook ingest by exact SHAs** — new `ingestPushedCommits` (activity
   service): push payload's commit list (sha/message/timestamp/author) is
   ingested directly (one getCommitDetail per NEW sha; Branch upsert by ref;
   CommitBranch links; NO coverage recorded — point events, under-coverage is
   safe; vanished shas skipped). Fallback for payloads without commits: 48h
   window with forceRelist. Immune to all date semantics.

### Project details hub — `/dashboard/projects/[id]` (2026-07-13) ✅

- `AnalysisManager` is now embeddable: optional props
  `{ initialProjectId, hideProjectSelector, embedded }` (embedded = no
  DashboardChrome; selector + listProjects skipped when hidden; default usage
  unchanged).
- New route `app/dashboard/projects/[id]/page.tsx` (Next 16 async params) →
  `components/projects/project-detail.tsx`: header (status/member/repo counts),
  **Repositories** section (connected repos + manager-only attach/detach via
  `assignRepositoryProject`), **Team** section (add/remove members, same
  endpoints as projects-manager), and the full **embedded analysis** (cards,
  compare, commit details, branch filter, AI report) locked to the project.
- Projects page cards gained a "Details →" link (sibling of the card button —
  anchors must not nest inside buttons).

### One-click "Today's report" on the Overview dashboard (2026-07-13) ✅

Zero-config daily digest: a **Today's report** button in the Overview
(`components/statistics/statistics-dashboard.tsx`) header generates an org-wide
report for the current day in one click — no form.
- **Backend: `team` report may now omit `employeeIds` = whole organization.**
  `generateReportSchema` (`openclaw.schemas.ts`) previously required
  `employeeIds` for both `employee` and `team`; now only `employee` requires it.
  A `team` report with no `employeeIds` runs with no per-employee username
  filter (all repos, all commits — matching what the Statistics dashboard shows),
  and `targetLabel`/`deriveTarget` render **"Entire team"** for the 0-employee
  case (`openclaw.service.ts`, `openclaw.tools.ts`). Everything downstream
  already handled `usernames: undefined` (org-wide) — only the guard + label
  changed. Verified via `generateReportSchema.safeParse`: team-without-ids
  accepted, employee-without-ids still rejected.
- **Frontend:** the button calls `generateReport({ reportType: "team",
  period: "today" })` and renders the result inline (reuses the analysis-manager
  AI-report panel pattern: title, Cached/Template badges, warnings banner,
  `react-markdown` `.report-md`, **View in Reports →** deep-link, dismiss). Uses
  `orchestrateReport` so auto-collect + fingerprint cache + template fallback all
  apply. Available to any org member (report generation is org-visible, gated by
  `requireOrganizationMember`, not manager-only). typecheck + lint clean both
  workspaces.
### Branch-aware report generation (2026-07-13) ✅ — Analysis Phase 4a

A report can now be scoped to a single branch. Previously reports read across
ALL branches (deduped via `CommitBranch`), so the Analysis page's AI-report
button was **disabled** whenever a branch filter was active; now it works with
the branch applied.
- **One chokepoint:** every report aggregation (`fetchGitActivity`/
  `aggregateActivity`, `analyzeActivity`, `buildEmployeeLeaderboard`,
  `sampleCommits`) routes through `buildCommitWhere` (`activity.service.ts`).
  `ActivityQuery` gained optional `branch`; `buildCommitWhere` adds the same
  `{ branches: { some: { branch: { name } } } }` clause the analysis module's
  `branchFilter` already uses — so all four became branch-aware in one edit. No
  migration (CommitBranch already existed).
- **Threaded through** `generateReportSchema` (optional `branch`, ≤255 chars) →
  `orchestrateReport` `activityQuery` + `ReportContext.branch` (so the report H1
  reads `… (develop)` via `deriveTarget`) + AuditLog metadata.
- **Cache-safe:** `dataFingerprint` is prefixed `b:{branch}|…` and `targetLabel`
  is suffixed ` · {branch}` when a branch is set, so a branch report never reuses
  (or is reused by) the all-branches report of the same scope/period. Verified:
  all-branches / main / develop yield distinct cache keys; same branch+data → hit.
- **Collection unaffected:** auto-collect (`ensureActivityCollected`) still fetches
  ALL branches; branch is a read-time filter only. The branch selector shows only
  branches already in the DB, so a filtered report is never empty for that reason.
- **Frontend:** `GenerateReportInput.branch` (web `api.ts`); the Analysis AI-report
  button is re-enabled with a branch selected and passes `branch` through
  (`analysis-manager.tsx`). typecheck + lint clean both workspaces.
- Note: the chat/MCP path (`devinsight_generate_report`) doesn't expose `branch`
  yet — dashboard-only for now; adding it there is a small follow-up.

### Analysis Phase 3–4 — ALL DONE (2026-07-13) ✅ (4a, 3a, 3b, 4b)

Full Analysis roadmap shipped. One additive migration
`20260713055234_analysis_snapshots_and_awards` (applied to Neon + `prisma
generate`) adds `LeaderboardSnapshot`/`LeaderboardSnapshotRow`/`EmployeeAward` +
enums `SnapshotGranularity`, `AwardStatus`. All new endpoints live under the
existing `analysisRouter` (`/api/analysis`, JWT). typecheck + lint + build clean
both workspaces.

**3a — Leaderboard snapshot history.** `modules/analysis/leaderboard-snapshots.ts`:
- Reusable local-time period helpers `dayRange`/`weekRange`/`monthRange`
  (`rangeEnd` = last ms; ISO-week keys `YYYY-Www`, month `YYYY-MM`) + `dueTargets`
  (bounded backfill: 14 days / 4 weeks / 3 months, completed-only). **Unit-verified**
  (Feb-28, Dec year-boundary, ISO W01/W02, today-excluded/yesterday-included, dedup).
- `writeDueSnapshots()` — idempotent sweep over every org × scope (`"org"` +
  each ACTIVE project) × due period; rows come from `buildEmployeeLeaderboard`
  (called with `samplePerEmployee=0`, which now skips the recent-messages query —
  a safe new guard). `scope` is a **non-null** `"org"|projectId` so the
  `@@unique([organizationId, scope, granularity, periodKey])` dedups reliably
  (nullable projectId would defeat it). P2002 race → skip. Top-50 rows/snapshot.
- Hooked into `scheduler.ts` tick on a 15-min throttle (snapshots are for
  completed periods, so slow cadence is fine); kicks on boot.
- `GET /api/analysis/leaderboard-history?organizationId=&scope=&granularity=&limit=`
  (org-member) → snapshots newest-first with top-10 rows each.
- **Verified end-to-end against Neon:** boot sweep wrote 84 snapshots
  (DAILY 56 / WEEKLY 16 / MONTHLY 12) + 16 rows for the real org+project, no errors.

**3b — Daily digest.** `modules/analysis/digest.service.ts` `getDailyDigest`
(org-member): an org-wide "yesterday in review" computed **live** (adjacent-day
leaderboards, so it works before any snapshot exists) — headline
(commits/contributors/active-repos/lines/files), volume trend vs the prior day,
top-5 movers with **rank-delta** (prevRank−rank; null = new) and **active-day
streak** (walked back from commit history over 21 days, snapshot-independent),
plus risk signals from `analyzeActivity`. `GET /api/analysis/digest?organizationId=`.
Web: self-loading `DailyDigestCard` on the **Overview** (`statistics-dashboard.tsx`)
— mini-stats, top-mover list with ▲▼ deltas + 🔥 streaks, trend chip, risks.

**4b — Employee-of-the-month.** `modules/analysis/awards.service.ts`:
- Deterministic **balanced score** over last-month leaderboard for a scope:
  `0.30·commits + 0.30·lines + 0.25·activeDays + 0.15·files`, min-max normalized
  across mapped candidates (activeDays computed live from distinct local commit
  days). **Unit-verified:** steady broad work (0.88) outranks a single-commit
  line spike (0.36); all-zero → finite 0 (no divide-by-zero). Only **mapped**
  employees are eligible; top-5 shortlist.
- **Citations:** one best-effort LLM call for the whole shortlist, parsed by an
  index marker (`^\s*(\d+)[).]`); any skipped candidate keeps a deterministic
  **template** citation, so a partial/failed/absent LLM never leaves a blank.
  **Unit-verified** (preamble ignored, `1)`/`2.` both parse, missing→template).
- `generateShortlist` (manager) replaces prior SHORTLISTED for the scope+period
  (keeps CONFIRMED/DISMISSED), AuditLog. `confirmAward` (manager) → CONFIRMED +
  siblings→DISMISSED (single winner), AuditLog. `listAwards` (member).
  `GET /api/analysis/awards`, `POST /api/analysis/awards/shortlist`,
  `POST /api/analysis/awards/:id/confirm`. All **verified 401 without JWT**.
- Web: self-loading `AwardsPanel` on the **Analysis** page scoped to the selected
  project — shortlist cards (rank, score bar, citation, metrics, manager Confirm),
  a CONFIRMED "Winner" highlight, past-winners list, template/AI note, and the
  standing "recognition suggestion, not a performance verdict" disclaimer.

**Deferred (documented):** risk-penalty + module-breadth in the award score
(kept to commits/lines/activeDays/files for MVP transparency); a leaderboard-history
trend chart UI (endpoint + data shipped, no chart yet); org-wide (`scope="org"`)
awards UI surface (backend supports it; only project scope is wired in the page).

### 14c — Telegram report delivery (2026-07-13) ✅

Scheduled (and manual) reports now deliver to Telegram. **Product decision:
everything is admin-panel managed — nothing in `.env`.** The bot token is stored
**AES-256-GCM encrypted** (token-cipher, like a git PAT), never returned to the
frontend or logged. Reports are sent as **clean inline text** (no share link),
auto-split to Telegram's 4096-char limit. **Verified live end-to-end against a
real bot + group** (message with heading/table/bullets landed correctly).

- **Model `NotificationChannel`** (migration `20260713072718_notification_channels`):
  org-scoped `{ type (ChannelType enum: TELEGRAM), label, encryptedToken,
  tokenLast4, chatId, chatTitle, enabled, lastDelivery{At,Status,Error} }`.
  `ReportSchedule.channelId String?` (no FK — tolerant of a deleted channel;
  delivery skipped if it no longer exists).
- **Provider abstraction** (`modules/channels/`, per the mandatory-abstraction
  rule): `ChannelProvider` interface + `TelegramProvider` (Bot API via global
  `fetch`; `detectChats` = getUpdates, `sendMessage` = plain text, no parse_mode
  so it can never fail on escaping). `channel-registry.ts` resolves by type —
  Discord/Slack later are drop-in. Telegram errors mapped to clean AppErrors
  (401→TELEGRAM_UNAUTHORIZED, "chat not found"→TELEGRAM_CHAT_NOT_FOUND, 403→…).
- **Formatter `telegram-format.ts`** (unit-verified): `markdownToPlainText`
  (headings/bold/italic/code/links stripped, tables → "cell · cell" lines,
  bullets normalized) + `chunkText` (≤limit, paragraph→line→hard-split) +
  `buildReportMessages` (compact header 📊title/🗓period/📈stats + body, leading
  H1 de-duplicated).
- **`channels.service.ts` + `/api/channels` router** (mounted in app.ts):
  `GET /` (member list, token never returned — `tokenLast4` only),
  `POST /` (manager; validates token via detectChats before saving),
  `POST /detect` (manager; token → chats the bot sees — the admin "Detect chats"),
  `POST /:id/test` (manager; sends a fixed test message),
  `PATCH /:id` (manager; relabel / enable-disable / rotate token / change chat),
  `DELETE /:id` (manager), `POST /send-report` (manager; "Send to Telegram" on a
  saved report). AuditLog on create/delete. All **verified 401 without JWT**.
- **Delivery hook** (`schedules.service.ts`): `runScheduleNow` + `runDueSchedules`
  call `deliverReportForSchedule(orgId, channelId, report)` after a report is
  generated — **resilient: it never throws**, so a delivery failure can't fail
  the report run (records `lastDeliveryStatus`/`Error` on the channel; a scheduler
  warning is logged). `createSchedule`/`updateSchedule` validate the channel
  belongs to the org.
- **Web:** new **Channels** page + nav item (`Send` icon, manager-only) —
  `channels-manager.tsx`: add form (label + token → **Detect chats** → pick from
  the detected list → Add), a channels table (test / enable-disable / delete,
  last-delivery status), with the Telegram privacy-mode hint ("send
  `/start@your_bot` in the group first"). Schedules form gained a **"Deliver to"**
  channel selector; Reports toolbar gained a **"Send to Telegram"** channel picker.
  `api.ts` helpers: `listChannels`/`detectChats`/`createChannel`/`updateChannel`/
  `deleteChannel`/`testChannel`/`sendReportToChannel` + `channelId` on schedules.
- typecheck + lint + build clean both workspaces. Gotcha again: `prisma migrate
  dev` then `npx prisma generate`.
- **Deferred:** the conversational path (Telegram → OpenClaw → reports, mostly
  OpenClaw config) and Discord/Slack providers; optional `.md` file attachment for
  very long reports (`sendDocument`).

### Reporting advances A + B — trend comparison + key insights (2026-07-13) ✅

Reports are now insight-first and trend-aware. Both live in the backend report
pipeline, so **every channel (dashboard, chat, Telegram) gets them for free** —
no per-channel work. No migration. **Verified live** (real Groq LLM report over
the org's real data wove in a "## Key insights" section + the −11% trend).

- **A — period-over-period comparison** (`report-engine/comparison.ts`, pure):
  `buildComparison` diffs the current window against the **equal-length window
  immediately before it**, read **best-effort from stored data** (no extra Git
  collection). Returns headline `MetricDelta`s (commits/lines/files/contributors
  with `deltaPct`) + per-contributor `RankMovement` (up/down/same/**new**/
  **dropped**). `hasBaseline=false` when the prior window has no stored activity,
  so deltas are suppressed (a first-ever report reads cleanly, no "−100%").
- **B — auto-surfaced insights** (`report-engine/insights.ts`, pure):
  `buildInsights` is a deterministic rules pass → volume swing (≥25% vs prior),
  **risk signals** (from the analysis engine — surfaced early so the 6-insight cap
  never drops them), work **concentration** (top contributor ≥60% of lines =
  bus-factor), **new/departed** contributors + notable **climber**, and
  **work-type skew** (≥50% one category). Each `{ kind, severity, text }`.
  Unit-verified (14 cases incl. cap/priority).
- **Wiring** (`openclaw.service.ts`): computes `prevActivity`+`prevLeaderboard`
  (DB-only, 2 cheap queries), builds `comparison`+`insights` before the cache
  check, and **folds the previous-period baseline into `dataFingerprint`**
  (`…-p{prevCommits}s{prevSha}`) so a changed baseline busts a stale cache. Both
  are returned structured on the cache-hit AND generated paths, and added to
  `ReportContext`.
- **Prompt + template** (`openclaw.tools.ts`): the LLM prompt now carries a
  "Compared to the previous period" block + the detected insights, and is
  instructed to add a **"## Key insights"** section (3–5 grounded bullets) after
  the overview and weave the trend in. The **template fallback** renders
  "## Key insights" + "## Trend vs previous period" deterministically, so the
  sections appear even with no LLM.
- Web: `ReportComparison`/`ReportInsight` types on `GeneratedReport` (the report
  markdown already renders both sections via `.report-md`, so no UI change was
  needed). typecheck + lint + build clean both workspaces.
### Reporting advances A/B follow-up — structured panel + more insights (2026-07-13) ✅

Closed the A/B gaps the user spotted (trend shown only as vague LLM prose like
"lines changed increased"; no severity colors). Now the exact structured data is
surfaced directly, plus 2 new insight types, plus the panel on the Analysis page.

- **Persistence (no migration):** `createReport` stores `comparison` + `insights`
  inside `statisticsJson` (extra keys); `splitStatistics` splits them back out on
  read, so `GET /api/reports/:id` and the public report now return structured
  `comparison`/`insights` — a **history/shared report renders the same panel as a
  fresh one**. Verified round-trip (forced cache-miss → saved → read back carries
  both). Old cached reports lack them until regenerated (expected).
- **Structured panel** (`components/reports/report-insights-panel.tsx`): **Trend
  tiles** (Commits/Lines±/Files/Contributors — current value + ▲▼ deltaPct, "was
  N", `no prior` when no baseline) + **rank-movement badges** (new/off/↑N/↓N) +
  **severity-colored insight list** (⚠️ amber for `warn`, 💡 accent for `info`).
  Exact numbers, not LLM paraphrase. Rendered above the markdown in
  **reports-manager**, **shared-report**, and the **Analysis AI-report**.
- **No duplication:** the markdown still carries "## Key insights" + "## Trend vs
  previous period" (so Telegram / copy / download / PDF stay complete — the LLM is
  now told to use those exact titles), but `stripStructuredSections` removes those
  two sections **for on-screen display only** (raw markdown unchanged for copy/
  download/Telegram). Verified: strip drops the two sections, keeps "Who did what".
- **2 new insight types** (`analyzeActivity` gained signals, no new query cost):
  `offHoursCommits` (commits before 06:00 / after 22:00 / weekend) →
  **off-hours/burnout** insight (warn, ≥30%); `noiseChangeShare` (share of changed
  lines in `isNoisePath` dependency/generated files) → **dependency-churn** insight
  (info, ≥50%, "real feature churn is smaller than the totals suggest").
  `ActivityAnalysis` gained `analyzedCommits`/`offHoursCommits`/`noiseChangeShare`
  (additive — statistics unaffected). Unit-verified fire-above / silent-below.
- typecheck + lint + build clean both workspaces. Deferred still: period trend on
  the Statistics Overview stat tiles (the daily-digest card already covers daily),
  test-coverage-ratio insight, forced prev-period collection for a guaranteed
  baseline.

### Plain-language executive report layer — Phase 1 (2026-07-13) ✅

User goal: make reports **non-technical readable + reliable** (a manager/PM/CEO,
not a developer, is the reader). All backend-side in the report pipeline, so
**every channel (dashboard, chat, Telegram, share link) benefits** — no migration,
no shared-query rewrite, no frontend change (the report markdown already renders
everywhere). typecheck + lint clean both workspaces; pure helpers unit-verified
(13 cases) + template markdown + LLM prompt rendered and eyeballed.

- **New pure module `report-engine/plain-language.ts`** (no IO, unit-testable):
  - `activityLevel(commits, days)` → No activity / Light / Steady / Busy / Very busy,
    **normalized by period length** (updates-per-day) so 15/day and 15/quarter don't
    read the same.
  - `humanizeWorkMix(categories)` → "mostly bug fixes (45%), new features (30%)"
    (top-3 by share; "mostly" prefix only when the top ≥ 50%). Category→plain map
    (Feature→"new features", Fix→"bug fixes", Refactor→"code clean-up", …).
  - `humanizeArea(module)` / `humanizeAreas(modules)` → directory bucket → business
    name (`api`→Backend, `src`→Core code, `prisma`→Database, `components`→UI
    components, …; unknown → title-cased). De-dups.
  - `buildPlainSummary(...)` → deterministic 2–4 sentence executive paragraph
    ("Busy period: 3 people made 127 updates over 31 days. The work was … Rahim was
    the most active. Overall activity was up 20% … 2 items may need a closer look.").
    Handles the 0-activity case with a helpful message.
  - `buildCaveats({hasBaseline, unmappedContributors, skippedRepositories})` →
    trust-calibration notes (no baseline → trend hidden; N contributors unlinked;
    repos skipped in collection).
- **`openclaw.tools.ts` `buildReportPrompt`** — system prompt now targets
  "managers and non-technical stakeholders … plain business language, not developer
  jargon". Added a **plain-language facts block** (activity level, work mix, main
  areas, most-active person, attention count) and a rewritten instruction requiring
  a first `## Summary` section (3–4 jargon-free sentences; explicitly bans
  commit/lines/refactor/repo/branch/SHA), then Key insights / Who did what / Trend.
  The contributor block is reframed "a signal of involvement, not a performance rating".
- **`openclaw.tools.ts` `buildReportMarkdown`** (template fallback) — now leads with
  `## Summary` (buildPlainSummary), an `## Activity` section with **Activity level /
  Type of work / Main areas** in plain words above the raw "Detailed totals:" line,
  and the leaderboard header changed to `## Who did what` + italic disclaimer
  ("a signal of activity, not a performance rating"); "Commits" column → "Updates".
- **`openclaw.service.ts` `orchestrateReport`** — computes `caveats` once (before the
  cache check) and **bakes a deterministic "Good to know" footer into the persisted
  markdown for BOTH the LLM and template paths** (`appendCaveats`), so caveats can
  never be paraphrased away and show in every channel. `caveats: string[]` returned
  on both the cache-hit and generated responses (extra field; no web type change).
- **Reliability (Rel1 framing):** the "Who did what" block is reframed as an
  activity signal, and the dependency-churn insight already flags high noise share.

### Plain-language layer — Phase 1.5: noise-free leaderboard ranking (2026-07-13) ✅

Closes the sharpest reliability hole for a non-technical reader: the report
leaderboard used to rank by RAW lines, so a single `npm install` (a lockfile bump
of tens of thousands of lines) made that person look like the top contributor.
Fixed — ranking now uses **noise-free** lines. typecheck + lint clean; the ranking
algorithm unit-verified (11 cases incl. the dependency-bump flip, mixed
real+noise, and no-files-collected safety).

- **`activity.service.ts` `buildEmployeeLeaderboard(input, samplePerEmployee, options)`**
  gained `options.excludeNoise` (default false → unchanged fast path, so Statistics
  `topContributors` and the snapshot writer are untouched). `EmployeeLeaderboardRow`
  gained `effectiveLines` (raw `lines` minus lines in `isNoisePath` files); ranking
  now sorts by `effectiveLines` (identical to before when not excluding noise).
- **Robust subtraction, not recompute:** noise is *subtracted* from the accurate
  commit-level totals (one extra `changedFile.findMany({ where: { commit } })` pass,
  capped `LEADERBOARD_NOISE_FILE_CAP = 20000`, attributed to each file's commit
  author via the same `identityFor`). Commits whose files weren't collected (detail
  cap) contribute 0 noise, so they keep their real lines — **undercorrection is the
  safe direction** (never zero-out real work, never over-credit). Under-scanning a
  huge scope only reduces correction.
- **Reports opt in:** `orchestrateReport` calls the current AND previous leaderboard
  with `{ excludeNoise: true }` (previous too, so rank-movement stays consistent).
- **Display:** the LLM prompt's contributor block and the template's "## Who did
  what" table now show `effectiveLines` as "real work (lines)" (raw `+/-` dropped
  from the table — jargon anyway), with a disclaimer noting dependency/generated
  files are excluded.
- **Still raw (documented boundary):** the aggregate `## Trend vs previous period`
  line totals and the `## Activity` "Detailed totals" come from `aggregateActivity`
  and remain raw (team-wide, far less misleading than per-person). Noise-adjusting
  the aggregate trend is a possible later polish.
- **Next (agreed roadmap):** Phase 2 = LLM theme/initiative clustering ("what
  shipped", grouping related commits) — the real "smart" jump; Phase 3 = better
  commit classification (regex/prefix → LLM-assisted so non-conventional-commit teams
  aren't 80% "Other") + a Simple/Detailed reading-mode toggle.

### Plain-language layer — Phase 2: "What shipped" initiative clustering (2026-07-13) ✅

The "smart" jump: reports now tell a manager **what actually shipped** — related
updates grouped into named initiatives — instead of only category tallies. Folded
into the **existing** report LLM call (no extra call/cost/latency; fits the report
cache; all channels get it via markdown; template fallback unchanged). **Verified
end-to-end against the real Groq LLM**: 18 varied update messages clustered into 5
clean initiatives ("Payment Webhook Retries", "Refund Flow", "Telegram Report
Delivery", "Two-Factor Login", "Report Enhancements"), correctly dropping
`chore: bump dependencies`/eslint as non-initiatives.

- **`openclaw.service.ts`** — `sampleCommits(activityQuery, 60)` (was 30) so the
  LLM has enough update messages to cluster (recent-60; note: a very long window
  clusters from the recent tail — acceptable first cut).
- **`openclaw.tools.ts` `buildReportPrompt`** — the update-messages block is
  relabelled "source material … cluster into the '## What shipped' initiatives", and
  the instruction gains a new section (marked THE MOST IMPORTANT): `## What shipped`
  — group updates into 3-6 concrete initiatives, each a **bold plain title** + one
  sentence on what it delivered + rough size, grounded ONLY in the real messages,
  merging related updates. Order: Summary → Key insights → **What shipped** → Who did
  what → Trend. Word cap 450 → 600 to give it room.
- **No template-fallback clustering** (semantic grouping needs an LLM): the no-LLM
  template keeps Summary/Activity/etc., whose plain-language areas+work-mix already
  convey the shape. LLM reports (the normal path with Groq configured) are richer —
  same pattern as the rest of the codebase.
- **Boundary/next:** clustering is prompt-side (folded call), not a dedicated
  structured extraction, so themes live in the markdown, not as a structured field/UI
  panel. A future Phase 2.5 could do a dedicated structured `clusterThemes()` call
  (broader commit coverage + a frontend panel) if wanted.

### Plain-language layer — Phase 3: better classification + reading-mode (2026-07-13) ✅

Two parts. typecheck + lint + **build** clean both workspaces; classifier verified
(39/40 message styles) + section-filter verified (17/17). No migration.

**Part A — richer commit classification (`report-engine/commit-classifier.ts`).**
The old `classifyCommit` was conventional-commit-prefix + a thin keyword fallback,
so teams that DON'T write `feat:`/`fix:` got most work bucketed as "Other" — a
useless work-breakdown. Rewritten (still fully deterministic, so Statistics /
Analysis, which must never call an LLM, are unaffected — the LLM only does the
semantic "What shipped" narrative):
- Expanded `PREFIX_MAP` (revert/style/config/setup/init/release/deploy/dep…).
- **Merge commits** (`^merge …`) → Chore (integration overhead, not authored work).
- A prioritized **imperative-verb / keyword** fallback, MOST-SPECIFIC-FIRST so
  "add tests" → Test (not Feature), "update deps" → Chore (not a generic change),
  "revert" → Fix, "optimize/speed up" → Perf, "rename/remove/clean up/extract" →
  Refactor, "add/implement/wire up/support" → Feature, generic "update/improve/
  change" → Refactor. Only truly vague messages (misc/stuff/asdf) fall through to
  "Other". Verified: 40 real-world styles → 39 correct, only 3 "Other" (all
  genuinely meaningless). Benefits reports' work-mix + Statistics + Analysis at once.

**Part B — Simple / Detailed reading-mode toggle (frontend, dashboard reports only).**
A segmented toggle on the report card lets a reader switch between the executive
narrative and the full report.
- `report-insights-panel.tsx`: refactored the section-stripper into
  `dropSectionsByHeading(md, titles)` and added `simplifyReportMarkdown` (drops the
  number-heavy `## Activity` / `## Who did what` / `## Trend` sections, leaving
  `## Summary` + `## What shipped` + the caveats). The stripper now **resets on a
  `---` rule** so the "Good to know" caveats survive even when the section directly
  before them is dropped (verified). `ReportInsightsPanel` gained `showTrend?`
  (hide the numeric trend tiles in Simple mode; insights always stay).
- `openclaw.service.ts` `appendCaveats`: the footer is now a real `## Good to know`
  heading (was bold text) so it's a proper section the filters preserve.
- `reports-manager.tsx`: `readingMode` state (**default "detailed"** — no data hidden
  by surprise; the executive Summary + What shipped already lead every report). Simple
  mode hides the 4 raw-stat tiles + trend tiles + the detail markdown sections and
  force-expands (short narrative). Scoped to the dashboard reports view for now
  (`shared-report.tsx` / Analysis AI-report could get it later).

**Reporting-improvement track status: Phase 1 + 1.5 + 2 + 3 all done.** Reports are
now executive-readable (plain Summary, business words), reliable (noise-free
ranking, "Good to know" caveats, deterministic classification), and smart ("What
shipped" initiative clustering). Open polish: Phase 2.5 structured theme panel;
noise-adjusting the aggregate trend totals; extending the reading-mode toggle to
the share page.

### Appraisal / Increment view — per-employee, evidence-backed (2026-07-13) ✅

**The product's core purpose made concrete** (see the "why": fair, objective
analysis at increment time so a good-but-quiet performer isn't overlooked in favour
of whoever is close to the team lead). A per-employee appraisal view management uses
at raise time. **Deliberately NOT a single score and NOT an AI verdict** (the user's
explicit choice) — it returns balanced, hard-to-game signals + **clickable commit
evidence** + an honest "what data can't see" note, so a human makes the fair call.
Deterministic (no LLM), manager-gated, noise-free line counts. typecheck + lint +
build clean; pure helpers unit-verified (8 cases).

- **`modules/analysis/appraisal.service.ts` `getEmployeeAppraisal(actorId, query)`**
  — manager-gated. Scope = whole org (default) or a project; window = last `months`
  months (default 6, 1-24) or a custom `from`/`to`. Resolves the employee's mapped
  usernames; **no linked identity → an honest empty appraisal** (the mapping gap is
  the finding — that's exactly the invisible person). Single bounded pass (cap 3000
  commits / 30k files, `truncated` flag) over their commits + files computing:
  - **Headline:** noise-free lines ("real work"), updates, active days.
  - **Consistency:** active weeks / total weeks (+%), gap-filled monthly activity —
    catches the steady contributor vs. a pre-review burst.
  - **Focus:** plain-language work mix (`humanizeWorkMix`) + humanized areas.
  - **Ownership:** module breadth + commits in security-critical paths
    (`isSensitivePath`) + which critical areas.
  - **Kind of work:** features / bug fixes / refactors / large updates.
  - **Team comparison:** rank by real work AND by number of updates (two independent
    rankings so nobody leans on one number), same team + window, via the noise-free
    `buildEmployeeLeaderboard`.
  - **Evidence:** the most substantial updates (by real lines, security-critical
    nudged up) each with a **clickable commit URL** (`commitUrl` from repo
    remoteUrl/owner/name + sha) — undeniable proof.
  - **`dataBlindSpots`:** honest notes (counts ≠ difficulty/quality; review,
    mentoring, planning, incident response aren't in Git; truncation).
- **`analysis.schemas.ts`** `employeeAppraisalQuerySchema` (custom range needs both
  from+to); **`GET /api/analysis/appraisal`** on `analysisRouter` (manager, JWT).
- **Web:** nav item **Appraisal** (`Award`, manager-only), `/dashboard/appraisal` →
  `components/analysis/appraisal-manager.tsx` — employee + window + scope selectors,
  a prominent **fairness banner** ("objective evidence to inform a fair decision, not
  a verdict"), headline StatTiles, a monthly-consistency mini bar chart, focus
  (BarList + area chips), ownership / kind-of-work / team-standing cards, a
  **clickable evidence list** (opens the real commit), the "what data can't see"
  guardrail, a **Print / PDF** button (take it to the review), and a "link their Git
  identity" nudge. `api.ts` `getEmployeeAppraisal` + `EmployeeAppraisal`/`AppraisalEvidence`
  types. Loading toggled in event handlers (not effects) per the Next 16 rule.
- **Deferred (v1 boundary):** an optional LLM "what they shipped" narrative button
  (reuse the employee report); active-days-based team rank; export beyond print;
  a per-employee trend across multiple appraisal windows.

### Deferred-polish batch — all 9 small items cleared (2026-07-14) ✅

The remaining "small deferred polish" list (share-page reading mode, chat/MCP
branch, leaderboard-history chart, org-wide awards UI, unmapped nudge, structured
theme panel, bulk CSV import, Telegram `.md` attachment, conversational Telegram)
— all done. typecheck + lint + build clean both workspaces; `parseThemes` (11
cases) and the CSV parser (edge cases) unit-verified.

1. **Share-page reading mode.** `shared-report.tsx` gained the same Simple/Detailed
   segmented toggle as `reports-manager` (default Detailed): imports
   `simplifyReportMarkdown`, gates the stat tiles + trend tiles to Detailed, and
   composes `simplifyReportMarkdown(stripStructuredSections(...))` for Simple. Toggle
   is `print:hidden` so the PDF prints whatever mode is on screen.
2. **chat/MCP branch param.** `integrations/devinsight-mcp-server/server.mjs`
   `devinsight_generate_report` now takes optional `branch` (schema + POST body);
   the backend already threaded `branch` end-to-end, so no API change was needed
   there. For discovery, the context endpoint (`/api/openclaw/tools/context`) now
   returns each repo's branch names via a new `listBranchNamesForRepositories`
   (`activity.service.ts`, no per-repo auth — the repo list is already authorized),
   and `devinsight_context` surfaces them so the agent can resolve valid branches.
3. **Leaderboard-history trend chart.** New `components/statistics/leaderboard-history-panel.tsx`
   (self-loading, `scope` "org"/projectId, Commits/Lines + Daily/Weekly/Monthly
   toggles) renders an `AreaChart` of the snapshot totals (reversed to oldest→newest)
   + a `BarList` of the latest period's leaders. Uses the existing
   `getLeaderboardHistory` helper. Rendered org-scoped on the Overview. Loading is
   toggled in the granularity button handler (not the effect) per the Next 16 rule.
4. **Org-wide awards UI.** `AwardsPanel` was already scope-agnostic; now also rendered
   on the **Overview** with `scope="org"` (`statistics-dashboard.tsx`, guarded on
   `organizationId`, `canManage` imported from `use-session`). Backend already
   supported `scope="org"` on all three award endpoints.
5. **Unmapped-contributor nudge.** New org-wide summary: `getUnmappedSummary`
   (`contributors.service.ts`, deduped by username) + `GET /api/contributors/unmapped-summary`
   + web `getUnmappedSummary`. New `components/statistics/unmapped-nudge.tsx` — a quiet
   amber Overview card ("N contributors not linked… → Map contributors") that returns
   `null` when everyone is mapped or it can't load.
6. **Structured theme panel (Phase 2.5).** New pure `report-engine/themes.ts`
   (`buildThemesPrompt` + robust `parseThemes` — tolerant of fences/preamble, caps 6,
   truncates, size-defaults to medium). `orchestrateReport` does a dedicated best-effort
   clustering call (`buildThemesPrompt(commits)` reusing the already-fetched 60-commit
   sample — **no extra DB/Git call**) only on a successful LLM report with ≥3 commits;
   the result is **persisted in `statisticsJson`** alongside comparison/insights (so
   history + shared reports carry it) and returned on both cache-hit and fresh paths.
   Web: `ReportTheme` type on `GeneratedReport`/`ReportDetail`/`PublicReport`; new
   `ReportThemesPanel` + `stripThemesSection` in `report-insights-panel.tsx`; the panel
   renders (and the prose "## What shipped" is stripped from on-screen markdown only —
   raw markdown keeps it for copy/download/Telegram) in **reports-manager**,
   **shared-report**, and the **Analysis AI-report**. Note: this is a **second** (cheap,
   cached) LLM call per fresh report — intentional per the 2.5 plan; template reports get
   no themes (semantic clustering needs an LLM).
7. **Bulk CSV employee import.** Backend `addEmployeesBulk` (`employees.service.ts`,
   loops `addEmployee` per row with per-row capture: `created`/`skipped`(already a
   member)/`failed`+reason) + `bulkCreateEmployeesSchema` (≤500 rows) +
   `POST /api/employees/bulk`. Web `bulkCreateEmployees` helper + new
   `components/employees/employee-bulk-import.tsx` — collapsible panel with paste/upload,
   a client CSV parser (`name,email,role,github-handles`; header skipped; handles split
   on space/`;`/`|`; malformed rows reported not dropped), a preview, and a
   created/skipped/failed summary. Rendered in the Employees left column (manager-only).
8. **Long Telegram report → `.md` attachment.** `ChannelProvider` gained optional
   `sendDocument?`; `TelegramProvider.sendDocument` uploads via multipart `FormData`
   (`Blob`, no JSON Content-Type) reusing a refactored `assertOk` error mapping.
   `channels.service.ts` new shared `deliverReport(channel, report)`: a report >3600
   chars goes out as a compact **header message + full `.md` attachment** (un-fragmented);
   shorter ones stay chunked text. Both `sendReportToChannel` and
   `deliverReportForSchedule` (scheduler) now route through it. `telegram-format.ts`
   exposes `buildReportHeader` (extracted from `buildReportMessages`).
9. **Conversational Telegram → OpenClaw.** No DevInsight code needed (confirmed): the
   same agent + DevInsight MCP tools that power the web chat answer Telegram messages via
   an OpenClaw **channel registration** (long-polling; no inbound webhook). Documented
   step-by-step in `docs/OPENCLAW_SETUP.md` (new "Conversational Telegram" section) incl.
   the two-Telegram-features distinction (outbound delivery vs inbound chat) and the
   security boundary: Telegram cannot call DevInsight report tools until an authenticated
   account-linking flow can mint the same short-lived tenant context used by website chat.

**Award cards — plain-language enrichment (2026-07-14) ✅** (follow-up to item 4, for
non-technical CEO/management readers). Each "Employee of the month" card now shows
**which projects** the person's work touched, their **Focus** (plain work-mix, e.g.
"mostly new features (45%), bug fixes (30%)"), and the **Areas** (Backend/Database/UI…) —
not just raw commit/line counts. Migration `award_details` adds `EmployeeAward.detailsJson`
(nullable JSON `{ projects, workType, areas }`); computed **deterministically** at
shortlist-generation time by `buildAwardDetails` (`awards.service.ts` — one bounded
commits pass, cap 3000, + a changed-files pass, cap 15000; reuses `classifyCommit` +
`moduleFromPath` + `isNoisePath` + `humanizeWorkMix`/`humanizeAreas`) and **persisted** so
confirmed/history cards keep it. Web `AwardDetails` type + `DetailRow`s (project chips /
Focus / Areas) in `awards-panel.tsx`. Awards created before the migration show no
enrichment until **Regenerate** (`detailsJson: null` → block hidden). `npx prisma generate`
after migrate (the usual gotcha). typecheck + lint + build clean.

**Follow-ups still open (documented boundaries):** noise-adjusting the aggregate trend
totals; a leaderboard-history endpoint that fills gaps for periods with no snapshot yet;
an org-wide unmapped endpoint that counts distinct people across mapped+unmapped (current
one counts unmapped identities deduped by username); making the conversational Telegram
path multi-org.

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
- **E — Background deep-history collection — ✅ DONE (2026-07-12).** Manual per-repo
  trigger (product decision: user-selectable lookback 6mo/1yr/2yr/full — default 1yr;
  polling UI; NO auto-run on connect). Verified end-to-end against a 1,720-commit mock
  (incl. a 1,050-commit month) — bisection, rate-limit pause/resume, crash reclaim,
  cancel, ledger resume all pass; typecheck+lint+build clean both workspaces.
  - **Rate limits (`github.provider.ts` + `git-provider.ts`):** `request()` now detects
    403/429 + (`x-ratelimit-remaining: 0` or `retry-after`) and throws typed
    `GitRateLimitError extends AppError(429, GIT_RATE_LIMITED)` with `resetAt` — BEFORE
    the 403→INVALID_CREDENTIAL branches (that misclassification is fixed). **The
    provider never sleeps**: manual collect surfaces a clean 429, report auto-collect
    turns it into a per-repo warning, only the background worker reschedules.
    `GitProvider.maxCommitsPerList` (GitHub: 1000 = PER_PAGE×MAX_PAGES) tells deep
    collection when to bisect.
  - **Model `CollectionJob`** (+ `CollectionJobStatus` QUEUED/RUNNING/COMPLETED/FAILED/
    CANCELLED; migration `20260712143610_collection_jobs`): range, progress counters
    (branchesTotal/Done, chunksTotal/Done, commitsCollected, currentBranch/Phase),
    worker bookkeeping (claimedBy, heartbeatAt, attempts, resumeAt, cancelRequestedAt),
    timestamps/error. **Partial unique index** (raw SQL in the migration —
    `CollectionJob_one_active_per_repo` WHERE status IN (QUEUED,RUNNING)) enforces one
    active job per repo at the DB level; service pre-checks (409 `JOB_ALREADY_ACTIVE`)
    and catches P2002 for the race.
  - **`ingestBranchRange` parameterized** (`IngestOptions`: maxDetailCommits,
    detailDelayMs, bisectOnTruncation, onProgress) — existing callers unchanged. **Two
    shared-path fixes:** (1) *checkpoint flaw*: a capped/cancelled/errored run now
    records partial coverage `[oldestCollected+1ms, until]` (listings are newest-first),
    so every pass shrinks the missing range — repeated manual Collects now PROGRESS
    through >150-commit windows instead of refetching; a mid-window error checkpoints
    before rethrowing. (2) *false coverage on listing truncation*: a page-capped listing
    (≥1000) no longer records full coverage (was silently claiming unfetched commits).
    `capped` now surfaces: `ingestRepository` → `collectActivity` → web
    `CollectActivityResult.capped` → amber "hit the per-run cap" notice.
  - **`modules/activity/deep-collection.ts`:** `startDeepCollection` (manager-gated,
    lookbackDays 30..3650), `listCollectionJobs` (member; latest per repo),
    `cancelDeepCollection` (QUEUED → atomic immediate cancel, RUNNING →
    `cancelRequestedAt`, worker finalizes at next progress beat), `runCollectionJob`
    (worker-only): syncBranches → plan chunks per branch from the coverage ledger
    (30-day chunks ≤730d lookback, 120-day beyond; newest-first) → per chunk
    `ingestBranchRange` with cap=∞, 150ms detail throttle, bisection, onProgress
    (one query = heartbeat + commitsCollected + cancel check every 25 commits).
    Permanent errors (INVALID_CREDENTIAL/NO_CREDENTIAL/REPO_NOT_ON_PROVIDER/
    PROVIDER_UNSUPPORTED) → FAILED; GitRateLimitError + transient → rethrown to worker.
  - **`modules/activity/collection-worker.ts`** (started from `main.ts` after
    `startScheduler()`): 5s tick, re-entrancy guard, one job at a time per instance.
    Claims via conditional `updateMany` (schedules pattern) — QUEUED-with-resumeAt-due
    OR RUNNING-with-stale-heartbeat (>3min = dead instance reclaim, conditioned on the
    stale heartbeat). Rate limit → requeue QUEUED with `resumeAt = clamp(resetAt+5s,
    now+5s, now+90min)`; transient → backoff 60s×attempts; **runs that made chunk
    progress reset `attempts`**; >5 no-progress attempts → FAILED.
  - **Routes** (activityRouter, `/api/repositories`): `GET /collection-jobs?organizationId=`
    (poll + resume-on-reload), `POST /:id/deep-collect` (202; body `{lookbackDays}`),
    `POST /:id/deep-collect/cancel`. Verified: repositoriesRouter has no `GET /:id`,
    so the literal path isn't shadowed. AuditLog on start/cancel.
  - **Web:** `api.ts` `CollectionJob` type + `startDeepCollection`/`listCollectionJobs`/
    `cancelDeepCollection`; `repositories-manager.tsx` — per-row **Deep collect** button
    → inline lookback select (6mo/1yr/2yr/Full=3650d) + Start; progress row under the
    repo name (status pill, BarList-style track/fill %, commits+branch counts, Cancel);
    **polling** (first in app): `setInterval` 2.5s only while a job is active, latest
    jobs loaded on mount for resume-after-reload, one `refresh()` when a job finishes;
    stale COMPLETED/CANCELLED badges age out in `toJobMap` (24h; FAILED stays until
    dismissed — Date.now() kept out of render for the `react-hooks/purity` rule).
    Collect + Deep collect disabled while that repo has an active job.
  - **Known trade-offs (documented):** coverage writes from a concurrent report
    auto-collect can race a deep job only in the *under-coverage* (safe) direction;
    bisection floor (≤1h window still >1000 commits) collects the newest 1000 +
    partial-checkpoints (warn logged); GitHub filters since/until by committer date
    while we store author date (pre-existing).
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

### Automated tests — Phase 15 kickoff: Vitest unit suite (2026-07-14) ✅

The long-standing "no tests" gap (flagged as the #1 risk in
`docs/architecture/devinside-system-audit.md`) is now **started**. A **Vitest unit
suite** covers the backend's pure/deterministic cores — the highest-value, most
bug-prone logic (date math, coverage intervals, classification, plain-language),
historically the source of several fixed bugs (see Batches 1/2/7). **87 tests across
9 files, all green.** typecheck + lint + build still clean (tests are excluded from
all three — see below).

- **Runner:** Vitest 4 (`apps/api` devDep). Scripts: `test` (`vitest run`),
  `test:watch` (`vitest`) in `apps/api/package.json`; root `test` fans out via
  `npm run test --workspaces --if-present`. Run everything with `npm test`.
- **Config `apps/api/vitest.config.ts`:** Node env; `include: ["tests/**/*.test.ts"]`.
  Two DevInsight-specific bits: (1) a **pre-resolver plugin** that maps NodeNext
  `.js` import specifiers → the real `.ts` files (Vite doesn't do this by default,
  and the codebase writes explicit `.js` extensions); (2) a **hermetic `test.env`**
  (throwaway `DATABASE_URL`/`JWT_ACCESS_SECRET`/`GIT_TOKEN_ENCRYPTION_KEY`) so
  importing `config/env.ts` (Zod-validated at load) never depends on a real `.env` —
  CI-ready. None of these are real; the unit suite opens no DB/network.
- **Tests live in `apps/api/tests/unit/**` — OUTSIDE `src`**, so `tsc -p
  tsconfig.json` (`include: ["src"]`) and `eslint src` never touch them → typecheck,
  lint, and build are unaffected. Trade-off: test files themselves aren't
  type-checked/linted by the existing scripts (Vitest's esbuild transform still runs
  them); acceptable for now.
- **Covered (pure cores):** `token-cipher` (AES-GCM round-trip, tamper/integrity,
  malformed payload, last4), `activity/coverage.ts` (`mergeIntervals`/
  `subtractCovered` — overlap/touch/disjoint/clip/fully-covered), `report-engine/
  commit-classifier` (prefixes, merge→Chore, most-specific-first keyword fallback,
  Other), `plain-language` (activityLevel thresholds, work-mix "mostly", area
  humanize+dedup, summary grammar, caveats), `comparison` (deltas, hasBaseline,
  rank up/down/new/dropped, cap 6), `insights` (all rules + cap 6), `themes`
  (`parseThemes` fence/preamble tolerance, size default, caps, truncation),
  `schedules.service.computeNextRun` (**DST spring-forward, MONTHLY Jan-31→Feb-28
  clamp, non-DST Dhaka**), `openclaw.tools.resolvePeriod` (**custom-range inclusive
  local-day, inverted→throw, last_month/this_month/relative windows**).
- **Two initial test-expectation errors were corrected to match ACTUAL behavior**
  (not source bugs): `decryptToken(encryptToken(""))` throws (empty ciphertext →
  empty base64 → guard) — pinned as documented behavior; and `"improve error
  handling"`→`Fix` (the "error" keyword wins over the generic "improve" verb) —
  pinned as a documented precedence case. The source behaves sensibly; no product
  code was changed for tests.
- **Still open (Phase 15 remainder):** integration tests — add **Supertest** and
  exercise `orchestrateReport` with mocked `GitProvider`/`LLMProvider` (+ a test DB
  or Prisma mock), then the auth/RBAC and schedule paths; **`apps/web`** has no
  tests; **CI** (GitHub Actions running test/typecheck/lint/build) is still absent
  (the audit's Phase 1 pairs tests WITH CI).

---

## 12. Code Quality (SonarQube) integration

**Goal:** add an objective, quantitative **code-quality** signal (bugs, vulnerabilities,
coverage, per-developer issues) alongside DevInsight's activity data — serving the same
fairness mission (evidence, not verdict). Built to run **self-hosted (SonarQube CE) now**,
with a **config-only path to SonarCloud** later.

### 12.1 What is built (verified end-to-end on real data)

- **Local SonarQube stack** — `docker-compose.sonar.yml` (SonarQube CE + its own Postgres;
  NOT the app's Neon DB), included with the sibling OpenClaw Compose model by root
  `compose.yml` under the `devinsight` Docker project. Root `sonar-project.properties`
  scopes the monorepo
  (`apps/api/src`, `apps/web/src`, `packages/shared/src`), excludes generated/build/test
  paths, and points coverage at `apps/api/coverage/lcov.info`.
- **Coverage wiring** — `@vitest/coverage-v8` + `coverage` block in `apps/api/vitest.config.ts`
  (v8, `lcov` reporter) + `test:coverage` script.
- **`scripts/sonar-scan.sh`** — one command: regenerates coverage, then runs the Dockerized
  `sonar-scanner-cli` against the local server (macOS uses `host.docker.internal`). Reads
  `SONAR_TOKEN` from env.
- **`CodeQualityProvider` abstraction** (`apps/api/src/modules/code-quality/`) — mirrors the
  mandatory provider pattern (`llm-provider.ts` shape): `code-quality-provider.ts` (interface
  + `capabilities`), `code-quality-registry.ts` (env-selected factory), `sonarqube.provider.ts`
  (impl: `getMeasures`, `getIssuesByAuthor`). **Reads the SonarQube Web API** (Basic auth,
  `token:`); appends `organization` when `SONAR_ORGANIZATION` is set, so the SAME class works
  against SonarCloud. `capabilities.branchAnalysis / pullRequestAnalysis` are `false` for CE,
  auto-`true` when an organization is set.
- **`code-quality.service.ts`** — joins SonarQube's per-git-author issues to employees via the
  existing `EmployeeGitAlias.email` + `ContributorIdentity.authorEmail`→`EmployeeGitMapping`
  tables (case-insensitive). Degrades gracefully (`available:false`) when `SONAR_TOKEN` is
  unset — same "never hard-fail" philosophy as reports.
- **Endpoint** — `GET /api/code-quality/overview?organizationId=&projectKey=` (`requireAuth` +
  `requireOrganizationMember`), mounted at `/api/code-quality`.
- **UI** — `/dashboard/code-quality` (manager-only nav, 🛡️): 3 rating badges
  (Reliability/Security/Maintainability, A–E colored), measure tiles (bugs, vulns, smells,
  coverage %, duplication %, hotspots, tech-debt, LOC), and a **By developer** table (git author
  → employee where mapped, bug/vuln/smell counts + severity chips). `lib/api.ts` helper
  `getCodeQualityOverview`.
- **Auto-scan on push** — `.githooks/pre-push` launches `scripts/sonar-scan.sh` in the
  **background** (push is never blocked), reading `SONAR_TOKEN` from `apps/api/.env`; skips
  gracefully if token missing / server down. Enabled via `git config core.hooksPath .githooks`
  (`scripts/install-hooks.sh`). Log at `.sonar-scan.log` (gitignored).

**Verified:** provider returns correct measures + author breakdown against the real local
server; the HTTP endpoint returns populated data (temp instance with `SONAR_TOKEN`) and
`available:false` without it; api `typecheck`/`lint`/`test` (129)/`build` and web
`typecheck`/`lint` all pass; the pre-push hook returns instantly and completes a scan
(`ANALYSIS SUCCESSFUL`).

### 12.2 Important constraints (SonarQube Community Edition)

- **Main branch only** — no branch/PR analysis or PR decoration (that's Developer Edition /
  SonarCloud). Every scan lands on the project's single "main" view; scanning feature branches
  pollutes it. Clean CE pattern = **scan on push to main (post-merge)**.
- **Attribution is blame-based** (git author of the last change to a line) — fair *evidence*,
  not exact fault. Raw counts should be **normalized** (per-KLOC / new-issues) before any
  per-developer judgement, or it becomes the favoritism tool the product exists to counter.
- **Per-developer coverage / ratings do NOT exist** in SonarQube (those are file/project-level);
  the "how much" per person still comes from DevInsight's own commit data.

### 12.3 Next: multi-tenant (client repos via the existing GitHub App / CI)

The client-repo path plugs into the **existing** GitHub App + CI pipeline (`modules/github-app`,
`modules/ci` — `ci.service.ts` already does detect-stack → generate-workflow → PR → merge, and
`devops-provider.ts` already stubs SonarQube extension points). Four pieces:

1. **Workflow step** — add SonarQube steps to `ci/workflow-templates.ts` (bump `node@v1`→`v2`);
   the existing "update via PR" mechanism ships it to onboarded repos. The generated workflow
   already triggers `on: push: branches:["main"]`, so merge-time analysis is one step away.
2. **Repo secret injection** — the one genuinely missing capability: add `putRepoSecret` to
   `DevOpsProvider` (libsodium-encrypt → `PUT /repos/{o}/{r}/actions/secrets/{name}`) to set
   `SONAR_TOKEN` / `SONAR_HOST_URL` in the client repo.
3. **Provisioning** — extend the provider with `ensureProject` + `generateToken` per repo; store
   a per-repo `SonarProject { repositoryId, projectKey, tokenCipher }` (reuse `token-cipher.ts`).
4. **Read results** — already done (§12.1); just resolve `projectKey` from the repo mapping.

**SonarCloud migration = config, not code:** set `SONAR_ORGANIZATION` + `SONAR_BASE_URL`, add a
`sonarcloud.provider.ts` (same interface), swap the workflow action name. Controllers/services/UI
unchanged; `capabilities` flip on and the PR-analysis UI lights up.

### 12.4 Per-developer code quality in the Appraisal (2026-07-15)

The code-quality signal is now woven into the **Appraisal** (the product's fairness core),
not just the standalone page.

- **`Repository.sonarProjectKey`** (nullable, migration `repository_sonar_project_key`) maps a
  tracked repo to its SonarQube project. Set/clear via `PATCH /api/repositories/:id/sonar-project`
  (manager-gated) — a small "+ Sonar key" control per repo on the Repositories page.
- **`getEmployeeAppraisal`** now returns a `codeQuality` block: it resolves the employee's git
  emails (account email + `EmployeeGitAlias.email` + mapped `ContributorIdentity.authorEmail`
  **+ the `authorEmail` of their stored commits, matched by username** — this last source is the
  reliable link, since SonarQube attributes by git-blame email and the real commit email is often
  neither the account nor a declared alias email, as the GitHub contributors API never exposes it),
  reads SonarQube issues-by-author for the SonarQube projects mapped to the in-scope repos, and
  sums the ones attributed to this employee (bugs / vulns / smells + severity). **Best-effort:**
  a missing/unconfigured/unreachable SonarQube degrades to `available:false` and NEVER fails the
  appraisal (same philosophy as the LLM fallback). When present, two **fairness caveats** are
  added to `dataBlindSpots` (blame-based/all-time; raw counts favour those who write more).
- **UI:** a "Code quality (SonarQube)" card on the Appraisal page (issue tiles + severity chips +
  the source project keys), or an actionable hint to map a Sonar key when none is set.
- **Verified end-to-end on real data:** a seeded employee whose git email == the SonarQube author
  got the correct attributed totals (2 bugs / 1 vuln / smells, with severities) through the real
  service + real SonarQube; api typecheck/lint/129 tests/build + web typecheck/lint all pass.

**Deliberately NOT a normalized score yet** — raw attributed counts + caveats. A future
improvement is per-KLOC / new-code-period normalization once windowed issue attribution exists
(CE only gives the current main-branch snapshot).

### 12.5 Friendly setup + Quality Gate (A+B, 2026-07-15)

Made the integration self-serve instead of env/CLI-driven.

- **Per-org connection** — `CodeQualityConnection` model (migration `code_quality_connection`):
  baseUrl + AES-256-GCM-encrypted token (token-cipher, never returned) + optional `organizationKey`
  (SonarCloud). Endpoints (all manager-gated): `GET/PUT/DELETE /api/code-quality/connection`,
  `POST /api/code-quality/connection/test`, `GET /api/code-quality/projects`.
- **Provider is now config-driven** — `SonarQubeProvider` takes `{baseUrl, token, organizationKey}`;
  `getCodeQualityProvider(organizationId)` is **async**, resolving the org's saved connection
  (token decrypted) and **falling back to env** (`SONAR_*`) so the local dogfood path is unchanged.
  New provider methods: `getQualityGate`, `listProjects`, `validate`. Callers (`code-quality.service`,
  `appraisal.service`) now `await getCodeQualityProvider(orgId)`.
- **Quality gate** — the overview now returns `qualityGate` (OK/ERROR/WARN/NONE + failed conditions);
  a pass/fail badge shows on the Code Quality page.
- **UI (Code Quality page)** — a connection panel (Connect/Test/Save/Reconfigure/Disconnect,
  shows "using env default" when unconnected), a **project dropdown** (from `listProjects`, replacing
  the free-text key; manual entry only when nothing is listed), the gate badge, and **direct links**
  into SonarQube.
- **UI (Repositories page)** — the per-repo "+ Sonar key" prompt is now a **dropdown** of the org's
  SonarQube projects, plus a header **"Auto-map Sonar"** that name-matches repos → projects in bulk.
- **Verified end-to-end** (temp instance, real token): connection false→test(valid)→save(connected,
  token never returned)→overview(gate:ERROR, bugs:2)→delete; env fallback lists `devinsight`; both
  workspaces typecheck/lint, api 129 tests + build pass.

**SonarCloud migration stays config-only** and is now even closer: a connection with an
`organizationKey` flips capabilities on. Multi-tenant (§12.3) reuses this same per-org connection
as its foundation.

### 12.6 Code health on the Overview (C1, 2026-07-15)

First slice of "surface quality in context" (workstream C):

- **Org-wide rollup** — `getCodeQualitySummary` + `GET /api/code-quality/summary`: across every repo
  with a `sonarProjectKey`, sums bugs/vulns/smells/hotspots, computes ncloc-weighted coverage, and the
  **worst quality gate**. Best-effort (a failing project is skipped); `available:false` when nothing is
  connected/mapped.
- **Overview "Code health" card** (`components/statistics/code-health-card.tsx`) — self-contained,
  manager-only, **stays silent** when unavailable (same quiet philosophy as the other Overview cards).
  Shows bugs / vulnerabilities / coverage / code smells + a gate chip + a link to the Code Quality page.
- Verified on real org data (1 project, gate ERROR, coverage 10.4%); both workspaces typecheck/lint,
  api build pass.

**C2 done (2026-07-15):** the SAME summary now takes an optional `projectId`
(`GET /api/code-quality/summary?...&projectId=`), and the SAME `CodeHealthCard` (with a `projectId`
prop) renders on the **project detail page** (before the embedded analysis), scoped to that project's
repos. Verified: project with a mapped repo → available (gate ERROR, bugs 2); a project with none →
silent (`no_project_mapped`).

**Still in workstream C:** C3 report code-health section — needs a design call on snapshot-vs-window
(SonarQube gives a current snapshot; reports cover a period) before building.

### 12.7 Trends (D) + report code-health (C3) — 2026-07-15

**D — trend over time.** `CodeQualitySnapshot` model (migration `code_quality_snapshot`): one row per
`[organizationId, projectKey, dayKey]` (local day), **upserted** to the latest capture. Recorded two
ways: (1) **capture-on-load** — `getCodeQualityOverview` records today's snapshot best-effort (never
fails the overview); (2) **scheduler sweep** — `captureCodeQualitySnapshots` on an hourly throttle in
the scheduler tick (mirrors the leaderboard-snapshot sweep). `GET /api/code-quality/trend?...&projectKey=`
returns the series oldest→newest. UI: a **Trend over time** chart on the Code Quality page (reuses
`AreaChart`) with a Coverage / Bugs / Code-smells toggle; shows a "collecting" note until ≥2 points.
Verified: capture-on-load records today; multi-point series returns in order (coverage 8→9.5→10.1).

**C3 — report code-health (now window-accurate via D).** `buildCodeHealthMarkdown(orgId, {projectId?,
repositoryId?}, from, to)` builds a deterministic `## Code health` section from snapshots: current
gate/bugs/vulns/smells/coverage **plus "(was N)" deltas** vs the state at the period start (falls back
to the earliest snapshot when history began mid-period). It is appended to the persisted report markdown
right after the caveats footer (both LLM and template paths, so every channel + the cache carry it), and
returns "" when nothing is mapped/captured so most reports are unaffected. Verified on real data: delta
block ("Bugs 2 (was 6)", "Coverage 10.1% (was 5%)") for a mapped project; "" for an unmapped one.

Both workspaces typecheck/lint, api 129 tests + build pass. **Workstream C + D complete.**

### 12.8 Fairness normalize (E) — 2026-07-15

Sharpens the fairness mission on the code-quality signal.

- **E1 — per-KLOC normalization (appraisal).** `computeEmployeeCodeQuality` now also returns
  `linesAuthored` (all-time sum of the employee's commit additions, by username) and `perKLoc`
  (issues per 1,000 lines authored; left null under ~500 lines where the ratio is too noisy). The
  appraisal Code Quality card shows "≈ N issues per 1,000 lines authored", and the fairness caveat
  is reworded to point at it (still honest: blame ≠ authorship, issues are all-time vs lines added).
  Verified real data: 377 issues / 147,576 lines → 2.6 per KLOC.
- **E2 — team-level codebase health (Analysis).** The project-scoped `CodeHealthCard` now also renders
  on the standalone Analysis page (`!embedded` only, to avoid duplicating the project-detail card),
  framing quality as the **team's** codebase health rather than one person's — reducing the
  "blame one person" risk.

Both workspaces typecheck/lint, api 129 tests + build pass. **Workstream E complete — the code-quality
integration arc (setup → page → gate → Overview/project/Analysis → appraisal + per-KLOC → trends →
report) is now feature-complete for the self-hosted, single-org phase.** Remaining big items: multi-tenant
(§12.3) + VPS deploy.

### 12.9 Multi-tenant auto-scan (client repos via GitHub Actions) — ✅ DONE (2026-07-16)

The §12.3 plan is now implemented end-to-end — a manager can turn on automated SonarQube scanning for a
client repo, and each push to its default branch scans and reports back to DevInside. This became possible
because the app is now on a **public VPS** (`https://devinside.softathena.com`): a client repo's GitHub
Actions runner can finally reach the SonarQube server (localhost was unreachable from GitHub's runners).

**Two SonarQube URLs (the key architectural point):**
- **Internal** `SONAR_BASE_URL=http://sonarqube:9000` — how the API reaches SonarQube (Docker network) to
  provision + read results.
- **Public** `SONAR_PUBLIC_URL=https://devinside.softathena.com/sonarqube` (new env) — the URL injected into
  the client repo, used by its runner to push scan results over the internet. Routed through nginx (HTTPS)
  so the analysis token isn't sent in clear text (`deploy/nginx.conf` `/sonarqube/` in the 443 block).

**The four pieces (all built):**
1. **Sonar-aware workflow** — `ci/workflow-templates.ts` is versioned (now `node@v3`). When a repo is provisioned,
   `generateWorkflow(stack, { sonarProjectKey })` emits a separate **`code_quality` job** that runs
   the SonarSource action pinned to the immutable v8.1.0 commit **only on push**
   (`if: github.event_name == 'push'` — CE analyzes the main branch only) with `fetch-depth: 0`
   (full history for accurate SCM-blame attribution). The v3 job installs dependencies, runs detected
   `prisma:generate` / `test:coverage` preparation, and waits up to 300 seconds for the Quality Gate, so
   a red gate truthfully fails `code_quality`. Token + host come from injected repo secrets, never baked in.
   Unit-tested (`stack-detector.test.ts`, `workflow-templates.test.ts`).
2. **Repo secret injection** — new `DevOpsProvider.putRepoSecret` (`github-devops.provider.ts`): fetches the
   repo's Actions public key, **libsodium sealed-box** encrypts (new dep `libsodium-wrappers`), `PUT
   /repos/{o}/{r}/actions/secrets/{name}`. A 403 maps to `DEVOPS_SECRETS_PERMISSION_DENIED` (the App needs
   **`secrets: write`**). ⚠️ **Operator prerequisite: add `Secrets: read & write` to the GitHub App
   permissions and re-accept the installation**, else provisioning 403s.
3. **Provisioning** — new `SonarQubeProvider.ensureProject` + `generateProjectToken` (admin API:
   `/api/projects/create` idempotent, `/api/user_tokens/generate` type=PROJECT_ANALYSIS_TOKEN, revoke-first
   for repeatability). New `code-quality/provisioning.service.ts` `provisionRepositoryCodeQuality` orchestrates:
   ensure project → mint token → inject `SONAR_TOKEN` + `SONAR_HOST_URL` secrets → persist
   `Repository.sonarProjectKey` + encrypted `sonarTokenCipher` + `sonarProvisionedAt` (migration
   `repository_sonar_provisioning`) → `enableCi` opens/refreshes the workflow PR (now **content-aware**: an
   already-merged workflow that now needs the Sonar job triggers an update PR instead of no-op). Manager-gated
   + audit-logged. `deprovision…` clears the marker (project/results kept).
4. **Read results** — already existed (§12.1); the mapped `sonarProjectKey` flows into the existing overview /
   appraisal / trends.

**Endpoints:** `POST /api/code-quality/provision` + `DELETE /api/code-quality/provision` (both manager-gated).
**UI:** an "Enable scan" / "Scanning on" toggle per repo on the Repositories page (next to the Sonar-key map),
using `provisionRepositoryCodeQuality` / `deprovisionRepositoryCodeQuality`. Repo DTO gained `codeQualityScan
{ provisioned, provisionedAt }`.

**Verified locally:** api typecheck/lint/**146 tests**/build + web typecheck/lint/build all pass. **NOT yet
run against a real client repo** — the live e2e (grant App `secrets: write` → set `SONAR_PUBLIC_URL` on the
VPS → deploy → "Enable scan" on a repo → merge PR → push → confirm scan lands) is the next step.

**Production connection hardening (2026-07-16):** The VPS SonarQube 26.7 instance returned HTML for the
provider's legacy Basic-token requests, which caused `/api/code-quality/projects` to fail while parsing JSON.
The provider now uses Bearer authentication for all SonarQube reads and writes, and maps non-JSON or malformed
JSON responses to the typed `CODE_QUALITY_INVALID_RESPONSE` error. The Code Quality client now loads connection
and project metadata independently, preserves the environment-fallback connection when project loading fails,
and settles to a stable empty-project state instead of showing an infinite loading indicator. Four provider
regression tests cover the updated authentication and response handling.

**Managed workflow v3 hardening + DevInsight live dogfood (2026-07-17):** `node@v3` replaces the
vulnerable `sonarqube-scan-action@v4` line (CVE-2025-58178) with the immutable v8.1.0 commit, detects exact
root `prisma:generate` / `test:coverage` scripts, prepares the Sonar job's own dependencies and coverage,
and enforces the Quality Gate with a 300-second wait. The root now fans out `npm run test:coverage` across
workspaces; the CI inspection web type mirrors both new capability flags. Verified locally: 162 tests,
workspace typecheck/lint/build, coverage generation, and a real YAML parse of the generated `verify` +
`code_quality` jobs all pass. Live dogfood used the production Neon record + GitHub App and the exact
panel service: it created the tenant-safe Sonar project, generated/injected project-scoped secrets, opened
and merged managed-workflow PR #4, and ran both jobs successfully. Sonar analyzed merge revision `42d1595d`
with Quality Gate `OK` and 13.3% imported coverage; DevInsight's tenant-guarded read path returned the live
measures. The verified managed workflow is now canonical; the temporary handwritten CI was removed.

**SonarCloud migration stays config-only** (the same `SonarQubeProvider` methods exist; SonarCloud project
creation differs but the read path is identical).

## 13. PR / code-review metrics (collaboration) — Increment 1 (backend), 2026-07-15

Fills the product's biggest fairness blind spot: it measured code volume + code quality but not
**review/collaboration** work (the "quiet reviewer/mentor" the appraisal caveat itself calls out).

**Increment 1 — backend foundation (done + verified):**
- **Models** `PullRequest` + `PullRequestReview` (migration `pull_requests_reviews`), deduped by
  `[repositoryId, number]` and `[pullRequestId, externalId]`.
- **Provider** — `GitProvider.listPullRequests` (all states, newest-first, capped) + `listPullRequestReviews`
  (per PR), implemented in `GitHubProvider` (`/pulls?state=all`, `/pulls/{n}/reviews`; `merged` derived
  from `merged_at`).
- **Collection** — `collectPullRequests(actorId, repositoryId)` (manager-gated, uses the repo's stored
  credential / App installation via `resolveRepositoryToken`): upserts PRs + reviews for the newest 150
  PRs; `POST /api/pull-requests/collect`.
- **Metrics** — `getReviewMetrics(actorId, {organizationId, projectId?, from?, to?})`: per-developer
  PRs opened/merged and reviews given (approvals / changes-requested), each **joined to an employee** via
  the git-login → alias/mapping tables; `GET /api/pull-requests/review-metrics`.
- **Verified on real data**: collected 1 PR from `tanzilmia/dev-insight-saas`, author mapped to the
  employee; a seeded review aggregated correctly (reviewsGiven/approvals, reviewer mapped). api
  typecheck/lint/129 tests/build pass.

**Increment 2 (next, NOT built):** surface it in the UI — a "Collect PRs" trigger, and a "Collaboration &
review" card on the Analysis (team) + Appraisal (per-employee) pages, so review/mentoring work is finally
visible alongside commits. Consider folding a per-employee collaboration block into `getEmployeeAppraisal`.

**Increment 2 — surfaced in the UI (done + verified):**
- **Appraisal** — `getEmployeeAppraisal` now returns a `collaboration` block (PRs opened/merged +
  reviews given / approvals / changes-requested for the employee's git logins, within the window;
  `hasData` false when no PRs are collected). A "Collaboration & review" card renders it, or a hint to
  collect. Verified real data (Tanzil: 1 PR opened/merged).
- **Repositories page** — a per-repo **"PRs"** button (`collectPullRequests`) triggers collection.
- **Analysis page** — a self-contained **`CollaborationPanel`** (team, per-project): per-developer PRs
  opened/merged + reviews given (from `getReviewMetrics`), stays silent until PRs are collected.
- Both workspaces typecheck/lint, api 129 tests + build pass.

**PR/review metrics complete for the single-org phase.** Possible follow-ups: review latency / time-to-merge,
reviewer↔author matrix (who reviews whom), scheduled PR collection in the tick, and folding collaboration
into the LLM report narrative.

## 14. Production deployment (VPS + Docker) — ✅ FULLY LIVE (2026-07-16)

**SHIPPED: Full end-to-end production deployment on Ubuntu VPS with HTTPS.**

The whole app now ships as a Docker stack for a single VPS at **https://devinside.softathena.com**
(Ubuntu 24.04, 7.6 GB RAM — comfortably runs the core stack + SonarQube CE, which
alone uses ~2.2 GB). Dashboard fully operational, all services running.
**Local dev is unchanged** (`npm run dev` still runs host processes; the standalone build is
gated behind `NEXT_OUTPUT=standalone`, only set by the web Dockerfile). Full
operator guide in **`docs/DEPLOYMENT.md`**.

**Production architecture:**
- **Database:** Neon PostgreSQL (external, reuses same secrets as local for backward compat).
- **Web + API:** Docker containers (nginx + Next.js web + Express API).
- **Reverse proxy:** nginx (`deploy/nginx.conf`): `/api/*` → api:4000, `/` → web:3000, HTTP
  and HTTPS (port 443, certificates in `/opt/devinsight-certs/`).
- **TLS/HTTPS:** Let's Encrypt certificates via Certbot (live domain devinside.softathena.com).
  Auto-renewal via systemd timer (renews every 90 days, triggers `docker compose restart nginx`).
- **DNS:** Vercel (A record "devinside" → VPS IP 144.79.249.78).
- **Optional services via Compose profiles:** `sonar` (SonarQube CE + Postgres) and `openclaw`
  (MCP bridge + external gateway image).

**Files (scaffolding verified, then fully exercised on live VPS):**
- `apps/api/Dockerfile` (multi-stage: npm ci → prisma generate → tsc, runner keeps tree).
  `docker-entrypoint.sh` runs `prisma migrate deploy` on start.
- `apps/web/Dockerfile` (Next.js standalone, `NEXT_PUBLIC_API_URL=""` for same-origin API).
- `apps/web/next.config.ts` — `output:"standalone"` + `outputFileTracingRoot` only when
  `NEXT_OUTPUT=standalone`.
- `integrations/devinsight-mcp-server/Dockerfile` (MCP bridge, service key + token from env).
- `docker-compose.prod.yml` (project `devinsight-prod`, services with profiles).
- `deploy/nginx.conf` (HTTP → HTTPS redirect, SSL cert paths, proxy to web/api/sonar).
- `deploy/env.prod.example` → `deploy/.env.prod` (gitignored, copy + fill in Neon URL + secrets).
- `deploy/openclaw/` (gateway state mount).
- Root `package.json` scripts: `prod:up`, `prod:core`, `prod:down`, `prod:logs`, `prod:ps`, `prod:config`.

**Deployment steps (fully tested 2026-07-16):**
1. VPS prep: Docker Engine + firewall (ports 80, 443 open).
2. Clone repo, `cp deploy/env.prod.example deploy/.env.prod`, fill in secrets.
3. Domain + DNS: Register domain, point A record at VPS IP (Vercel DNS in this case).
4. SSL: `certbot certonly --standalone -d yourdomain.com`, mount certs into nginx
   via `docker-compose.prod.yml` volume + `deploy/nginx.conf` paths.
5. Start: `npm run prod:up` (or `prod:core` for web+api+nginx only).
6. Verify: `curl https://yourdomain.com` (dashboard) + `curl https://yourdomain.com/health` (API).

**Verified end-to-end (2026-07-16):**
- Dashboard loads over HTTPS (https://devinside.softathena.com) ✅
- User authentication working (JWT from local storage) ✅
- Overview statistics, charts, data display all functional ✅
- API `/health` responds (HTTP/2 200) ✅
- Prisma migrations auto-applied on container start ✅
- Scheduler + collection worker running in-process ✅
- **Single API instance only** (in-process claiming via atomic `updateMany`; multi-instance needs shared queue).

**Certbot auto-renewal:**
- Certificate expires 2026-10-14 (90 days).
- Systemd timer runs `certbot renew` daily; triggers `docker compose restart nginx` on success.
- No manual intervention needed (if the renewal hook script is configured).
