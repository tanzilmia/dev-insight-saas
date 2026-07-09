#!/usr/bin/env bash
# Starts DevInsight web (:3000) + api (:4000) + MCP server (:4100) together.
# OpenClaw runs separately in Docker (docker compose up -d in the openclaw repo).
# Press Ctrl+C to stop all three.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Starting DevInsight  →  web :3000 · api :4000 · MCP :4100"
echo "(OpenClaw runs separately in Docker on :18789)"
echo "Press Ctrl+C to stop everything."
echo

cd "$ROOT"
npm run dev:api & API_PID=$!
npm run dev:web & WEB_PID=$!
( cd "$ROOT/integrations/devinsight-mcp-server" && ./run.sh ) & MCP_PID=$!

# Stop all children when this script is interrupted or exits.
trap 'echo; echo "Stopping DevInsight..."; kill $API_PID $WEB_PID $MCP_PID 2>/dev/null' INT TERM EXIT

wait
