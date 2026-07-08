# Monorepo Bootstrap Design

## Goal

Bootstrap a fresh `dev-insight-saas` repository with separate frontend and backend workspaces while preserving the existing documentation.

## Structure

- `apps/web`: Next.js dashboard using TypeScript and Tailwind CSS.
- `apps/api`: Express API using TypeScript.
- `packages/shared`: shared TypeScript constants and future DTOs.
- `docs`: existing product and architecture documentation.

## Dependency Direction

The root package uses npm workspaces so frontend, backend, and shared packages can be installed and run independently. The backend starts with a minimal `/health` route and dependencies required for the Phase 1 foundation. The frontend starts with the standard Next.js App Router setup plus dashboard dependencies from `docs/TECH_STACK.md`.

## Git

Initialize the repository on `main`, connect `https://github.com/tanzilmia/dev-insight-saas.git`, and keep frontend/backend code in separate folders.

