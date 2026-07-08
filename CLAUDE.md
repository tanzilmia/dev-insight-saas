# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

DevInsight AI — an AI-powered developer-intelligence / team work-report SaaS. Managers connect GitHub (via PAT), sync repositories, map Git contributors to employees, and generate AI reports about developer activity. The product is early: only the auth + organization foundation is built so far; Git integration, contributor mapping, OpenClaw orchestration, reports, and statistics are still to come (see `docs/TECH_STACK.md` §14 for the phase order).

## Monorepo layout

npm workspaces (`apps/*`, `packages/*`), Node ≥ 20.

- `apps/api` — Express 5 + Prisma 7 backend (`@devinsight/api`). **ESM** (`"type": "module"`), TypeScript 6, NodeNext.
- `apps/web` — Next.js 16 + React 19 dashboard (`@devinsight/web`). App Router, Tailwind 4, shadcn/ui.
- `packages/shared` — shared TS types/constants (`@devinsight/shared`), consumed by both apps.
- `docs/` — extensive product/architecture specs (two overlapping blueprint sets + `TECH_STACK.md`). Treat as intent, not current state.

## Commands

Run from the repo root; each fans out across workspaces via `--if-present`:

```bash
npm run dev          # start all apps
npm run dev:web      # web only  (== npm run dev -w @devinsight/web)
npm run dev:api      # api only  (== npm run dev -w @devinsight/api)
npm run build        # tsc / next build across workspaces
npm run lint         # eslint across workspaces
npm run typecheck    # tsc --noEmit across workspaces
```

Target one workspace directly with `-w @devinsight/api` or `-w @devinsight/web`.

Prisma (no npm scripts defined — run from `apps/api/`, config comes from `prisma.config.ts`):

```bash
cd apps/api
npx prisma migrate dev --name <change>   # create + apply a migration
npx prisma generate                      # regenerate the client after schema edits
npx prisma studio
```

**Tests: none exist yet.** No test runner is installed despite `docs/TECH_STACK.md` recommending Vitest/Supertest/Playwright. Set up the framework before writing the first test.

## Critical conventions (easy to get wrong)

- **Backend imports need explicit `.js` extensions**, even when importing a `.ts` file (e.g. `import { env } from "./config/env.js"`). This is required by NodeNext ESM resolution — matching the existing style is not optional, the build breaks otherwise.
- **Next.js 16 is not the version in your training data.** `apps/web/CLAUDE.md` → `AGENTS.md` instructs: read the relevant guide under `node_modules/next/dist/docs/` before writing web code, and heed deprecation notices. APIs and conventions differ from Next 13–15.
- **Prisma 7 driver-adapter setup.** The `datasource` block in `prisma/schema.prisma` intentionally has **no `url`** — the connection is supplied at runtime via `PrismaPg` in `src/config/database.ts` and to the CLI via `prisma.config.ts` (which reads `DATABASE_URL`). Don't "fix" the schema by adding a `url`. The DB is PostgreSQL (Neon in dev).
- **OpenClaw is the mandatory orchestration layer.** Every report-generation request must flow through OpenClaw, never straight from the dashboard or a controller to an LLM (`docs/TECH_STACK.md` §5, `AI_ASSISTANT_MASTER_PROMPT.md`). Keep GitHub-specific logic behind a `GitProvider` abstraction; never hardcode a single LLM provider.
- **PAT / credential security.** Git PATs are stored encrypted at rest (env-keyed via `GIT_TOKEN_ENCRYPTION_KEY`), never returned to the frontend, and never logged or cached decrypted.

## Backend architecture (`apps/api/src`)

Modular-by-feature under `modules/<feature>/`. Each module is a small set of files:

- `*.controller.ts` — an Express `Router`; thin. Wrap every async handler in `asyncHandler(...)` (from `common/http`), validate the body with a Zod schema's `.parse()` inline, call the service, send JSON.
- `*.service.ts` — business logic + Prisma access. Throws `AppError(statusCode, message, code)` for expected failures.
- `*.schemas.ts` — Zod request schemas. `*.types.ts`, `*.utils.ts`, `*.middleware.ts` as needed.

Cross-cutting pieces:

- `app.ts` — `createApp()` assembles middleware (`helmet`, `cors`, `express.json`, `pino-http`), mounts routers under `/api/*`, exposes `/health`, and registers `errorHandler` **last**.
- `common/middleware/error-handler.ts` — the single place errors become responses: `ZodError → 400 VALIDATION_ERROR`, `AppError → statusCode/code`, everything else `→ 500`. Always surface errors by throwing `AppError` from services rather than shaping responses in controllers.
- `config/env.ts` — Zod-validated `process.env`; import `env` from here, never read `process.env` directly.
- Auth: JWT (7-day), verified by `requireAuth` middleware which sets `req.authUser` (`{ id, email, memberships }`). RBAC roles `OWNER | MANAGER | EMPLOYEE | ADMIN`.

Data model (`prisma/schema.prisma`): `User`, `Organization`, `OrganizationMember` (join carrying `role` + `status`), plus `RequestLog` and `AuditLog`. IDs are `cuid`. Multi-step writes use `prisma.$transaction` and record an `AuditLog` row (see `auth.service.ts` `register`).

## Frontend architecture (`apps/web/src`)

Next.js App Router under `app/`, feature components under `components/<area>/`, helpers under `lib/`. `@/*` aliases `src/*`. shadcn/ui is configured (`components.json`, new-york style, `@/components/ui`, lucide icons). Planned client stack: Zustand (global UI/auth state), TanStack Query (server state), TanStack Table (data grids), Axios.

- `lib/api.ts` — the shared Axios instance (`baseURL` from `NEXT_PUBLIC_API_URL`, default `http://localhost:4000`) and typed API call helpers. Add new backend calls here.
- `lib/auth-storage.ts` — access token in `localStorage` under `devinsight.accessToken`.

## Env / local setup

Copy `apps/api/.env.example` → `apps/api/.env`. Required: `DATABASE_URL`, `JWT_ACCESS_SECRET` (≥ 24 chars), `GIT_TOKEN_ENCRYPTION_KEY`; `PORT` defaults to 4000. Web reads `NEXT_PUBLIC_API_URL`.
