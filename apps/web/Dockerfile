# syntax=docker/dockerfile:1

# DevInsight web (Next.js 16, standalone output). Built from the repo root as
# context so the whole npm-workspaces monorepo is available.

# ---------- builder ----------
FROM node:20-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_OUTPUT=standalone

# NEXT_PUBLIC_* values are baked into the client bundle at build time. Empty =>
# the browser calls the API same-origin ("/api/..."), which Caddy routes to the
# api container. Keeping it empty means the web image never needs rebuilding when
# the VPS IP or domain changes.
ARG NEXT_PUBLIC_API_URL=""
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# Install deps first (cached until a manifest changes). All workspace manifests
# are required for `npm ci` to resolve the workspace graph.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN npm ci

COPY . .
RUN npm run build -w @devinsight/web

# ---------- runner ----------
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Next.js standalone output. With outputFileTracingRoot = repo root the bundle
# keeps the monorepo layout, so the server entry is apps/web/server.js. `static`
# and `public` are copied alongside it so the standalone server can serve them.
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
