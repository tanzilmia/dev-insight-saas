# GitHub Actions CI — Design & Operations (Phase 1)

> **Status:** Phase 1 implemented on branch `feature/ci-github-actions`.
> **Scope of this document:** (a) the CI pipeline that now runs on *this* repository, and (b) the *design* for the future SaaS capability where DevInsight generates and manages CI workflows in **customer** repositories. Only (a) is implemented. (b) is documented so it can be built incrementally without rework — **no customer-repository automation, GitHub App, or SonarQube is implemented in this phase.**
> **Last updated:** 2026-07-14.

---

## Part A — CI that runs on this repository (IMPLEMENTED)

### A.1 What runs

A single workflow, [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml), job `verify`, on `ubuntu-latest`, Node 20. It is a **correctness gate only** — no deployment, no Docker publish, no SonarQube, no secrets.

| # | Step | Command | Why |
|---|---|---|---|
| 1 | Checkout | `actions/checkout@v4` | pinned major version |
| 2 | Set up Node | `actions/setup-node@v4` (`node-version: 20`, `cache: npm`) | matches `engines.node >= 20`; caches deps by `package-lock.json` |
| 3 | Install | `npm ci` | reproducible install from the root lockfile (npm workspaces) |
| 4 | Generate Prisma client | `npm run prisma:generate` | **required** — see A.4 |
| 5 | Typecheck | `npm run typecheck` | `tsc --noEmit` across `apps/api`, `apps/web`, `packages/shared` |
| 6 | Lint | `npm run lint` | `eslint` across `apps/api` + `apps/web` |
| 7 | Test | `npm test` | Vitest unit suite in `apps/api` (`apps/web` has no tests → skipped by `--if-present`) |
| 8 | Build | `npm run build` | `tsc` (api/shared) + `next build` (web) |

Each command is a **real root `package.json` script** — nothing in the workflow is invented. Steps run sequentially and fail loudly (fail-fast); no failing command is skipped or suppressed.

### A.2 Triggers

- **`pull_request`** — every PR (any base branch) is gated.
- **`push` to `main`** — protects the trunk after merge.
- **`workflow_dispatch`** — manual runs from the Actions tab.

`concurrency: cancel-in-progress` means a newer push to the same ref cancels the older in-flight run. `permissions: contents: read` — least privilege; the pipeline only reads the checked-out code and needs no write scopes or secrets.

### A.3 Reproduce every CI step locally

The pipeline is exactly the local developer loop. From the repo root:

```bash
npm ci                     # or: npm install
npm run prisma:generate    # generate @prisma/client (see A.4)
npm run typecheck
npm run lint
npm test
npm run build
```

All six were run in this order on `feature/ci-github-actions` before the workflow was committed; all pass (87/87 tests). New root scripts added for parity: `prisma:generate` (root → `-w @devinsight/api` → `prisma generate`).

### A.4 The Prisma-client gotcha (why step 4 exists)

There is **no `postinstall` hook** in any `package.json`, so a fresh `npm ci` does **not** generate the Prisma client. Backend code imports generated types (e.g. `import type { ReportSchedule, ScheduleCadence } from "@prisma/client"`) and instantiates `PrismaClient`, so **`typecheck` and `build` fail on a clean runner** unless `prisma generate` runs first. `prisma generate` only reads `prisma/schema.prisma` — it **does not connect to a database** (and `prisma.config.ts` supplies a localhost `DATABASE_URL` fallback), so the step needs **no secrets and no live DB**.

> If a future change adds a `postinstall: prisma generate` to `apps/api`, step 4 becomes redundant and can be removed. Until then it is mandatory.

### A.5 How to read a failure

| Failing step | Most likely cause | First thing to check locally |
|---|---|---|
| Install (`npm ci`) | lockfile out of sync with a `package.json` | `npm install`, commit the updated `package-lock.json` |
| Generate Prisma client | schema syntax error | `npm run prisma:generate` and read the Prisma error |
| Typecheck | a real type error, or a Prisma model used before `prisma generate` | `npm run typecheck`; ensure step 4 ran |
| Lint | ESLint rule violation (e.g. Next 16 `react-hooks/set-state-in-effect`) | `npm run lint` |
| Test | a failing/flaky unit test | `npm test` (or `npm run test:watch -w @devinsight/api`) |
| Build | `tsc` error, or `next build` error (e.g. font fetch, invalid route) | `npm run build`; check the workspace named in the log |

### A.6 Known considerations / deliberate limits

- **`next build` fetches Geist fonts** via `next/font/google` at build time → the build step needs network (GitHub runners have it). Not changed by this feature.
- **Single Node version (20).** A build matrix (20 + 22) can be added later; Phase 1 keeps it deterministic and fast.
- **One sequential job.** Splitting into parallel `typecheck`/`lint`/`test`/`build` jobs is a later optimization; a single job avoids re-installing deps four times for a small repo.
- **No `apps/web` tests and no integration tests yet** — CI enforces what exists; it does not create coverage. Adding Supertest integration tests (report flow with mocked `GitProvider`/`LLMProvider`) is the next testing step.
- **Deeper validation:** `actionlint` (GitHub Actions schema/shellcheck linter) is the recommended pre-merge check for the workflow file itself; it is not installed in this environment, so the YAML was validated for syntax/structure with Ruby's parser. Consider adding an `actionlint` step or pre-commit hook later.

---

## Part B — Future customer-repository CI automation (DESIGN ONLY — NOT IMPLEMENTED)

This is the foundation for the eventual product flow. **None of Part B is implemented in this phase.** It is documented so the boundaries are fixed before code is written.

### B.1 Target product flow

```mermaid
flowchart LR
    A[Dashboard: Connect GitHub] --> B[Select repository]
    B --> C[Click 'Enable CI' - manager/admin only]
    C --> D[Backend inspects repo stack]
    D --> E[Deterministic template selected + rendered + YAML-validated]
    E --> F[Create devinsight/ci-setup branch]
    F --> G[Commit workflow file to that branch]
    G --> H[Open a pull request]
    H --> I[User reviews & merges]
    I --> J[GitHub Actions runs]
    J --> K[DevInsight reads run status and displays it]
```

Never a direct write to a protected `main`; always a reviewable PR.

### B.2 Provider boundary — a **separate** `DevOpsProvider`, not an extension of `GitProvider`

**Decision: introduce a new `DevOpsProvider` abstraction; do NOT bolt repository-mutation and Actions operations onto the existing `GitProvider`.**

The existing `GitProvider` (`apps/api/src/modules/git-providers/git-provider.ts`) is an **activity-collection** port: `validateCredential`, `listRepositories`, `listContributors`, `listCommits`, `getCommitDetail`, `listBranches`, plus the narrow `createWebhook`/`deleteWebhook` already needed for live-sync. Its job is *"read what happened in a repo."*

Actions management is a different responsibility — *"mutate a repo and manage its CI"* — and mixing them is wrong for four concrete reasons:

1. **Single Responsibility / interface cohesion.** Repo mutation (branch/commit/PR) + run control (list/dispatch/cancel/rerun) would roughly double the `GitProvider` surface and blur a clean, well-understood interface that many collection code-paths depend on.
2. **Different credential & permission model.** Collection works with a read-scoped PAT. Mutation + Actions require **write** scopes (contents, pull requests, workflows, actions) that should come from a **GitHub App installation token** (see B.5), not the same stored PAT. Separate ports let the two evolve independent auth.
3. **Different risk & lifecycle.** Reads are org-**member**-gated. Mutations are **manager/admin**-gated, audit-logged, and PR-based. A separate interface keeps that risk boundary explicit at the type level rather than by convention inside one giant provider.
4. **Multi-provider without coupling.** GitHub, GitLab, and Bitbucket each implement `DevOpsProvider` independently; the "enable CI" business logic depends only on the interface, never on GitHub specifics — mirroring how `LLMProvider`/`ChannelProvider` already keep business logic vendor-neutral.

Proposed interface (illustrative — not yet coded), living in a new `modules/devops-providers/`:

```ts
interface DevOpsProvider {
  inspectRepository(input: InspectRepositoryInput): Promise<RepositoryStack>;
  getFile(input: GetRepositoryFileInput): Promise<RepositoryFile | null>;
  createBranch(input: CreateBranchInput): Promise<BranchResult>;
  commitFiles(input: CommitFilesInput): Promise<CommitResult>;
  createPullRequest(input: CreatePullRequestInput): Promise<PullRequestResult>;
  listWorkflowRuns(input: ListWorkflowRunsInput): Promise<WorkflowRun[]>;
  dispatchWorkflow(input: DispatchWorkflowInput): Promise<void>;
  cancelWorkflowRun(input: CancelWorkflowRunInput): Promise<void>;
  rerunWorkflow(input: RerunWorkflowInput): Promise<void>;
}
```

The GitHub implementation would call the REST endpoints: Git trees/contents (`GET /repos/{o}/{r}/contents/*`, `GET/POST /repos/{o}/{r}/git/refs`, `.../git/blobs`, `.../git/trees`, `.../git/commits`), pulls (`POST /repos/{o}/{r}/pulls`), and Actions (`GET /repos/{o}/{r}/actions/runs`, `POST .../actions/workflows/{id}/dispatches`, `POST .../actions/runs/{id}/cancel`, `POST .../actions/runs/{id}/rerun`). It reuses the same `request()` helper style, rate-limit handling (`GitRateLimitError`), and error mapping already proven in `github.provider.ts`.

**What stays out of the provider:** workflow *generation* (template selection + rendering + validation) is provider-agnostic and lives in a separate service (B.4). The provider only reads files for detection and writes the already-rendered file. This keeps templates decoupled from GitHub.

### B.3 Backend layering (follows the existing controller/service/schema convention)

```
modules/devops-providers/            # DevOpsProvider interface + registry (port)
modules/github-devops/               # GitHub implementation (adapter)
modules/ci-setup/
  ci-setup.controller.ts             # thin router; Zod .parse(); asyncHandler
  ci-setup.service.ts                # orchestration + RBAC + audit + persistence
  ci-setup.schemas.ts                # Zod request schemas
modules/workflow-templates/          # provider-agnostic generation + validation
```

`CiSetupService.enableCi(actorId, { organizationId, repositoryId })` would:
1. `requireOrganizationRole(actorId, organizationId, MANAGER_ROLES)` — mutation is manager/admin only.
2. Load the `Repository`, assert it belongs to the org (ownership check), resolve the org's DevOps credential.
3. `devops.inspectRepository(...)` → `RepositoryStack` (see B.4 detection).
4. `WorkflowGenerationService.generate(stack)` → deterministic YAML + validation.
5. `devops.createBranch` → `commitFiles` → `createPullRequest` (never write to `main`).
6. Persist a `WorkflowInstallation` record and write an `AuditLog` row in the same `$transaction`.
7. Return the PR URL to the dashboard (frontend helper in `lib/api.ts`, following the existing axios+JWT convention).

**Future data model (not migrated in this phase):** `WorkflowInstallation { organizationId, repositoryId, provider, templateId, templateVersion, branchName, pullRequestUrl, status, installedById, createdAt }` — snapshot-id style consistent with `Report`/`ReportSchedule`. Run status can be read live from `listWorkflowRuns` (no polling table needed initially), matching how `statistics` reads live rather than caching.

### B.4 Deterministic workflow generation (no LLM for executable YAML)

**Executable YAML is produced by versioned, human-reviewed templates — never generated free-form by an LLM.** (An LLM may *assist authoring* a template offline, but every shipped template is reviewed, pinned to a version, and validated.) This avoids the failure mode of an agent emitting subtly-broken or unsafe CI.

- **Template catalog**, keyed by `(repoType, version)`:
  - `node-monorepo@v1` — **production-ready = the workflow shipped in Part A** (this is the reference template for DevInsight-shaped repos).
  - `node-api@v1`, `nextjs@v1`, `flutter@v1` — **placeholders, deferred.**
- **Detection → `RepositoryStack`:**
  - *Stack*: presence of `package.json` (+ a `workspaces` field ⇒ monorepo), `next.config.*` ⇒ Next.js, `pubspec.yaml` ⇒ Flutter.
  - *Package manager*: lockfile — `package-lock.json` (npm), `pnpm-lock.yaml` (pnpm), `yarn.lock` (yarn).
  - *Scripts*: read `package.json` `scripts` to only emit steps that exist (same discipline as Part A — never emit a command with no matching script).
  - *Default branch*: from repo metadata.
- **Render → validate:** substitute variables (node version, package manager, script names, default branch) into the template, then **validate the YAML** (parse + structural checks; `actionlint` in the pipeline that authors templates) before it is ever committed.
- **Idempotent updates + conflict handling:**
  - Embed a **version marker** in the generated file (e.g. header comment `# devinsight-template: node-monorepo@v1`).
  - On "enable/update", detect an existing `.github/workflows/ci.yml`. If absent → create. If present with a matching marker and identical rendered content → **no-op** (idempotent). If the marker version is older → regenerate and open an update PR **only if content changed**.
  - If the file exists **without** the DevInsight marker, or has drifted from the marker's expected content (user hand-edits) → **do not overwrite**; surface a conflict and require manual review. DevInsight never clobbers user-authored CI.
- **PR-based install:** always via a `devinsight/ci-setup` branch + PR, so branch protection and human review are respected.

### B.5 Security rules & GitHub App (mandatory for Part B)

The Part A pipeline needs none of this (no secrets, read-only). Part B introduces repo mutation, and these rules are non-negotiable:

- **Never log tokens**; **never expose encrypted credentials to the frontend.** Reuse `common/crypto/token-cipher.ts` (AES-256-GCM) for any stored app/installation secret, exactly as PATs, webhook secrets, and Telegram tokens are stored today.
- **Never give OpenClaw (or any MCP tool) raw GitHub or future SonarQube secrets.** OpenClaw asks the backend; the backend holds secrets. (Same principle as the current chat path.)
- **Never write generated workflow files directly to a protected `main`.** Always branch + PR.
- **Least permissions**; **treat any customer-repo mutation as a manager/admin operation** (`requireOrganizationRole(MANAGER_ROLES)`), validate **organization membership and repository ownership** in the service, and **audit-log every mutation** in the same `$transaction`.

**Why a GitHub App (not a PAT) for customer automation — and why it's deferred:**
A user PAT is broad, tied to one person (breaks when they leave), and — critically — **GitHub restricts writing files under `.github/workflows/` unless the token carries the dedicated `workflows` permission**, which a generic PAT flow doesn't cleanly grant per-repo. A **GitHub App** gives per-installation, per-repository, fine-grained, short-lived tokens with a clear audit trail and customer-controlled least-privilege consent. Implementing the App (registration, installation callback, installation-token minting, webhook receipt) is **out of scope for this phase** and has no partial implementation in the repo today — so it is deferred, not stubbed.

**GitHub App permissions eventually required (documented, not requested/implemented now):**

| Permission | Access | Needed for |
|---|---|---|
| Metadata | Read | mandatory baseline |
| Contents | Read & Write | read files for detection; create branch + commit the workflow file |
| Workflows | Write | create/update files under `.github/workflows/*` (a distinct GitHub permission) |
| Pull requests | Read & Write | open the setup PR |
| Actions | Read & Write | list runs (status display), dispatch, cancel, rerun |
| Checks | Read (optional) | surface individual check-run status |

### B.6 Where future SonarQube fits (NOT in this feature)

SonarQube is intentionally absent from the codebase today (only the branch name referenced it). It layers on top of *this* foundation with **zero coupling changes**:
1. The DevInsight `node-monorepo` template gains an **opt-in Sonar scan job/step** (behind a versioned template variant), added by the same PR-based install flow.
2. Sonar credentials (token, host URL) are stored **encrypted** (reuse `token-cipher`), injected into the customer workflow as **repository/organization Actions secrets via the GitHub App** — never exposed to the frontend, never handed to OpenClaw.
3. A future `CodeQualityProvider` port (mirroring `DevOpsProvider`/`GitProvider`) reads Sonar results back into the analysis engine. Sonar being a *separate provider* is the same separation-of-concerns argument made in B.2.

---

## Part C — Implemented vs Deferred (at a glance)

**Implemented now (Phase 1):**
- `.github/workflows/ci.yml` — PR/push-`main`/manual gate: install → prisma generate → typecheck → lint → test → build, least-privilege, no secrets.
- Root/api `prisma:generate` scripts (command normalization).
- This document.

**Deferred (design captured above, no code):**
- `DevOpsProvider` abstraction + GitHub implementation.
- `CiSetupService` / `workflow-templates` module + `WorkflowInstallation` model + migration.
- GitHub App (registration, installation, token minting).
- Customer-repository inspection, branch/commit/PR creation, workflow dispatch/cancel/rerun.
- Dashboard "Enable CI" UI and run-status display.
- Non-monorepo templates (`node-api`, `nextjs`, `flutter`).
- SonarQube integration (scanner template, `CodeQualityProvider`, secrets injection).
- Branch-protection automation, GitLab CI, Bitbucket Pipelines, production deployment, Docker publication.
