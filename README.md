# dev-insight-saas

DevInsight AI is an AI-powered developer intelligence SaaS platform.

## Workspace

- `apps/web` - Next.js dashboard
- `apps/api` - Node.js/Express API
- `packages/shared` - shared TypeScript types and utilities
- `docs` - product and architecture documentation

## Local Docker services

The root `compose.yml` groups SonarQube and the sibling OpenClaw gateway under one
`devinsight` project in Docker Desktop while keeping OpenClaw's source and secrets in its
own repository.

```bash
npm run docker:up       # start SonarDB, SonarQube, and OpenClaw gateway
npm run docker:status   # inspect the long-running containers
npm run docker:down     # stop containers without deleting persisted data
```
