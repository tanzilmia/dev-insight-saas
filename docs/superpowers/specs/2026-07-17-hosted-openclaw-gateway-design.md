# Hosted OpenClaw Gateway and Private MCP Design

Date: 2026-07-17

## Context

DevInside already runs its web application, API, GitHub App webhook, SonarQube,
and Neon-backed data on the production VPS. The OpenClaw chat path exists in the
application, and the production Compose file contains placeholder `mcp` and
`openclaw-gateway` services, but the runtime has not been securely onboarded or
wired end to end on the VPS.

The desired operating model is intentionally shared during development:

- production and local DevInsight use the same Neon database;
- both use the production GitHub App, App-wide webhook, and GitHub Actions flow;
- both use the VPS-hosted SonarQube instance;
- OpenClaw and the DevInsight MCP bridge run only on the VPS;
- a local DevInsight API reaches that same hosted OpenClaw runtime over HTTPS.

The Groq account is paid and will use `llama-3.3-70b-versatile`. Provider quota
is therefore an operator concern rather than a reason to select another model in
this design.

## Goals

1. Run a persistent OpenClaw gateway and DevInsight MCP bridge on the VPS.
2. Make the authenticated OpenAI-compatible chat-completions route reachable at
   `https://devinside.softathena.com/openclaw` for the local DevInsight API.
3. Keep the MCP bridge, OpenClaw Control UI, and every other gateway route off
   the public internet.
4. Use the official Groq provider with the existing paid Groq credential.
5. Preserve the existing tenant boundary: a website chat request mints a short-
   lived DevInsight context token, and MCP tools cannot access an organization
   without it.
6. Keep all other application features operational if OpenClaw is unavailable.

## Non-goals

- Exposing the OpenClaw Control UI publicly.
- Publishing the MCP server on port 4100 or through nginx.
- Changing the GitHub webhook, GitHub Actions, SonarQube, or Neon architecture.
- Adding a database migration.
- Adding Telegram-to-DevInsight tenant linking.
- Running another OpenClaw or MCP instance on the local machine.

## Considered approaches

### 1. Restricted same-domain gateway path — selected

Expose only the gateway chat-completions route and a liveness route under the
existing TLS domain. Authentication remains OpenClaw's bearer-token check. This
meets local-development needs without exposing the administrative surface.

### 2. Full gateway under `/openclaw`

This would also publish the Control UI, WebSocket endpoints, and future gateway
routes. It is convenient for remote administration but materially increases the
public attack surface and makes nginx routing more complex.

### 3. Dedicated OpenClaw subdomain

A separate subdomain creates a clean trust boundary but needs additional DNS,
certificate, origin, and WebSocket configuration. It is unnecessary when the
only remote consumer is the local DevInsight API.

## Architecture

```text
Local DevInsight API
        |
        | HTTPS + OpenClaw bearer token
        v
https://devinside.softathena.com/openclaw/v1/chat/completions
        |
      nginx
        |
        | private Compose network
        v
OpenClaw gateway :18789
        |
        | Streamable HTTP + MCP bearer token
        v
DevInsight MCP bridge :4100
        |
        | x-openclaw-key + short-lived tenant context
        v
VPS DevInsight API :4000 ---> Neon / GitHub / reports
```

The VPS API bypasses nginx and uses
`http://openclaw-gateway:18789`. The local API uses
`https://devinside.softathena.com/openclaw`. Both authenticate with the same
fresh gateway token.

The MCP bridge stays on the Compose network at `http://mcp:4100/mcp`. OpenClaw
authenticates to it with `MCP_ACCESS_TOKEN`; the bridge authenticates to the
DevInsight tool endpoints with `OPENCLAW_SERVICE_KEY`. Tool requests also carry
the API-signed, ten-minute tenant context token already implemented by the chat
flow.

## Public HTTP surface

nginx will proxy exactly these routes:

- `POST /openclaw/v1/chat/completions` to the gateway's
  `/v1/chat/completions`, with streaming/buffering disabled;
- `GET /openclaw/healthz` to the gateway's `/healthz` for liveness checks.

Every other `/openclaw` path returns `404`. In particular, the Control UI,
configuration API, WebSockets, and MCP bridge are not routed publicly.

The chat route retains the incoming `Authorization: Bearer ...` header so the
gateway performs its own authentication. nginx will apply a conservative
per-client request-rate limit and long streaming timeouts. The health route is
unauthenticated because it exposes only liveness, matching OpenClaw's native
health endpoint.

## Container design

### OpenClaw gateway

The production service will be aligned with the official container layout:

- state mounted persistently at `/home/node/.openclaw` from
  `deploy/openclaw/`;
- `HOME`, config, state, and workspace paths set to container-native paths;
- gateway started explicitly in local mode on port 18789 with `bind=lan`, which
  is required for Docker bridge traffic;
- gateway authentication explicitly set to token mode, backed by
  `OPENCLAW_GATEWAY_TOKEN`;
- Chat Completions endpoint explicitly enabled;
- built-in health check against `127.0.0.1:18789/healthz`;
- port 18789 exposed only to the Compose network, not published on the VPS host;
- runtime state owned by container uid 1000.

The `openclaw` Compose profile remains optional, so the core application can
still start without OpenClaw.

### MCP bridge

The existing MCP image and server remain the implementation. It receives:

- `DEVINSIGHT_URL=http://api:4000`;
- `DEVINSIGHT_SERVICE_KEY` from `OPENCLAW_SERVICE_KEY`;
- `MCP_ACCESS_TOKEN` for its own bearer authentication.

It remains an internal `expose: 4100` service with no host port and no nginx
route. OpenClaw registers it as a `streamable-http` server and includes an
Authorization header sourced from the runtime environment.

## Groq configuration

OpenClaw will use the official Groq provider plugin:

- provider credential: `GROQ_API_KEY`;
- primary model: `groq/llama-3.3-70b-versatile`;
- OpenAI-compatible base URL remains managed by the provider.

The existing DevInsight API continues to use `OPENAI_API_KEY`,
`OPENAI_BASE_URL=https://api.groq.com/openai/v1`, and
`OPENAI_MODEL=llama-3.3-70b-versatile`. `GROQ_API_KEY` is a second environment
name containing the same paid Groq credential because OpenClaw's official
provider expects that name.

If Groq returns a quota or provider error, the gateway and MCP health checks may
still pass. The end-to-end chat verification must therefore include a real model
turn, and logs must distinguish upstream model errors from gateway/MCP failures.

## Secrets and rotation

The gateway and service keys previously pasted into chat are considered
compromised and will not be reused. Deployment generates fresh independent
values for:

- `OPENCLAW_GATEWAY_TOKEN` — local/VPS DevInsight API to gateway;
- `OPENCLAW_SERVICE_KEY` — MCP bridge to DevInsight service endpoints;
- `MCP_ACCESS_TOKEN` — OpenClaw to MCP bridge;
- `OPENCLAW_CONTEXT_SIGNING_SECRET` — VPS/local DevInsight API only.

All values live in gitignored environment files with mode `0600`. No deployment
command prints them, no literal token is stored in OpenClaw's tracked config,
and no secret appears in logs or documentation. OpenClaw's MCP header references
the runtime `MCP_ACCESS_TOKEN` environment variable.

## Environment contract

Production `deploy/.env.prod`:

The angle-bracket values below are deliberate redactions, not unresolved
requirements; deployment generates or copies each value without printing it.

```env
OPENCLAW_GATEWAY_URL="http://openclaw-gateway:18789"
OPENCLAW_GATEWAY_TOKEN="<fresh-secret>"
OPENCLAW_SERVICE_KEY="<fresh-secret>"
OPENCLAW_CONTEXT_SIGNING_SECRET="<fresh-secret>"
MCP_ACCESS_TOKEN="<fresh-secret>"
GROQ_API_KEY="<same-paid-groq-key-used-by-the-api>"
```

Local `apps/api/.env` uses the same values except:

```env
OPENCLAW_GATEWAY_URL="https://devinside.softathena.com/openclaw"
```

Local code does not connect to MCP directly. It calls the public authenticated
gateway; the hosted OpenClaw runtime calls its internal MCP service.

## Deployment sequence

1. Commit and deploy the Compose/nginx/env-documentation changes without
   exposing a working route yet.
2. Generate and store all fresh secrets on the VPS.
3. Prepare `deploy/openclaw/` ownership and run OpenClaw's one-time containerized
   onboarding against that persistent directory.
4. Install/enable the official Groq provider, enable Chat Completions, set the
   primary model, and register the internal DevInsight MCP server.
5. Start/recreate `api`, `mcp`, `openclaw-gateway`, and `nginx` with the OpenClaw
   profile.
6. Verify internal gateway health and MCP tool discovery before testing the
   public route.
7. Verify hosted website chat end to end.
8. Securely copy the updated production env to local, override only
   `OPENCLAW_GATEWAY_URL`, restart the local API, and verify local chat.

The order prevents a usable public route from existing before authentication and
runtime configuration are ready.

## Failure behavior and rollback

- Missing gateway configuration keeps the chat widget in its existing
  not-connected state; other product features continue to work.
- Gateway/MCP/model failures surface through the existing OpenClaw error path and
  do not affect GitHub ingestion, SonarQube, reports generated directly by the
  API, or scheduled collection.
- A missing OpenClaw profile makes the restricted nginx routes return an upstream
  error, while the rest of nginx continues routing the application normally.
- Rollback stops the `openclaw` profile and removes/rolls back only the restricted
  nginx locations; no database restoration is required.
- Persistent OpenClaw state remains under `deploy/openclaw/` across container
  recreation and is excluded from Git.

## Verification and acceptance criteria

1. `api`, `mcp`, `openclaw-gateway`, `web`, `nginx`, and SonarQube are healthy or
   running under the production Compose project.
2. Port 18789 is not publicly bound on the VPS.
3. `GET https://devinside.softathena.com/openclaw/healthz` returns `200`.
4. The public chat route rejects a missing or incorrect bearer token.
5. An authenticated streaming chat-completions request returns a Groq-backed
   answer.
6. OpenClaw's MCP probe lists `devinsight_context` and
   `devinsight_generate_report`.
7. A hosted website-chat report request calls the MCP tool and returns tenant-
   scoped DevInsight data.
8. A local API configured with the public gateway URL completes the same flow
   without a local OpenClaw or MCP process.
9. SonarQube, GitHub webhook ingestion, GitHub Actions provisioning, and normal
   application API traffic still pass smoke checks.
10. No secret is present in Git output, Compose-rendered logs, or documentation.

## References

- OpenClaw Docker setup and container paths:
  <https://github.com/openclaw/openclaw/blob/main/docs/install/docker.md>
- OpenClaw gateway security:
  <https://github.com/openclaw/openclaw/blob/main/docs/gateway/security/index.md>
- OpenClaw Groq provider:
  <https://docs.openclaw.ai/providers/groq>
- OpenClaw MCP client configuration:
  <https://docs.openclaw.ai/cli/mcp>
- Groq model and account-specific rate-limit behavior:
  <https://console.groq.com/docs/rate-limits>
