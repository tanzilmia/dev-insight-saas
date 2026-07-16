# syntax=docker/dockerfile:1

# DevInsight API (Express 5 + Prisma 7). Built from the repo root as context so
# the whole npm-workspaces monorepo is available. See docker-compose.prod.yml.

# ---------- builder ----------
FROM node:20-slim AS builder
WORKDIR /app

# Prisma's engines need OpenSSL present during `prisma generate`.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install deps first so this layer is cached until a manifest changes. Every
# workspace manifest must be present for `npm ci` to resolve the workspace graph.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci

# Generate the Prisma client, then compile TypeScript -> dist/.
COPY . .
RUN npm run prisma:generate
RUN npm run build -w @devinsight/api

# ---------- runner ----------
FROM node:20-slim AS runner
WORKDIR /app/apps/api
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# node_modules is hoisted to the repo root, and the Prisma CLI (used by
# `migrate deploy` at startup) is a dev dependency, so copy the whole built tree
# rather than trying to prune it. Reliability over image size for now.
COPY --from=builder /app /app

EXPOSE 4000

# Applies pending migrations, then starts the API (see docker-entrypoint.sh).
ENTRYPOINT ["sh", "docker-entrypoint.sh"]
