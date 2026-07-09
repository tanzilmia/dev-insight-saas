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

Both call DevInsight's service-key endpoints (`/api/openclaw/tools/*`).

## Run
```bash
cd integrations/devinsight-mcp-server
npm install          # once
./run.sh             # starts on :4100 (reads OPENCLAW_SERVICE_KEY from apps/api/.env)
```
`run.sh` defaults `DEVINSIGHT_ORG_ID`/`REQUESTER_ID` to the "Digital Pylot" org
(single-org MVP). Override via env for another org (ids from `GET /api/auth/me`).

## Register in OpenClaw (once)
```bash
cd ../../..  # the cloned openclaw repo
docker compose run --rm openclaw-cli mcp set devinsight \
  '{"url":"http://host.docker.internal:4100/mcp","transport":"streamable-http"}'
docker compose restart openclaw-gateway
```
`host.docker.internal` lets the Dockerized gateway reach this host-run server.

## Verified flow
`chat box → DevInsight /api/openclaw/chat → OpenClaw gateway → GLM-5.2 agent →
this MCP server → DevInsight /api/openclaw/tools/* → real report → back to chat`.
Natural requests work ("give me this month's report for the backend repo") — the
agent selects the tools itself; no SKILL needed.
