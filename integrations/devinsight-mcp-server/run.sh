#!/usr/bin/env bash
# Runs the DevInsight MCP server. It exposes DevInsight's report tools to the
# OpenClaw agent over streamable-HTTP at http://<host>:4100/mcp.
#
# Requires the DevInsight API on :4000 and an authenticated OpenClaw MCP config.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$DIR/../../apps/api/.env"

read_env() {
  sed -n "s/^$1=//p" "$ENV_FILE" | head -1 | sed 's/^"//;s/"$//'
}

SVC="$(read_env OPENCLAW_SERVICE_KEY)"
MCP_TOKEN="$(read_env MCP_ACCESS_TOKEN)"

if [[ -z "$SVC" || -z "$MCP_TOKEN" ]]; then
  echo "OPENCLAW_SERVICE_KEY and MCP_ACCESS_TOKEN are required in apps/api/.env" >&2
  exit 1
fi

DEVINSIGHT_URL="${DEVINSIGHT_URL:-http://localhost:4000}" \
DEVINSIGHT_SERVICE_KEY="$SVC" \
MCP_ACCESS_TOKEN="$MCP_TOKEN" \
MCP_HOST="${MCP_HOST:-0.0.0.0}" \
PORT="${PORT:-4100}" \
node "$DIR/server.mjs"
