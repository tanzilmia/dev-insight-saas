# DevInsight AI - Technology Stack

## Overview

DevInsight AI is an AI-powered Developer Intelligence and Team Work Report SaaS platform.

The platform uses:

- Next.js dashboard for the web application
- Node.js/TypeScript backend
- PostgreSQL with Prisma ORM
- Redis for caching
- OpenClaw as the AI orchestration layer
- GitHub first, with future GitLab and Bitbucket support
- LLM providers such as OpenAI, Claude, or OpenRouter

---

# 1. Frontend Stack

## Framework

- Next.js
- React
- TypeScript

## Styling

- Tailwind CSS
- shadcn/ui

## State Management

- Zustand

Use Zustand for lightweight global state such as:

- authenticated user state
- selected organization
- selected project
- dashboard UI state
- temporary report generation state

## Server State / Data Fetching

- TanStack Query

Use TanStack Query for:

- API data fetching
- caching API responses on frontend
- loading states
- error states
- mutations
- refetching repository/report/statistics data

## Tables

- TanStack Table

Use TanStack Table for:

- employee list
- repository list
- report history
- contributor mapping table
- statistics tables
- audit/request logs

## HTTP Client

- Axios

Use Axios for frontend-to-backend API communication.

Recommended setup:

- create a shared Axios instance
- attach auth token automatically
- handle API errors globally
- support request/response interceptors

---

# 2. Backend Stack

## Runtime

- Node.js

## Language

- TypeScript

## Backend Framework

- Express.js

Use Express only for backend APIs/tools needed by:

- Dashboard
- OpenClaw
- Git integration
- Report history
- Statistics
- Authentication
- Organization/project management

## Architecture

Use modular architecture.

Suggested backend modules:

- auth
- organizations
- users
- roles
- projects
- credentials
- repositories
- contributors
- reports
- statistics
- git-providers
- github
- llm
- openclaw
- notifications
- cache
- config
- database
- common
- logger

Each module should contain where appropriate:

- controller
- service
- repository
- DTOs
- validators
- interfaces
- types
- helpers
- errors

---

# 3. Database Stack

## Primary Database

- PostgreSQL

Use PostgreSQL for:

- users
- organizations
- projects
- repositories
- encrypted Git credentials
- contributor identities
- employee mapping
- commits
- changed files
- reports
- statistics
- audit logs
- request logs

## ORM

- Prisma ORM

Use Prisma for:

- schema definition
- migrations
- type-safe database access
- relationships
- seed data

---

# 4. Caching Stack

## Cache

- Redis

Use Redis for:

- caching repository sync results
- caching Git provider API responses
- caching report generation intermediate data
- rate-limit protection
- temporary OpenClaw workflow/session state if needed
- frequently accessed dashboard statistics

Important:

- Do not cache sensitive raw PAT values.
- Do not store decrypted credentials in Redis.
- Use TTL for cache entries.
- Use cache invalidation after repository sync or report generation.

---

# 5. AI / LLM Stack

## AI Orchestration

- OpenClaw

OpenClaw must be the single orchestration layer for every report generation request.

All report generation requests must flow through OpenClaw:

Dashboard / Chat Channel
→ OpenClaw
→ Backend Tools/APIs
→ Git Provider API
→ LLM
→ PostgreSQL
→ OpenClaw
→ Dashboard / Chat Response

## LLM Providers

Support provider abstraction for:

- OpenAI
- Claude
- OpenRouter
- future providers

Do not hardcode one LLM provider.

## AI Responsibilities

The AI system should:

- analyze commits
- classify work type
- detect risk
- generate Markdown reports
- summarize employee activity
- summarize team activity
- generate manager/CEO level insights

---

# 6. Git Provider Stack

## Initial Provider

- GitHub REST API

## Future Providers

- GitLab API
- Bitbucket API

## Design Rule

Use a provider abstraction.

Example:

```ts
interface GitProvider {
  getRepositories(): Promise<Repository[]>;
  getContributors(repoId: string): Promise<Contributor[]>;
  getCommits(input: GetCommitsInput): Promise<Commit[]>;
  getCommitDetails(input: GetCommitDetailsInput): Promise<CommitDetails>;
}
```

Do not hardcode GitHub-specific logic inside the report engine.

---

# 7. Authentication & Authorization

Recommended:

- JWT-based authentication for MVP
- Role-based access control

Roles:

- Owner / CEO
- Manager / Team Lead
- Employee / Developer
- Admin

Authorization must control:

- organization access
- project access
- report access
- employee report visibility
- Git credential management
- statistics visibility
- sharing permission

---

# 8. Security Stack

Required:

- encrypted Git PAT storage
- environment-based encryption key
- never expose PAT to frontend
- read-only Git provider permissions
- audit logs
- request logs
- server-side validation
- role-based permission checks

Recommended libraries:

- bcrypt or argon2 for password hashing
- jsonwebtoken or better-auth/auth.js depending on final auth choice
- zod for validation
- helmet for HTTP security
- cors with strict configuration

---

# 9. Validation

Use:

- Zod

Use Zod for:

- API request validation
- environment variable validation
- report generation input validation
- Git URL validation
- date range validation
- contributor filter validation

---

# 10. Logging

Recommended:

- Pino or Winston

Log:

- API requests
- OpenClaw tool calls
- Git sync jobs
- report generation attempts
- errors
- permission failures
- token validation failures

Do not log:

- raw PAT
- decrypted credentials
- sensitive user data
- full LLM prompts if they contain sensitive data

---

# 11. Testing Stack

Recommended:

- Vitest or Jest
- Supertest for API tests
- Testing Library for frontend
- Playwright for E2E tests

Test areas:

- command parsing
- date range resolver
- Git URL parsing
- contributor mapping
- permission checks
- credential encryption/decryption
- report generation
- statistics calculation
- OpenClaw tool API contracts

---

# 12. Deployment Stack

Use:

- Docker
- Docker Compose

Services:

- frontend
- backend
- PostgreSQL
- Redis
- OpenClaw
- optional worker/service if needed later

Production future:

- Nginx reverse proxy
- CI/CD
- managed PostgreSQL
- managed Redis
- cloud hosting

---

# 13. Final Recommended Stack Summary

## Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Zustand
- TanStack Query
- TanStack Table
- Axios

## Backend

- Node.js
- TypeScript
- Express.js
- Modular architecture
- Zod
- Prisma

## Database

- PostgreSQL

## Cache

- Redis

## AI / Agent

- OpenClaw
- OpenAI / Claude / OpenRouter compatible provider abstraction

## Git

- GitHub REST API first
- GitLab and Bitbucket later using provider abstraction

## DevOps

- Docker
- Docker Compose
- Nginx later

---

# 14. Implementation Rule for AI Coding Assistants

Before writing code, Claude/Codex/Cursor must read this file and follow the stack decisions.

Do not replace the selected technologies unless explicitly requested.

Do not generate the whole project at once.

Implement phase by phase:

1. Backend foundation
2. Database schema
3. Auth and organization
4. Git credential management
5. Repository sync
6. Contributor mapping
7. OpenClaw integration
8. Report generation
9. Dashboard UI
10. Statistics
11. Testing
12. Deployment