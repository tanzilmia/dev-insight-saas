#!/usr/bin/env bash
# Starts DevInsight web (:3000) + api (:4000) + MCP server (:4100) together.
# OpenClaw runs separately in Docker (docker compose up -d in the openclaw repo).
# Press Ctrl+C to stop all three.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

# Override these when another local project already occupies the default ports.
# Example: DEVINSIGHT_API_PORT=4010 npm run dev
API_PORT="${DEVINSIGHT_API_PORT:-4000}"
WEB_PORT="${DEVINSIGHT_WEB_PORT:-3000}"
MCP_PORT="${DEVINSIGHT_MCP_PORT:-4100}"
API_URL="${DEVINSIGHT_API_URL:-http://localhost:${API_PORT}}"

echo "Starting DevInsight  →  web :${WEB_PORT} · api :${API_PORT} · MCP :${MCP_PORT}"
echo "(OpenClaw runs separately in Docker on :18789)"
echo "Press Ctrl+C to stop everything."
echo

cd "$ROOT"
PORT="$API_PORT" npm run dev:api & API_PID=$!
NEXT_PUBLIC_API_URL="$API_URL" npm run dev -w @devinsight/web -- --port "$WEB_PORT" & WEB_PID=$!
( cd "$ROOT/integrations/devinsight-mcp-server" && DEVINSIGHT_URL="$API_URL" PORT="$MCP_PORT" ./run.sh ) & MCP_PID=$!

# Stop all children when this script is interrupted or exits.
trap 'echo; echo "Stopping DevInsight..."; kill $API_PID $WEB_PID $MCP_PID 2>/dev/null' INT TERM EXIT

wait
