# DevInsight MCP Server

A tiny **streamable-HTTP MCP server** (runs on the host) that exposes DevInsight's
report tools to the OpenClaw agent. This is how the OpenClaw chat can generate real
reports — cleaner than a bundled OpenClaw plugin (no in-container build).

**Chosen over** the TypeScript plugin in `../devinsight-openclaw-plugin/` because
OpenClaw runs in Docker; a host MCP server avoids in-container builds and the
unverified plugin-sdk compile. The plugin dir is kept for reference.

## Tools
- `devinsight_context` — list the org's tracked repos/projects/employees (id + name).
- `devinsight_generate_report` — generate a repository/project/employee/team report
  (Markdown, with Phase 9 work-breakdown + risk signals).

Both require the opaque, short-lived `contextToken` supplied by DevInsight chat and
call the service-key endpoints (`/api/openclaw/tools/*`). Tenant identity comes from
that API-signed token, never from MCP environment defaults or model-provided ids.

## Run
```bash
cd integrations/devinsight-mcp-server
npm install          # once
./run.sh             # reads OPENCLAW_SERVICE_KEY + MCP_ACCESS_TOKEN from apps/api/.env
```

The server itself defaults to `127.0.0.1`. `run.sh` explicitly uses `0.0.0.0` so
Docker Desktop can reach the host service; the bearer token is still mandatory.
Keep port 4100 behind a host firewall/private network.

## Register in OpenClaw (once)
```bash
cd ../../..  # the cloned openclaw repo
docker compose run --rm openclaw-cli mcp set devinsight \
  '{"url":"http://host.docker.internal:4100/mcp","transport":"streamable-http","headers":{"Authorization":"Bearer ${DEVINSIGHT_MCP_TOKEN}"}}'
docker compose restart openclaw-gateway
```
`host.docker.internal` lets the Dockerized gateway reach this host-run server.
Put `DEVINSIGHT_MCP_TOKEN=<MCP_ACCESS_TOKEN>` in OpenClaw's ignored `.env`; never
commit the literal bearer token to a tracked OpenClaw configuration.

## Verified flow
`chat box → DevInsight /api/openclaw/chat → OpenClaw gateway → GLM-5.2 agent →
this MCP server → DevInsight /api/openclaw/tools/* → real report → back to chat`.
Natural requests work ("give me this month's report for the backend repo") — the
agent selects the tools itself; no SKILL needed.
