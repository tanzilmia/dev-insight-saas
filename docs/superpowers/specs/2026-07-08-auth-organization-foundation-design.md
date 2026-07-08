# Auth and Organization Foundation Design

## Goal

Build Milestone 1 for DevInsight AI: a real Neon-backed authentication and organization foundation that later Git credentials, repositories, contributor mapping, and OpenClaw tools can safely attach to.

## Backend Scope

- Keep Express modular with `app.ts`, `main.ts`, `config`, `common`, and feature modules.
- Add Prisma models for users, organizations, organization members, and request/audit logs.
- Add register, login, current-user, and organization listing endpoints.
- On register, create a user and a first organization in one transaction, assigning the user as `OWNER`.
- Use bcryptjs for password hashing and JWT bearer tokens for API authentication.
- Return safe user objects only; never return `passwordHash`.

## Frontend Scope

- Add a minimal auth client using Axios.
- Add register and login forms on the first screen.
- Store the access token locally for this MVP foundation only.
- Add a dashboard summary state after login that calls `/api/auth/me`.

## Validation

- Run Prisma validation and migration against Neon.
- Run lint, typecheck, build.
- Smoke test health, register, login, and me endpoints.

