# DevInsight AI — Current Project Analysis & API Documentation

> **Purpose:** Code-grounded handoff/context file. Give this to another AI assistant before asking it to analyze, modify, debug, or extend DevInsight.
>
> **Audit date:** 2026-07-18
> **Repository:** `/Users/dpmac/Desktop/projects/hobby-project/DevInsight`
> **Source of truth:** current source code, `CLAUDE.md`, and `docs/PROJECT_STATE.md`. Older blueprints are intent/history and may describe retired behavior.

## 1. Executive summary

DevInsight AI is a multi-tenant developer-intelligence SaaS for managers. It connects customer GitHub accounts or organizations through one shared GitHub App, imports repository activity, maps GitHub identities to employees, and produces activity reports and management signals.

Current value chain:

```text
GitHub App installation/repository selection
  -> automatic 90-day backfill + signed push webhook ingestion
  -> branch-aware commit/file storage
  -> contributor discovery and employee mapping
  -> deterministic activity analysis/statistics
  -> report orchestration with optional OpenAI-compatible LLM
  -> Markdown persistence, sharing, schedules, Telegram delivery
```

Implemented product areas:

- JWT authentication, organizations, membership, and RBAC.
- GitHub App lifecycle, repository reconciliation, live push sync, and short-lived installation tokens.
- Projects, project members, employees, GitHub aliases, bulk employee import.
- Deep historical collection jobs with progress and cancellation.
- Contributor auto-linking, suggestions, mapping/unmapping, and bot ignoring.
- AI reports with template fallback, caching, comparisons, insights, themes, and code-health appendix.
- Statistics dashboard, leaderboard history, daily digest, appraisal, and employee-of-the-month awards.
- Pull-request/review collaboration metrics.
- SonarQube/SonarCloud-compatible code quality.
- GitHub Actions CI workflow inspection, enable/disable, merge, and run history.
- Telegram channels and scheduled report delivery.
- Website chat proxy through OpenClaw and a private MCP bridge.

## 2. Current-state corrections

| Topic | Current behavior | Avoid this outdated assumption |
|---|---|---|
| Git access | GitHub App-only; installation tokens are minted on demand and never stored. | Customer PAT/credential CRUD and `/api/git-credentials` are retired. |
| Repository selection | GitHub App selection is the source of truth; App link/sync/webhooks reconcile repositories. | There is no current local select/untrack/live-toggle flow. |
| Push sync | One signed endpoint: `POST /api/webhooks/github-app`. | No per-repository webhook secret/endpoints. |
| OpenClaw reports | Dashboard structured reports call in-repo `orchestrateReport` directly; website chat uses external OpenClaw -> MCP -> service-key tools. | Do not say every dashboard report traverses external OpenClaw. |
| LLM | Any OpenAI-compatible endpoint through `LLMProvider`; missing/error falls back to deterministic Markdown. | Do not hard-code one vendor. |
| Frontend state | Axios helpers plus local React state/effects. | TanStack Query, Zustand, and TanStack Table are not the active architecture. |
| Cache/queue | DB-backed report cache, schedules, and collection jobs with in-process workers. | Redis is not used by the current runtime. |
| Database | PostgreSQL/Neon, Prisma 7, `@prisma/adapter-pg`. | Do not add a datasource URL to `schema.prisma`. |

## 3. Repository/runtime structure

```text
apps/api/                         Express 5 + TypeScript + Prisma backend
  src/main.ts                     HTTP server + scheduler + collection worker
  src/app.ts                      Express middleware and route mounts
  src/modules/                    Feature modules: controller/service/schema
  src/common/                     Auth access, errors, logging, crypto, helpers
  prisma/schema.prisma            PostgreSQL model
  tests/                          Vitest unit/migration tests
apps/web/                         Next.js 16 + React 19 dashboard
  src/app/                        App Router pages
  src/components/                 Feature managers/UI
  src/lib/api.ts                  Axios client and DTO types
packages/shared/                  Minimal shared package
integrations/devinsight-mcp-server/ Standalone Streamable HTTP MCP server :4100
docs/                             State, deployment, architecture, blueprints
```

Runtime defaults: API `:4000`, web `:3000`, MCP `:4100`, local SonarQube `:9000`, Node `>=20`.

Useful commands:

```bash
npm run dev
npm run dev:api
npm run dev:web
npm run dev:mcp
npm run build
npm run lint
npm run typecheck
npm test
cd apps/api && npx prisma generate
```

## 4. Architecture conventions

### Backend

- Express 5, TypeScript 6, ESM/NodeNext. Relative imports require explicit `.js`.
- `app.ts`: helmet, CORS, raw GitHub webhook parser, JSON parser, pino HTTP logging, routes, error handler last.
- Controllers are thin: parse Zod input, call a service, return JSON.
- Services contain authorization, business logic, Prisma access, provider calls, and audit logging.
- Expected errors use `AppError(statusCode, message, code)`; unknown errors become generic 500.
- External vendors sit behind interfaces and registries.

Provider abstractions: `GitProvider` (GitHub REST), `LLMProvider` (OpenAI-compatible), `CodeQualityProvider` (SonarQube), `DevOpsProvider` (GitHub mutation/Actions), and `ChannelProvider` (Telegram).

### Frontend

- Next.js 16 App Router, React 19, TypeScript, Tailwind 4.
- Pages are thin wrappers around feature managers in `apps/web/src/components`.
- Axios in `apps/web/src/lib/api.ts` attaches JWT from localStorage key `devinsight.accessToken`.
- No Next middleware; `useSession` performs client-side guard/organization selection.
- Data fetching uses local `useState`/`useEffect`; no active query cache/global store.
- Reports render with `react-markdown` + `remark-gfm`.

## 5. Frontend feature inventory

| Route | Implemented feature |
|---|---|
| `/` | Landing page and product overview. |
| `/login` | Login/register. |
| `/share/[token]` | Public report page without JWT/dashboard chrome. |
| `/dashboard` | Statistics, charts, digest, code-health, leaderboard history, unmapped nudge. |
| `/dashboard/git` | GitHub App connection; no PAT flow. |
| `/dashboard/git/callback` | GitHub App post-install callback. |
| `/dashboard/projects` | Project CRUD and members. |
| `/dashboard/projects/[id]` | Project detail and analysis. |
| `/dashboard/employees` | Employee CRUD, role/status, GitHub lookup, aliases, bulk import. |
| `/dashboard/repositories` | Repositories, collection, Sonar mapping/provisioning, PR collection, CI controls. |
| `/dashboard/repositories/[id]` | Repository detail and branches/activity/contributors. |
| `/dashboard/contributors` | Discovery, suggestions, mapping, ignore, employee shortcut. |
| `/dashboard/reports` | Generate/history/detail, Markdown, insights, comparison, themes, share, delete, Telegram. |
| `/dashboard/schedules` | Scheduled reports, cadence/timezone, run-now, Telegram delivery. |
| `/dashboard/analysis` | Manager-only project per-employee activity signals and AI report. |
| `/dashboard/appraisal` | Manager-only evidence-backed appraisal. |
| `/dashboard/channels` | Manager-only Telegram channel management. |
| `/dashboard/code-quality` | Manager-only SonarQube connection, measures, trend, developer issues. |

Analysis, Appraisal, Channels, and Code Quality navigation is manager-only, but backend checks remain authoritative.

## 6. Authentication, authorization, and security

### JWT

- Register/login returns a 7-day JWT.
- Protected routes require `Authorization: Bearer <token>`.
- `requireAuth` sets `req.authUser = { id, email, memberships }`.
- Service-level access checks use `requireOrganizationMember` and `requireOrganizationRole`.
- Roles: `OWNER`, `MANAGER`, `EMPLOYEE`, `ADMIN`; manager roles are OWNER/MANAGER/ADMIN.
- Writes normally create an `AuditLog` in the same transaction.

### GitHub App

- App private key is server-side environment configuration.
- Installation tokens are short-lived, minted on demand, never persisted.
- Every repository operation requires matching tenant installation and active `RepositoryAccess`.
- Webhook HMAC uses `X-Hub-Signature-256`; raw body parsing must remain before global `express.json()`.
- Verified push deliveries return quickly with 202 and process asynchronously through per-repository FIFO.

### OpenClaw/MCP

- Tool routes require `x-openclaw-key` and API-signed short-lived `x-openclaw-context`.
- Context claims contain `organizationId` and `requesterId`; do not trust model-supplied tenant IDs.
- MCP additionally requires `Authorization: Bearer <MCP_ACCESS_TOKEN>`.
- Gateway tokens stay server-side.

### Secret handling

- `GIT_TOKEN_ENCRYPTION_KEY` is AES-256-GCM for SonarQube/Telegram secrets.
- Stored format is encrypted; only `tokenLast4` is exposed.
- Never log, return, cache, or send decrypted tokens to the browser.

## 7. Core report/data pipeline

`apps/api/src/modules/openclaw/openclaw.service.ts` contains the central `orchestrateReport()` flow:

```text
validate request
  -> resolve tenant target and period
  -> resolve repository/project/employees/usernames
  -> ensure missing activity via coverage ledger
  -> aggregate branch-aware commits
  -> classify work/modules/risks and build leaderboard
  -> build previous-period comparison and insights
  -> cache lookup unless customPrompt exists
  -> sample commits for narrative
  -> LLM Markdown or deterministic template fallback
  -> optional LLM themes
  -> append deterministic caveats and Sonar code health
  -> persist Report + contributors + AuditLog
```

Target rules:

- repository report requires `repositoryId`.
- project report requires `projectId`.
- employee report requires non-empty `employeeIds`.
- team report may omit employees for direct report generation (whole organization); the recurring schedule schema currently requires `employeeIds` for team too.
- `period=custom` requires `customRange:{from,to}`.
- date-only custom values are inclusive local calendar boundaries.
- optional `branch` filters reachable commits through `CommitBranch`.

Collection is branch-aware: one `Commit` per repository/SHA, many branch links. The coverage ledger stores merged ranges per branch. Reports fetch missing subranges only, while near-now data gets a recent re-list. Deep collection supports 30–3650 days with DB-backed progress/cancellation. Provider/page/branch/detail caps prevent unbounded requests.

Fallback/cache rules:

- No LLM or LLM failure still returns a report: `status=PARTIAL`, deterministic template, `generatedBy=template`.
- Successful LLM reports can be reused by target/period/branch/data fingerprint.
- `customPrompt` always bypasses cache.
- Caveats and code-health Markdown are deterministic and persisted for every channel.

## 8. Database model overview

| Model | Purpose |
|---|---|
| `User`, `Organization`, `OrganizationMember` | Account, tenant, membership/RBAC. |
| `Project`, `ProjectMember` | Project grouping and project roles. |
| `GitHubAppInstallation`, `RepositoryAccess` | App installation and current repository grants. |
| `Repository` | Tracked App-owned repository and sync/quality metadata. |
| `Branch`, `CommitBranch` | Branch inventory and reachability. |
| `Commit`, `ChangedFile` | Deduplicated commits and file stats. |
| `RepositoryCoverage`, `CollectionJob` | Coverage ledger and deep collection worker state. |
| `ContributorIdentity`, `EmployeeGitAlias`, `EmployeeGitMapping` | Git identities, aliases, mapping. |
| `Report`, `ReportContributor` | Persisted reports and contributors. |
| `ReportSchedule` | Recurring report execution state. |
| `LeaderboardSnapshot`, `EmployeeAward` | History and award shortlist/confirmation. |
| `NotificationChannel` | Encrypted Telegram destination. |
| `PullRequest`, `PullRequestReview` | Collaboration metrics. |
| `CodeQualityConnection`, `CodeQualitySnapshot` | Sonar connection and daily trends. |
| `CiConfiguration`, `WorkflowRun` | Managed Actions workflow and run mirror. |
| `AuditLog`, `RequestLog` | Audit/observability. |

Key constraints: user email, org slug, org membership, repository external ID per tenant/provider, commit repository/SHA, branch repository/name, contributor repository/external ID, alias org/provider/username, report share token, and one code-quality connection per organization are unique.

## 9. API conventions/errors

Base API is normally `http://localhost:4000`; paths below include `/api` where applicable. Standard JSON headers:

```http
Content-Type: application/json
Authorization: Bearer <JWT>
```

Validation error:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid request payload", "details": { "fieldErrors": {}, "formErrors": [] } } }
```

Expected service error:

```json
{ "error": { "code": "SOME_ERROR_CODE", "message": "Human-readable explanation" } }
```

Unknown error:

```json
{ "error": { "code": "INTERNAL_SERVER_ERROR", "message": "Something went wrong" } }
```

Unless marked public/service-key, endpoints below require JWT. Timestamps serialize as ISO strings.

## 10. Exhaustive backend API catalog

The route list below is extracted from the current controller files and Zod schemas. The current application exposes 97 HTTP routes including health, webhook, public, JWT, and service-key routes. Response names refer to the DTO definitions in this document.

### 10.1 Health, auth, organizations

| Method/path | Auth | Request | Success response |
|---|---|---|---|
| GET /health | Public | none | 200 { status:"ok", service:"devinsight-api" } |
| POST /api/auth/register | Public | JSON { name (2–80), email, password (8–128), organizationName (2–100) } | 201 { accessToken, user:SafeUser, organization:OrganizationSummary } |
| POST /api/auth/login | Public | JSON { email, password } | 200 { accessToken, user:SafeUser, memberships:[{ organizationId, role }] } |
| GET /api/auth/me | JWT | none | 200 { user:SafeUser, organizations:[{ id,name,slug,role }] } |
| GET /api/organizations | JWT | none | 200 { organizations:[{ id,name,slug,role,createdAt }] } |

SafeUser = { id,name,email,status,createdAt }. Password hashes are never returned.

### 10.2 Projects

| Method/path | Auth/role | Request | Success response |
|---|---|---|---|
| GET /api/projects | JWT member | Query { organizationId, status?: ACTIVE or ARCHIVED } | 200 { projects:ProjectSummary[] } |
| POST /api/projects | JWT manager | JSON { organizationId, name (2–100), description?, members?: [{ userId, role?: LEAD or DEVELOPER or REVIEWER }] } | 201 { project:ProjectSummary } |
| GET /api/projects/:id | JWT member | path id | 200 { project:ProjectDetail } |
| PATCH /api/projects/:id | JWT manager | JSON with at least one of { name?, description?:string|null, status? } | 200 { project:ProjectSummary } |
| DELETE /api/projects/:id | JWT manager | path id | 200 { id } |
| POST /api/projects/:id/members | JWT manager | JSON { userId, role?: LEAD or DEVELOPER or REVIEWER } | 201 { member:ProjectMember } |
| DELETE /api/projects/:id/members/:userId | JWT manager | path id,userId | 200 { projectId,userId } |

ProjectSummary = { id,organizationId,name,description,status,memberCount,createdAt,updatedAt }.

ProjectDetail = ProjectSummary plus members:[{ id:userId,name,email,role,addedAt }].

### 10.3 Employees and Git aliases

| Method/path | Auth/role | Request | Success response |
|---|---|---|---|
| GET /api/employees | JWT member | Query { organizationId } | 200 { employees:Employee[] } |
| POST /api/employees | JWT manager | JSON { organizationId,name,email,role?:EMPLOYEE or MANAGER or ADMIN,gitUsernames?:string[] max 20 } | 201 { employee:Employee } |
| POST /api/employees/bulk | JWT manager | JSON { organizationId, employees:[{ name,email,role?,gitUsernames? }] }, 1–500 rows | 200 { result:{ created,total,results:[{ email,status:created or skipped or failed,message? }] } } |
| GET /api/employees/:userId | JWT member | path userId; query { organizationId } | 200 { employee:EmployeeDetail } |
| PATCH /api/employees/:userId | JWT manager | JSON { organizationId,name?,role?,status?:ACTIVE or DISABLED }, at least one update field | 200 { employee:Employee } |
| POST /api/employees/:userId/git-aliases | JWT manager | JSON { organizationId,username,isPrimary? } | 201 { employee:EmployeeDetail } |
| DELETE /api/employees/:userId/git-aliases/:aliasId | JWT manager | path userId,aliasId; query { organizationId } | 200 { employee:EmployeeDetail } |

Employee = { id,name,email,role,status,joinedAt,gitAliases:[{ id,username,email,name,isPrimary }] }.

EmployeeDetail adds projects:[{ id,name,status,role }]. Git usernames are normalized by stripping leading @, trimming, and lowercasing.

### 10.4 GitHub App and webhook

| Method/path | Auth/role | Request/headers | Success response |
|---|---|---|---|
| GET /api/github-app/status | JWT member | Query { organizationId } | 200 { configured,connected,installations:GitHubAppInstallation[] } |
| GET /api/github-app/install-url | JWT manager | Query { organizationId } | 200 { url } |
| GET /api/github-app/resolve-user | JWT manager | Query { organizationId,username }; leading @ removed | 200 { user:GitUserProfile or null } |
| POST /api/github-app/installations/callback | JWT manager | JSON { organizationId,installationId:string or number,setupAction? } | 200 { configured,connected,installations } |
| POST /api/github-app/installations/:id/sync | JWT manager | path local installation row id; JSON { organizationId } | 200 { configured,connected,installations } |
| DELETE /api/github-app/installations/:id | JWT manager | path local installation row id; query { organizationId } | 200 { configured,connected,installations } |
| POST /api/webhooks/github-app | GitHub HMAC, no JWT | raw JSON; X-Hub-Signature-256 and X-GitHub-Event | ping -> 200 {ok:true}; verified event -> 202 {accepted:true} |

GitHubAppInstallation = { id,installationId,accountLogin,accountType,targetType,repositorySelection,repositoryCount,suspended,lastSyncedAt,createdAt }.

Webhook events are ping, installation, installation_repositories, and push. Invalid/missing HMAC returns 401 UNAUTHORIZED. Unconfigured App returns 503 GITHUB_APP_NOT_CONFIGURED. Invalid JSON returns 400 BAD_PAYLOAD.

Webhook body contracts used by the code are intentionally partial GitHub payloads:

- installation/installation_repositories: { action?, installation:{ id?, suspended_at? } }. The service re-syncs the installation and reads the current repository selection from GitHub.
- push: { installation:{ id? }, repository:{ id?,full_name? }, ref?, commits:[{ id?,message?,timestamp?,author:{ name?,email?,username? } }], head_commit:{ timestamp? } }. A valid branch ref is refs/heads/<branch>; exact commit SHAs are ingested and deduplicated.

### 10.5 Repositories

| Method/path | Auth/role | Request | Success response |
|---|---|---|---|
| GET /api/repositories | JWT member | Query { organizationId } | 200 { repositories:TrackedRepository[] } |
| PATCH /api/repositories/:id | JWT manager | JSON { projectId:string|null } | 200 { repository:TrackedRepository } |
| PATCH /api/repositories/:id/sonar-project | JWT manager | JSON { sonarProjectKey:string|null } | 200 { repository:TrackedRepository } |
| POST /api/repositories/:id/resync | JWT manager | path id; empty body | 200 { repository:TrackedRepository } |

TrackedRepository = { id,provider:GITHUB,externalId,owner,name,fullName,remoteUrl,isPrivate,defaultBranch,sonarProjectKey,codeQualityScan:{provisioned,provisionedAt},project:{id,name}|null,commitCount,lastSyncedAt,liveSync:{status:ACTIVE or ERROR or null,lastWebhookAt},createdAt,updatedAt }.

There is intentionally no repository create/select/delete route. App reconciliation creates and removes repositories.

### 10.6 GitHub Actions CI/DevOps

| Method/path | Auth/role | Request | Success response |
|---|---|---|---|
| GET /api/ci/status | JWT member | Query { repositoryId } | 200 CiStatus |
| GET /api/ci/inspect | JWT member | Query { repositoryId } | 200 CiInspection |
| GET /api/ci/runs | JWT member | Query { repositoryId } | 200 { runs:CiWorkflowRun[] } |
| POST /api/ci/enable | JWT manager | JSON { repositoryId } | 200 CiStatus |
| POST /api/ci/disable | JWT manager | JSON { repositoryId } | 200 CiStatus |
| POST /api/ci/sync | JWT manager | JSON { repositoryId } | 200 CiStatus |
| POST /api/ci/merge | JWT manager | JSON { repositoryId } | 200 CiStatus |

CiStatus includes repositoryId, fullName, defaultBranch, status (NOT_CONFIGURED, PENDING, ENABLED, DISABLED), enabled, templateId/version, workflowPath/URL, actionsUrl, pullRequest { number,url,state } or null, lastSyncedAt, and latestRun.

CiInspection includes supported, runtime, defaultBranch, packageManager, isMonorepo, framework, nodeVersion, scripts { lint,typecheck,test,build,prismaGenerate,testCoverage }, and reason.

CiWorkflowRun includes runId, name, branch, headSha, event, status, conclusion, actor, url, startedAt, completedAt, and durationMs.

### 10.7 Activity and branches

| Method/path | Auth/role | Request | Success response |
|---|---|---|---|
| GET /api/repositories/collection-jobs | JWT member | Query { organizationId } | 200 { jobs:CollectionJob[] } |
| POST /api/repositories/:id/deep-collect | JWT manager/service rules | JSON { lookbackDays?:30..3650,verify?:boolean } | 202 { job:CollectionJob } |
| POST /api/repositories/:id/deep-collect/cancel | JWT manager/service rules | empty body | 200 { job:CollectionJob } |
| POST /api/repositories/:id/activity | JWT manager | JSON { since?:ISO date,until?:ISO date }; UI sends {} | 200 { activity:CollectActivityResult } |
| GET /api/repositories/:id/activity | JWT member | Query { since?:ISO date,until?:ISO date } | 200 { activity:ActivitySummary } |
| GET /api/repositories/:id/branches | JWT member | path id | 200 { branches:RepositoryBranch[] } |

CollectActivityResult = { range:{since,until},newCollected,branchesChecked,branchesCollected,rangesCollected,capped }.

CollectionJob = { id,repositoryId,status:QUEUED or RUNNING or COMPLETED or FAILED or CANCELLED,rangeStart,rangeEnd,branchesTotal,branchesDone,chunksTotal,chunksDone,commitsCollected,currentBranch,currentPhase,cancelRequested,error,createdAt,startedAt,finishedAt }.

ActivitySummary = { range:{since,until},stats:{commits,additions,deletions,filesChanged},recent:[{sha:first7,message:first-line/max120,author,committedAt,additions,deletions,changedFilesCount}] }.

RepositoryBranch = { id,name,isDefault,isProtected,headSha,commitCount,lastSyncedAt }.

### 10.8 Contributors

| Method/path | Auth/role | Request | Success response |
|---|---|---|---|
| GET /api/contributors | JWT member | Query { repositoryId } | 200 { contributors:Contributor[] } |
| GET /api/contributors/unmapped | JWT member | Query { repositoryId } | 200 { contributors:Contributor[] } |
| GET /api/contributors/unmapped-summary | JWT member | Query { organizationId } | 200 { summary:{ count,sample:[{username,avatarUrl,contributions,repositoryCount}] } } |
| GET /api/contributors/suggestions | JWT manager | Query { repositoryId } | 200 { suggestions:[{ contributorId,suggestions:[{userId,name,confidence,reason,score}] }] } |
| POST /api/contributors/discover | JWT manager | JSON { repositoryId } | 200 { contributors:Contributor[] } |
| POST /api/contributors/:id/map | JWT manager | JSON { userId,isPrimary?:boolean } | 200 { contributor:Contributor } |
| DELETE /api/contributors/:id/map | JWT manager | path id | 200 { contributor:Contributor } |
| POST /api/contributors/:id/ignore | JWT manager | JSON { ignored:boolean } | 200 { contributor:Contributor } |

Contributor = { id,externalId,username,avatarUrl,contributions,ignored,mapping:{userId,name,email,isPrimary}|null }.

Discovery loads commit contributors plus best-effort collaborators. Known bots are initially ignored. Exact alias matches auto-link; lower-confidence suggestion matches require manager confirmation.

### 10.9 OpenClaw and report generation

#### JWT dashboard routes

| Method/path | Auth | Request | Success response |
|---|---|---|---|
| GET /api/openclaw/tools | JWT | none | 200 { tools:[{ name,description,status,pendingPhase? }] } |
| POST /api/openclaw/reports/generate | JWT org member | JSON GenerateReportInput | 200 { report:GeneratedReport } |
| GET /api/openclaw/chat/status | JWT | none | 200 { configured:boolean } |
| POST /api/openclaw/chat/stream | JWT org member | JSON { organizationId,messages:[{ role:user or assistant,content:1..8000 }] }, 1–20 messages | NDJSON stream |

GenerateReportInput:

    {
      organizationId,
      reportType: "repository" | "project" | "employee" | "team",
      repositoryId?, projectId?, employeeIds?,
      period: "today" | "yesterday" | "last_7_days" | "last_30_days" |
              "last_90_days" | "this_month" | "last_month" | "custom",
      customRange?: { from, to },
      customPrompt?: string (max 2000),
      branch?: string
    }

Repository and project targets require the matching ID. Employee targets require non-empty employeeIds. custom period requires customRange.

GeneratedReport runtime response includes:

    {
      reportId, reportType, title, markdown,
      period: { from, to },
      project: { id, name } | null,
      repository: { id, fullName } | null,
      employees: [{ id, name, email, mappedIdentities }],
      statistics: { commits, additions, deletions, filesChanged },
      analysis, leaderboard, comparison, insights, themes, caveats,
      status: "GENERATED" | "PARTIAL",
      pending, warnings, cached, collection
    }

The frontend GeneratedReport type omits some runtime extras, notably analysis, caveats, and collection. Preserve compatible additions if changing the contract.

Chat stream events are one JSON object per line:

    { "type": "delta", "text": "partial text" }
    { "type": "error", "message": "Failed to generate a reply" }

If the gateway is not configured, the route returns 503 OPENCLAW_NOT_CONFIGURED before streaming. Upstream failure after headers are sent becomes a final error event.

#### Service-key tool routes

Required headers:

    x-openclaw-key: OPENCLAW_SERVICE_KEY
    x-openclaw-context: API-signed short-lived tenant context

| Method/path | Request | Success response |
|---|---|---|
| GET /api/openclaw/tools/context | no body; tenant comes from signed context | 200 { context:{ repositories:[{id,fullName,branches:string[]}], projects:[{id,name}], employees:[{id,name}] } } |
| POST /api/openclaw/tools/generate-report | report target/period fields; organizationId is injected/overridden from signed context | 200 { report:GeneratedReport } |

The MCP bridge additionally exposes POST /mcp with its own bearer token, GET /mcp -> 405, and GET /health -> { ok:true }. MCP tools are devinsight_context(contextToken) and devinsight_generate_report(contextToken plus report fields).

### 10.10 Persisted reports and public sharing

| Method/path | Auth/role | Request | Success response |
|---|---|---|---|
| GET /api/reports | JWT member | Query { organizationId,reportType?,limit?:1..100 default 25 } | 200 { reports:ReportSummary[] } |
| GET /api/reports/:id | JWT member | path id | 200 { report:ReportDetail } |
| DELETE /api/reports/:id | JWT manager | path id | 200 { id } |
| POST /api/reports/:id/share | JWT manager | path id | 200 { token } |
| DELETE /api/reports/:id/share | JWT manager | path id | 200 { id } |
| GET /api/public/reports/:token | Public | path token, 1–128 chars | 200 { report:PublicReport } |

ReportSummary = { id,organizationId,reportType,targetLabel,title,status,generatedBy:llm or template or null,period:{from,to},statistics,createdAt }.

ReportDetail adds markdown, repositoryId, projectId, requestedById, shareToken, comparison, insights, themes, and contributors:[{ id,userId,contributorIdentityId,name,commitCount }].

PublicReport intentionally omits tenant/user internals and returns title, markdown, reportType, targetLabel, status, period, statistics, comparison, insights, themes, and createdAt.

### 10.11 Statistics

| Method/path | Auth | Request | Success response |
|---|---|---|---|
| GET /api/statistics/overview | JWT member | Query { organizationId,period?:today|yesterday|last_7_days|last_30_days|last_90_days|this_month|last_month,from?,to? } | 200 { overview:StatisticsOverview } |

StatisticsOverview:

    {
      period: { from, to },
      totals: { commits, additions, deletions, filesChanged, repositories, contributors },
      commitsOverTime: [{ date, commits, additions, deletions }],
      topContributors: EmployeeLeaderboardRow[],
      byRepository: [{ id,name,commits,additions,deletions }],
      byProject: [{ id,name,commits }],
      categories: { category: count },
      topModules: [{ module,changes }],
      risks: string[]
    }

This endpoint reads stored commits only and does not hit GitHub.

### 10.12 SonarQube/code quality

| Method/path | Auth/role | Request | Success response |
|---|---|---|---|
| GET /api/code-quality/overview | JWT member | Query { organizationId,projectKey } | 200 { overview:CodeQualityOverview } |
| GET /api/code-quality/trend | JWT member | Query { organizationId,projectKey,limit?:2..180 default 30 } | 200 { trend:CodeQualityTrendPoint[] } |
| GET /api/code-quality/summary | JWT member | Query { organizationId,projectId? } | 200 { summary:CodeQualitySummary } |
| GET /api/code-quality/connection | JWT member | Query { organizationId } | 200 { connection:ConnectionDTO } |
| POST /api/code-quality/connection/test | JWT manager | JSON { organizationId,provider?:sonarqube or sonarcloud,baseUrl:URL,token,organizationKey? } | 200 { result:{ valid,status:OK or INVALID } } |
| PUT /api/code-quality/connection | JWT manager | same connection JSON | 200 { connection:ConnectionDTO } |
| DELETE /api/code-quality/connection | JWT manager | Query { organizationId } | 200 { connection:{ connected:false,envFallback:boolean } } |
| GET /api/code-quality/projects | JWT member | Query { organizationId } | 200 { available,projects:[{key,name}] } |
| POST /api/code-quality/provision | JWT manager | JSON { repositoryId } | 200 { result:CodeQualityProvisionResult } |
| DELETE /api/code-quality/provision | JWT manager | Query { repositoryId } | 200 { result:{ provisioned:false } } |

ConnectionDTO is either { connected:false,envFallback?:boolean } or { connected:true,provider,baseUrl,organizationKey,status,lastCheckedAt }. The token is never returned.

CodeQualityOverview includes projectKey, available, capabilities:{branchAnalysis,pullRequestAnalysis}, measures (lines, bugs, vulnerabilities, hotspots, smells, coverage, duplication, tech debt, ratings), qualityGate:{status,conditions[]}|null, and per-author developers joined to mapped employees where possible.

CodeQualitySummary is either { available:false, reason:not_configured or no_project_mapped or unreachable } or { available:true,projectCount,totals:{bugs,vulnerabilities,codeSmells,securityHotspots},coverage,worstGate,projects:[...] }.

Provisioning creates/configures a Sonar project/token, injects GitHub Actions secrets, and opens a managed workflow PR through DevOpsProvider; it does not directly push to the default branch.

### 10.13 Pull requests and reviews

| Method/path | Auth | Request | Success response |
|---|---|---|---|
| POST /api/pull-requests/collect | JWT manager | JSON { repositoryId } | 200 { result:{ prCount,reviewCount } } |
| GET /api/pull-requests/review-metrics | JWT member | Query { organizationId,projectId?,from?,to? } | 200 { metrics:ReviewMetrics } |

ReviewMetrics = { period:{from,to}, totals:{prsOpened,prsMerged,reviewsGiven}, developers:[{ login,employee:{userId,name}|null,prsOpened,prsMerged,reviewsGiven,approvals,changesRequested }] }.

### 10.14 Analysis, appraisal, digest, history, awards

| Method/path | Auth/role | Request | Success response |
|---|---|---|---|
| GET /api/analysis/project | JWT manager | Query { organizationId,projectId,period?,from?,to?,branch? } | 200 { analysis:ProjectAnalysis } |
| GET /api/analysis/project/branches | JWT manager | Query { organizationId,projectId } | 200 { branches:[{name,isDefault}] } |
| GET /api/analysis/project/commits | JWT manager | Query { organizationId,projectId,userId,period?,from?,to?,branch? } | 200 { commits:AnalysisCommit[] } |
| GET /api/analysis/appraisal | JWT manager | Query { organizationId,userId,projectId?,months?:1..24 default 6,from?,to? }; custom range requires both | 200 { appraisal:EmployeeAppraisal } |
| GET /api/analysis/leaderboard-history | JWT member | Query { organizationId,scope?:org or projectId,granularity?:DAILY|WEEKLY|MONTHLY,limit?:1..52 } | 200 { snapshots:LeaderboardSnapshot[] } |
| GET /api/analysis/digest | JWT member | Query { organizationId } | 200 { digest:DailyDigest } |
| GET /api/analysis/awards | JWT member | Query { organizationId,scope?,limit?:1..60 } | 200 { awards:EmployeeAward[] } |
| POST /api/analysis/awards/shortlist | JWT manager | JSON { organizationId,scope?:org or projectId,periodKey?:YYYY-MM } | 200 AwardShortlistResult |
| POST /api/analysis/awards/:id/confirm | JWT manager | path id; empty JSON body acceptable | 200 { award:EmployeeAward } |

ProjectAnalysis returns period/project/days/truncation, totals, per-employee signals (commits, raw/effective lines, active days, modules, categories, risk/large commits, sample messages), and unmapped activity.

EmployeeAppraisal includes employee identity, period/scope, headline, consistency, work mix, areas, ownership, quality, team comparison, code quality, collaboration, evidence commits, and data blind spots. It is deterministic evidence/signal data, not a performance verdict.

DailyDigest includes yesterday range, activity headline, previous-day trend, top movers/rank deltas/streaks, risks, and categories. LeaderboardSnapshot includes scope/period metadata, totals, and row-level rank/commits/lines/files.

AwardShortlistResult = { periodKey,scope,projectName,generatedBy:llm or template,awards:EmployeeAward[] }. Numeric scoring/ranking is deterministic; LLM is citation/plain-language enrichment only.

### 10.15 Schedules

| Method/path | Auth/role | Request | Success response |
|---|---|---|---|
| GET /api/schedules | JWT member | Query { organizationId } | 200 { schedules:ReportSchedule[] } |
| POST /api/schedules | JWT manager | JSON { organizationId,name,reportType,repositoryId?,projectId?,employeeIds?,period?,cadence:DAILY|WEEKLY|MONTHLY,runHour?:0..23,runMinute?:0..59,timeZone?,customPrompt?,channelId?:string|null } | 201 { schedule:ReportSchedule } |
| PATCH /api/schedules/:id | JWT manager | subset { name?,period?,cadence?,runHour?,runMinute?,timeZone?,customPrompt?:string|null,channelId?:string|null,enabled?:boolean } | 200 { schedule:ReportSchedule } |
| DELETE /api/schedules/:id | JWT manager | path id | 200 { id } |
| POST /api/schedules/:id/run | JWT manager | path id; empty body | 200 { reportId,status:ok,delivery? } |

ReportSchedule = { id,name,reportType,repositoryId,projectId,employeeIds,period,cadence,runHour,runMinute,timeZone,customPrompt,channelId,enabled,nextRunAt,lastRunAt,lastReportId,lastStatus,lastError,createdAt }.

The scheduler is an in-process 60-second interval. Due rows are claimed atomically. Timezone/DST/month-end behavior is handled by computeNextRun. Multi-instance deployment needs shared coordination.

### 10.16 Telegram channels

| Method/path | Auth/role | Request | Success response |
|---|---|---|---|
| GET /api/channels | JWT member | Query { organizationId } | 200 { channels:NotificationChannel[] } |
| POST /api/channels | JWT manager | JSON { organizationId,type?:TELEGRAM,label,token (10–200),chatId,chatTitle? } | 201 { channel:NotificationChannel } |
| POST /api/channels/detect | JWT manager | JSON { organizationId,type?:TELEGRAM,token } | 200 { chats:[{id,type,title}] } |
| POST /api/channels/send-report | JWT manager/service rules | JSON { channelId,reportId } | 200 { ok:boolean,messages:number } |
| POST /api/channels/:id/test | JWT manager | path id; empty JSON body | 200 { ok:boolean,limit:number } |
| PATCH /api/channels/:id | JWT manager | subset { label?,token?,chatId?,chatTitle?:string|null,enabled?:boolean } | 200 { channel:NotificationChannel } |
| DELETE /api/channels/:id | JWT manager | path id | 200 { ok:true } |

NotificationChannel = { id,type:TELEGRAM,label,tokenLast4,chatId,chatTitle,enabled,lastDeliveryAt,lastDeliveryStatus,lastDeliveryError,createdAt }. The bot token is never returned.

## 11. Important nested DTOs and deterministic behavior

### Employee leaderboard row

    {
      rank, employeeId, name, usernames, mapped,
      commits, additions, deletions, filesChanged, lines, sampleMessages
    }

Report and statistics leaderboards use noise-free effective lines where requested, while raw additions/deletions remain separate metrics.

### Comparison

    {
      previousPeriod: { from, to },
      hasBaseline,
      commits: { current, previous, deltaPct },
      additions: { current, previous, deltaPct },
      deletions: { current, previous, deltaPct },
      filesChanged: { current, previous, deltaPct },
      contributors: { current, previous, deltaPct },
      movers: [{ name, employeeId, currentRank, previousRank, status, delta }]
    }

Insight is { kind, severity:"info"|"warn", text }. Theme is { title,summary,size:"small"|"medium"|"large" }.

### Contributor mapping rules

1. Discovery loads commit contributors and collaborators.
2. Known bots are ignored on first insert.
3. Employee aliases are organization-wide, normalized, and can contain multiple GitHub identities.
4. Exact declared username aliases auto-link existing and future repository identities.
5. Suggestions can use commit author email/name similarity but are not auto-applied.
6. Managers can manually map, unmap, or ignore identities.
7. Employee reports filter commits through mapped Git usernames.

### Statistics and analysis rules

- Statistics reads stored commits; it does not call GitHub on every dashboard load.
- Analysis/Appraisal use stored commits and deterministic report-engine helpers.
- Branch filtering uses reachability links and deduplicates SHAs.
- Lockfiles, generated folders, minified artifacts, and similar noise are excluded from effective-line signals.
- Unmapped users and data blind spots are surfaced rather than silently treated as complete data.

### Code quality rules

- Connection is per-organization or environment fallback.
- Tokens are encrypted at rest.
- Project keys must map to repositories in the same organization.
- Overview reads measures/issues/gate and best-effort records a daily snapshot.
- Summary aggregates mapped projects with weighted coverage.
- Trend is one snapshot per local day/project.
- Appraisal and reports can include quality evidence when snapshots exist.

### CI/Actions rules

- Inspect detects runtime, package manager, monorepo, framework, Node version, and scripts.
- Enable creates a setup branch and opens a workflow PR; it does not direct-push to default.
- Sync refreshes PR/workflow/run state.
- Workflow runs are mirrored from the provider into WorkflowRun.

### Schedules/delivery rules

- Schedules reuse orchestrateReport; they must not implement a second report pipeline.
- A schedule can reference a Telegram channel ID.
- Delivery failures are recorded and should not erase a generated report.
- Scheduler and collection worker are single-instance/in-process by design.

## 12. Tests and verification status

The API has Vitest unit tests and a migration test covering:

- token cipher and secret rotation;
- coverage interval math and period resolution;
- commit classification, plain language, comparisons, insights, and themes;
- schedule next-run/DST/month-clamp behavior;
- GitHub App auth, installation routing, push/FIFO ingestion, and initial backfill;
- GitHub DevOps, workflow templates, and stack detection;
- SonarQube and OpenAI providers;
- OpenClaw middleware/context/gateway;
- HTTP logger and repository-token resolution;
- disposable GitHub App-only migration cleanup.

There is not yet broad end-to-end API integration coverage for report/auth/RBAC/schedule flows, and there is no dedicated apps/web test suite. The next sensible test work is Supertest-style integration with mocked Git/LLM providers and a test DB/Prisma mock.

Recommended release gate:

    npm run prisma:generate
    npm run typecheck
    npm run lint
    npm test
    npm run build

Audit run on 2026-07-18: 26 test files and 162 tests passed; typecheck passed after the production build generated Next.js .next/types; lint passed; API/web/shared production builds passed.

## 13. Current risks and maintenance pitfalls

1. Older docs contain retired PAT/credential APIs; do not use them as current requirements.
2. Frontend DTO types are hand-maintained, not generated OpenAPI; backend runtime responses can be broader, especially GeneratedReport.
3. organizationId is repeated in many requests; every service must validate it against the authenticated user and target row.
4. OpenClaw tenant identity must remain signed/server-derived; never trust model/MCP-provided organization or requester IDs.
5. GitHub webhook raw-body ordering is security-critical.
6. App access removal/uninstall/disconnect intentionally deletes repository-scoped local history and related data. Treat UI/API changes here as destructive.
7. Reports must never fail only because the LLM is absent/unavailable.
8. Statistics/appraisal/awards must stay deterministic and evidence-based; LLM is enrichment only.
9. Scheduler/collection workers are in-process; multiple API replicas need shared coordination.
10. docs/TECH_STACK.md mentions Redis/Zustand/TanStack Query as intended stack, but current code does not use them.
11. integrations/devinsight-openclaw-plugin is superseded reference code; active integration is integrations/devinsight-mcp-server.
12. New provider code must preserve pagination/rate-limit caps and graceful-degradation contracts.

## 14. Source map

- Bootstrap/routes: apps/api/src/app.ts, apps/api/src/main.ts
- Current state: CLAUDE.md, docs/PROJECT_STATE.md
- Database: apps/api/prisma/schema.prisma and apps/api/prisma/migrations/
- Auth/access/errors: apps/api/src/modules/auth/, apps/api/src/common/access/, apps/api/src/common/middleware/error-handler.ts
- Report pipeline: apps/api/src/modules/openclaw/openclaw.service.ts, openclaw.tools.ts, openclaw.schemas.ts
- Collection: apps/api/src/modules/activity/
- Report persistence/share: apps/api/src/modules/reports/
- Analysis: apps/api/src/modules/analysis/
- Providers: apps/api/src/modules/{git-providers,github,llm,code-quality,devops-providers,github-devops,channels}/
- Frontend API contract: apps/web/src/lib/api.ts
- Frontend pages/components: apps/web/src/app/ and apps/web/src/components/
- MCP: integrations/devinsight-mcp-server/server.mjs and README.md
- Deployment: docs/DEPLOYMENT.md, docs/OPENCLAW_SETUP.md, Compose/deploy files

## 15. Instructions for a future ChatGPT/code agent

Before changing this repository:

1. Read this file, CLAUDE.md, and docs/PROJECT_STATE.md.
2. Treat current TypeScript/Prisma code as authoritative over older blueprints.
3. Inspect the matching controller, schema, service, frontend API helper, and Prisma model together before changing a contract.
4. Preserve tenant isolation, role checks, provider registries, audit logging, and deterministic fallback behavior.
5. Update apps/web/src/lib/api.ts when a frontend-used request/response changes.
6. Add pure unit tests and integration tests for cross-module behavior.
7. Run Prisma generation, typecheck, lint, tests, and build before handoff.
8. Update docs/PROJECT_STATE.md after completing the task.

### Final instruction to the next AI

Use this file as a current architecture/API map, but verify behavior that may have changed by opening the referenced source files. When proposing code, explicitly identify affected modules, endpoint contracts, authorization boundaries, data-model impact, migration needs, tests, and backward-compatibility risks.
