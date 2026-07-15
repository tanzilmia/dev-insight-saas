# DevInsight AI — Project Overview

> A shareable summary of **what this system does**, **every feature that is implemented**, and **the full technology stack**. Prepared as context to share with an LLM (e.g. ChatGPT).

---

## 1. What the product is

**DevInsight AI** is an AI-powered **developer-intelligence / team work-report SaaS**.

A manager connects GitHub (via a Personal Access Token), syncs repositories, maps Git contributors to their real employees, and then generates **AI-written, plain-language work reports** answering: *"What did this repo / person / team actually ship this period?"* — all from real Git commit data.

**Core purpose (the "why"):** provide **fair, evidence-based employee analysis at appraisal/increment time**, so a good-but-quiet performer isn't overlooked in favor of whoever is closest to the team lead. Reports and appraisals are deliberately **evidence + signals, not a single AI score or verdict** — a human makes the final call.

The full value chain works **end-to-end on real data**:

```
GitHub PAT (encrypted) → repo sync → contributor auto-mapping →
branch-aware commit collection → smart report engine (coverage ledger + cache) →
LLM report (Markdown) → dashboard / share link / Telegram / chat
```

---

## 2. Technology stack

### Monorepo & tooling
- **npm workspaces** (`apps/*`, `packages/*`), **Node.js ≥ 20**
- **TypeScript** across the stack (backend TS 6 / NodeNext ESM; frontend TS 5)
- **ESLint** (flat config) + `typescript-eslint` for linting
- No test runner installed yet (verification done by driving the running API against mock servers)

### Backend — `apps/api` (`@devinsight/api`)
- **Express 5** (ESM, `"type": "module"`)
- **Prisma 7** ORM with the **driver-adapter** pattern (`@prisma/adapter-pg` + `pg`) — connection supplied at runtime, no `url` in the schema block
- **PostgreSQL** database (hosted on **Neon**)
- **Zod 4** for request validation (per-route `.parse()`)
- **jsonwebtoken** — JWT auth (7-day access tokens)
- **bcryptjs** — password hashing
- **helmet** + **cors** — security headers / CORS
- **pino** + **pino-http** — structured logging
- **dotenv** — env loading (validated centrally in `config/env.ts`)
- **Node global `fetch`** for all outbound HTTP (GitHub API, LLM, Telegram) — no axios/octokit dependency on the backend
- **Node `crypto`** — AES-256-GCM token encryption

### Frontend — `apps/web` (`@devinsight/web`)
- **Next.js 16** (App Router) + **React 19**
- **Tailwind CSS 4** (CSS-first, no `tailwind.config.js`; tokens + `@theme inline` in `globals.css`)
- **axios** — the single data layer (`lib/api.ts`, ~70 typed helpers, JWT request interceptor)
- **react-markdown** + **remark-gfm** — Markdown report rendering
- **lucide-react** — icons
- **clsx** / **tailwind-merge** / **class-variance-authority** — className utilities
- Custom **hand-rolled SVG/CSS charts** (no charting library)
- Auth token in `localStorage`; custom theme provider (light/dark via `data-theme`)
- *(Installed but currently unused: TanStack Query/Table, Zustand — state is component-local `useState`/`useEffect`.)*

### AI / LLM layer
- **Provider-agnostic** `LLMProvider` abstraction — any **OpenAI-compatible** chat-completions endpoint, swappable via env with **zero code change**
- Currently pointed at **Groq** (`llama-3.3-70b-versatile`, free tier); works equally with OpenAI, Gemini (OpenAI-compat endpoint), Ollama, etc.
- **Graceful fallback:** if no LLM is configured or the call errors, reports fall back to a deterministic Markdown **template** (never crashes)

### Git integration
- **Provider-agnostic** `GitProvider` abstraction (GitHub implemented; GitLab/Bitbucket enum-ready)
- **GitHub REST API** via `fetch` (paginated, hard caps, rate-limit tolerant)
- **GitHub Webhooks** for real-time commit ingestion (HMAC `X-Hub-Signature-256` verification)

### External AI-agent runtime (chat path)
- **OpenClaw** (openclaw.ai) — external self-hosted AI-agent runtime, run separately in **Docker** (gateway on :18789), OpenAI-compatible SSE
- A standalone **MCP server** (`integrations/devinsight-mcp-server`, Streamable HTTP on :4100) exposing DevInsight tools to the OpenClaw agent
- Chat model used in the deployed setup: **Z.ai GLM** on the OpenClaw runtime

### Notification / delivery channels
- **Telegram Bot API** (via `fetch`) — provider-abstracted (`ChannelProvider`), Discord/Slack are drop-in later

---

### Code quality (static analysis)
- **SonarQube Community Edition**, self-hosted via Docker (`docker-compose.sonar.yml`), read through its **Web API** behind a `CodeQualityProvider` abstraction (SonarCloud is a config-only swap — same interface, same API).
- Coverage fed from **Vitest v8 → lcov**; scans run via `scripts/sonar-scan.sh` (Dockerized `sonar-scanner-cli`) or automatically on push (a background `pre-push` git hook).

## 3. Features implemented

### Authentication & organizations
- Email/password **register / login**, JWT sessions (7-day), `GET /auth/me`
- **Multi-tenant organizations** with membership + **RBAC roles** (`OWNER`, `MANAGER`, `ADMIN`, `EMPLOYEE`)
- Manager roles can manage; `EMPLOYEE` is read-only. Org-scoped permission checks on every write
- **Audit log** row recorded for every write operation

### Projects & employees
- **Projects** CRUD + project members (with project roles), assign a team when creating a project
- **Employees** CRUD; per-employee git-identity management
- **Bulk CSV employee import** (paste/upload `name,email,role,github-handles`, per-row created/skipped/failed reporting, ≤500 rows)

### Git credentials (PAT security)
- Connect a GitHub **Personal Access Token** → validate → **AES-256-GCM encrypt at rest** → store (never returned to frontend, never logged, never cached decrypted)
- Reconnect / disconnect / re-validate a credential
- **GitHub username resolver** — live `GET /users/{login}` preview card (avatar, real name, company, User-vs-Organization warning) to prevent typo'd handles
- **Repository access control** — choose which affiliations to browse (own / shared-with-you / organization repos)

### Repository sync
- List repos from GitHub, **select/track**, assign to a project, resync metadata, untrack
- Auto-registers a **GitHub webhook** on track (zero user setup) for live sync

### Contributor discovery & auto-mapping
- Discover **contributors and collaborators** per repo → map to employees
- **Declared git aliases** (`EmployeeGitAlias`) — an employee declares their GitHub handle once and it **auto-links across every repo** (past and future)
- **Auto-link on connect** — contributors are discovered + auto-linked the moment a repo is tracked
- **Suggested matches** (confirm-before-map) — email-signal (strong) + name/username similarity (medium), one-click Confirm
- **Bot auto-ignore** (`[bot]` logins + known bot list) so bots never clutter mapping or reports
- **Create-employee-from-author** — turn an unmapped commit author into an employee inline (auto-mapped)
- **Unmapped-contributor nudge** on the Overview dashboard

### Git activity collection (the ingestion engine)
- **Branch-aware** commit + changed-file collection: commits stored once (`@@unique[repositoryId, sha]`), linked to every containing branch via `CommitBranch` — multi-branch work isn't double-counted; unmerged work is included
- **Coverage ledger** (`RepositoryCoverage` + interval math) — fetches only missing sub-ranges from Git, per branch; incremental and cheap
- Hard caps throughout (max branches, max detail commits, page caps)
- **Live sync via GitHub webhooks** — push → signed webhook → immediate ingest of the fresh tail (debounced, idempotent via sha-dedup)
- **Deep-history collection** job (with a "re-verify" mode) + a **data-integrity fix** for the "commit-first, push-later" hole (force-relist + trailing-overlap self-heal + ingest-by-exact-SHA)

### Smart report engine
- **Commit classifier** (deterministic) — conventional-commit prefix + rich imperative-verb/keyword fallback → Feature / Fix / Refactor / Docs / Test / Chore / Perf / Build / Other (39/40 real-world message styles correctly classified)
- **Analysis** — category tally, top modules by change, **risk signals** (risky keywords, unusually large commits, sensitive-path hits), off-hours/weekend commits, dependency-noise share
- **Noise filtering** — lockfiles, generated dirs, minified artifacts excluded from line counts so a dependency bump can't inflate anyone
- **Employee leaderboard** with **noise-free ("real work") ranking**
- **Report cache** — data fingerprint + scope + day-bucketed period reuses a prior LLM report and skips the LLM (custom prompts always regenerate; branch-aware & baseline-aware fingerprint)
- **Orchestration** (`orchestrateReport`) is the single chokepoint every channel reuses: resolve target/period → auto-collect (ledger) → analyze → LLM (or template fallback) → persist in a transaction with an audit row

### AI reports
- Report scopes: **repository / project / employee / team** (team with no employees = **entire organization**)
- Periods: today / last 7 days / last 30 days / **custom range** (inclusive local-day boundaries)
- **Branch-scoped reports** (read across all branches or filtered to one)
- **Plain-language executive layer** — reports target non-technical managers/PMs/CEOs:
  - Deterministic `## Summary` (activity level normalized per period length, humanized work mix, business area names, most-active person)
  - **"## What shipped"** — LLM clusters related commits into named initiatives (verified: 18 messages → 5 clean initiatives)
  - **Structured theme panel** (dedicated cached clustering call, persisted, rendered as a UI panel)
  - **"## Key insights"** — deterministic rules (volume swings, bus-factor concentration, new/departed contributors, work-type skew, off-hours/burnout, dependency churn)
  - **Period-over-period trend comparison** (vs the equal-length prior window, from stored data; headline deltas + per-contributor rank movement), suppressed cleanly when there's no baseline
  - **"Good to know" caveats** footer (no baseline / unmapped contributors / skipped repos)
  - **Simple / Detailed reading-mode toggle**
- **Report persistence & history** with detail view, structured trend/insights/themes panels
- **Export** — Copy, Download `.md`, Print/PDF
- **Public share links** — mint a `randomBytes(24)` token → unauthenticated `/share/[token]` page (only presentational fields exposed)

### Statistics dashboard
- **Overview** page = org-wide stats from stored commits only (never hits Git): headline totals (commits, +/- lines, files, active repos, contributors), **gap-filled daily commit series**, top contributors, per-repo & per-project breakdowns, work-breakdown + risks
- Period selector; hand-rolled SVG charts (StatTile, BarList, AreaChart with hover tooltip)
- **One-click "Today's report"** button (org-wide daily digest, no form)
- **Daily digest card** — "yesterday in review" with top movers (rank-delta ▲▼ + active-day 🔥 streaks) + risk signals
- **Leaderboard-history trend chart** (daily/weekly/monthly snapshots)
- **Unmapped-contributor nudge**

### Management analysis (per-employee fairness tooling)
- **Project Analysis page** (manager-only) — per-employee activity cards: commits, noise-filtered lines, active days, module breadth, category mix, risk signals, sample messages, per-employee **commit-detail table** with clickable commits
- **Employee comparison view** — pick 2 employees (same project/period, fairness guaranteed) → side-by-side neutral metric bars, shared-area highlight (no good/bad coloring)
- **Branch-filtered analysis**
- **Inline AI report** from the analysis page (reuses `orchestrateReport`)
- **Leaderboard snapshots** — idempotent historical snapshots (daily/weekly/monthly, bounded backfill) written by the scheduler
- **Employee-of-the-month awards** — deterministic balanced score (commits/lines/active-days/files, min-max normalized, mapped-only) + LLM citations (template fallback), manager shortlist → confirm single winner
- **Per-employee Appraisal / Increment view** — the core purpose made concrete: evidence-backed, **not a score or verdict**. Headline real-work totals, consistency (active weeks + monthly chart), focus, ownership (module breadth + security-critical paths), kind-of-work, dual team rankings (real work + updates), **clickable commit evidence**, honest **"what data can't see"** blind-spots, Print/PDF, fairness banner. Unlinked identity → honest empty appraisal (the gap is the finding)
- **Project details hub** (`/dashboard/projects/[id]`) — repositories + team + embedded analysis locked to one project

### Code quality analysis (SonarQube)
- **Code Quality dashboard page** (manager-only) — for a SonarQube project: Reliability / Security / Maintainability ratings (A–E), and headline measures (bugs, vulnerabilities, code smells, coverage %, duplication %, security hotspots, tech-debt, lines of code)
- **Per-developer breakdown** — open issues grouped by git author (blame-based), each **joined to the mapped employee** via the existing git-alias/mapping tables — bug/vuln/smell counts + severity chips. This is the objective, per-developer quality signal that complements the activity data (fair *evidence*, not a verdict)
- **`CodeQualityProvider` abstraction** — reads the SonarQube Web API; **SonarCloud is a config-only swap** (set the organization + base URL). Degrades gracefully (shows "not connected") when no token is set
- **Self-serve setup** — connect SonarQube from the UI (base URL + token, encrypted at rest per-org, "Test connection"), no `.env` editing; map a repo to its SonarQube project via a **dropdown** (with a bulk "Auto-map by name"); env stays a fallback
- **Quality gate** — the single pass/fail badge (plus failed conditions) is surfaced from SonarQube's quality gate
- **In context, not siloed** — an org-wide "Code health" card on the Overview and a project-scoped one on each project page (bugs/vulns/coverage + worst gate)
- **Trends over time** — daily snapshots feed a coverage/bugs/code-smells trend chart, and generated reports carry a window-accurate "Code health" section (current values with "(was N)" deltas vs the period start)
- **Woven into the Appraisal** — the per-employee Appraisal view now shows a "Code quality" card: SonarQube issues (bugs/vulns/smells + severity) attributed to that person by git-blame email, joined via their git identities. Best-effort (never fails the appraisal) and shown with explicit fairness caveats. A repo is mapped to its SonarQube project via a per-repo `sonarProjectKey`
- **Auto-scan on push** — a background `pre-push` git hook runs a scan without blocking the push; results appear in SonarQube and (once the API has the token) on the Code Quality page
- *Community-Edition limits (deliberate):* main-branch-only analysis (no pre-merge PR gate — that needs SonarCloud/Developer Edition); attribution is blame-based, so it's evidence, not exact fault

### Scheduled reports
- **`ReportSchedule`** with cadence (DAILY / WEEKLY / MONTHLY), **time-of-day + timezone (DST-correct)**
- In-process scheduler (`setInterval`, 60s tick); each due schedule **claimed atomically** (conditional `updateMany`) so multiple instances can't double-run
- Runs through `orchestrateReport` (auto-collect + cache + template fallback all apply); records last-run status/error; advances next-run even on failure (transient retry once, then normal cadence)
- Manage from a **Schedules** page (create / run-now / pause-resume / delete, next/last-run status, deep-link to the last report)

### Telegram report delivery (channel delivery)
- **Admin-panel managed** — nothing in `.env`. Bot token **AES-256-GCM encrypted** at rest, never returned/logged
- **Channels** page (manager-only): add a bot token → **Detect chats** (getUpdates) → pick a chat → save; test / enable-disable / delete; last-delivery status
- Reports sent as **clean inline plain text** (Markdown → plain, tables flattened), auto-split to Telegram's 4096-char limit
- Wire a channel into a schedule ("Deliver to") or send a saved report on demand ("Send to Telegram"). Delivery is **resilient** — a delivery failure never fails the report run
- Provider-abstracted (`ChannelProvider`) — Discord/Slack are drop-in later

### AI chat assistant
- **Floating chat widget** on every dashboard page
- Routes through the **real external OpenClaw runtime** → agent → **MCP server** → DevInsight tool endpoints → `orchestrateReport` → back to chat
- **Token-by-token streaming** (NDJSON to the browser), "Thinking…" during the tool-call phase
- **Conversation memory** (recent-turn window), **Stop/abort** (cancels upstream token spend), **Retry** on error, pinned-to-bottom auto-scroll
- Natural requests work ("give me this month's report for the backend repo") — the agent picks the tools itself
- Degrades gracefully to a "not connected" state when the gateway isn't configured

---

## 4. Architecture highlights & key decisions

- **Modular-by-feature backend** (`modules/<feature>/`): thin controllers (`asyncHandler` + Zod `.parse()`), services (business logic + Prisma, throw typed `AppError`), a single error-handler middleware (`ZodError → 400`, `AppError → status/code`, else 500)
- **Mandatory provider abstractions** — GitHub behind `GitProvider`, LLM behind `LLMProvider`, channels behind `ChannelProvider`. Never call an external service directly from a controller/service
- **Reports never fail on LLM problems** — deterministic template fallback (`status: PARTIAL`, `generatedBy: "template"`)
- **Smart-engine logic lives in the backend**, not in OpenClaw/MCP — every channel (dashboard, chat, schedules, Telegram) reuses `orchestrateReport`
- **Two auth paths** — JWT (browser) + timing-safe service-key (`x-openclaw-key`) for the MCP tool endpoints
- **Security** — PATs, webhook secrets, and Telegram tokens are all AES-256-GCM encrypted at rest; env validated at boot (`GIT_TOKEN_ENCRYPTION_KEY` must be a base64 32-byte key)
- **Single-instance scheduler by design** (a multi-instance deploy would need a shared queue)

### Data model (Prisma, PostgreSQL)
`User`, `Organization`, `OrganizationMember`, `AuditLog`, `RequestLog` · `Project`, `ProjectMember` · `GitCredential` · `Repository` (+ webhook fields) · `ContributorIdentity`, `EmployeeGitMapping`, `EmployeeGitAlias` · `Commit`, `ChangedFile`, `Branch`, `CommitBranch`, `RepositoryCoverage` · `Report` (+ `shareToken`, `dataFingerprint`, `statisticsJson`), `ReportContributor` · `ReportSchedule` · `LeaderboardSnapshot`, `LeaderboardSnapshotRow`, `EmployeeAward` · `NotificationChannel` · `CollectionJob`

---

## 5. What is NOT yet built

- **Automated tests** — no runner installed yet (verification is done by driving the running API against mock GitHub/LLM servers). Prime candidates when added: `token-cipher`, coverage interval math, commit-classifier, `computeNextRun`, the report flow with mocked providers
- **Deployment** — Dockerfiles + compose + production env guide
- **Discord/Slack** delivery (Telegram is done; the provider abstraction makes them drop-in)
- **Conversational Telegram** (Telegram → OpenClaw → reports, mostly OpenClaw config)
- Employee self-login/invite flow
- **Multi-tenant code quality** — SonarQube works locally today; scanning **customers'** repos automatically (provision a project + token per repo, inject the workflow + `SONAR_TOKEN` secret into the client repo via the existing GitHub App / CI pipeline, read results back) is the next step. SonarCloud migration would then be config-only.

---

*Generated from `docs/PROJECT_STATE.md` (the authoritative state document) and the workspace `package.json` files.*
