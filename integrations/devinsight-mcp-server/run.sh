#!/usr/bin/env bash
# Runs the DevInsight MCP server. It exposes DevInsight's report tools to the
# OpenClaw agent over streamable-HTTP at http://<host>:4100/mcp.
#
# Requires: the DevInsight API running on :4000, and OpenClaw configured with
#   openclaw mcp set devinsight '{"url":"http://host.docker.internal:4100/mcp","transport":"streamable-http"}'
#
# ORG_ID / REQUESTER_ID default to the "Digital Pylot" org + owner (single-org MVP).
# Override via env for a different org. Get ids from GET /api/auth/me while logged in.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

SVC="$(grep '^OPENCLAW_SERVICE_KEY=' "$DIR/../../apps/api/.env" | head -1 | sed 's/^OPENCLAW_SERVICE_KEY=//' | tr -d '"')"

DEVINSIGHT_URL="${DEVINSIGHT_URL:-http://localhost:4000}" \
DEVINSIGHT_SERVICE_KEY="$SVC" \
DEVINSIGHT_ORG_ID="${DEVINSIGHT_ORG_ID:-cmrc2bz8a0005qrceqvgnu635}" \
DEVINSIGHT_REQUESTER_ID="${DEVINSIGHT_REQUESTER_ID:-cmrc2bz5s0004qrce8vq20adr}" \
PORT="${PORT:-4100}" \
node "$DIR/server.mjs"
