#!/bin/sh
# Container entrypoint for the DevInsight API.
#
# Runs from /app/apps/api (WORKDIR). Applies any pending Prisma migrations
# against DATABASE_URL, then launches the compiled server. `migrate deploy` is
# the production-safe command: it only applies already-created migrations and
# never generates or resets anything.
set -e

echo "[devinsight-api] Applying database migrations (prisma migrate deploy)..."
npx prisma migrate deploy

echo "[devinsight-api] Starting API on port ${PORT:-4000}..."
if [ "$#" -eq 0 ]; then
  set -- node dist/main.js
fi
exec "$@"
