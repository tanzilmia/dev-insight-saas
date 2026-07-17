# OpenClaw + DevInsight MCP — VPS Setup

This is the current operator guide for the shared development/production model:

- OpenClaw and the DevInsight MCP bridge run only on the VPS;
- the hosted DevInsight API reaches the gateway over the private Compose network;
- a local DevInsight API reaches the same gateway through the restricted HTTPS
  route `https://devinside.softathena.com/openclaw`;
- MCP remains private and is never called directly from the local machine.

Architecture and security decisions are recorded in
`docs/superpowers/specs/2026-07-17-hosted-openclaw-gateway-design.md`.

## Runtime flow

```text
Hosted API -> http://openclaw-gateway:18789 -> OpenClaw -> http://mcp:4100/mcp
                                                             |
                                                             v
                                                    http://api:4000/tools

Local API  -> https://devinside.softathena.com/openclaw -> nginx -> OpenClaw
```

The website chat signs a ten-minute tenant context token. OpenClaw passes it to
the MCP tool, and MCP passes it to the VPS API with the service key. Neither the
model nor MCP chooses a trusted organization ID.

## 1. Production environment

Run everything below from the project root on the VPS:

```bash
cd /opt/projects/dev-insight-saas
nano deploy/.env.prod
```

Keep the existing Neon, GitHub App, SonarQube, and DevInsight LLM values. Ensure
these OpenClaw values exist:

```env
OPENCLAW_GATEWAY_URL="http://openclaw-gateway:18789"
OPENCLAW_GATEWAY_TOKEN=""
OPENCLAW_SERVICE_KEY=""
OPENCLAW_CONTEXT_SIGNING_SECRET=""
MCP_ACCESS_TOKEN=""
GROQ_API_KEY="same paid Groq credential used by OPENAI_API_KEY"
OPENCLAW_IMAGE="ghcr.io/openclaw/openclaw:latest"
```

`GROQ_API_KEY` and `OPENAI_API_KEY` may contain the same paid Groq credential.
They have separate names because OpenClaw and the DevInsight API use different
provider adapters.

Do not reuse any gateway/service token that has appeared in chat, screenshots,
shell history, or logs. Rotate all four cross-service secrets atomically:

```bash
npm run security:rotate-prod-openclaw-secrets
chmod 600 deploy/.env.prod
```

The command prints only variable names, never their values. Rotating the context
signing secret invalidates only already-issued chat context tokens, which expire
within ten minutes.

## 2. Prepare persistent OpenClaw state

The official image runs as uid 1000 and writes its configuration under
`/home/node/.openclaw`. Prepare the bind mount and pull the runtime image:

```bash
mkdir -p deploy/openclaw
sudo chown -R 1000:1000 deploy/openclaw

docker compose \
  --env-file deploy/.env.prod \
  -f docker-compose.prod.yml \
  pull openclaw-gateway openclaw-cli
```

The directory is gitignored except for `.gitkeep`; state survives container
recreation.

## 3. One-time OpenClaw onboarding

Run onboarding through the one-off CLI container. It shares the same persistent
state as the gateway but is not started by `npm run prod:up`:

```bash
npm run prod:openclaw:cli -- onboard --mode local --no-install-daemon
```

The later commands set the final provider and gateway values, so onboarding may
skip optional channels and providers.

Explicitly configure the gateway:

```bash
npm run prod:openclaw:cli -- config set gateway.mode local
npm run prod:openclaw:cli -- config set gateway.auth.mode token
npm run prod:openclaw:cli -- config set gateway.http.endpoints.chatCompletions.enabled true --strict-json
```

The gateway command in Compose uses `--bind lan` so nginx can reach it over the
Docker network. Port 18789 is not published on the VPS host.

## 4. Configure the paid Groq provider

Install the official provider and select the existing model:

```bash
npm run prod:openclaw:cli -- plugins install @openclaw/groq-provider
npm run prod:openclaw:cli -- models set groq/llama-3.3-70b-versatile
```

The CLI and gateway read `GROQ_API_KEY` from `deploy/.env.prod`. Never include
the key directly in the command.

## 5. Register the private DevInsight MCP bridge

Save the internal Streamable HTTP server definition. The single quotes are
important: `${MCP_ACCESS_TOKEN}` must stay as an environment reference in the
OpenClaw config, not expand into a stored literal.

```bash
npm run prod:openclaw:cli -- mcp set devinsight \
  '{"url":"http://mcp:4100/mcp","transport":"streamable-http","headers":{"Authorization":"Bearer ${MCP_ACCESS_TOKEN}"}}'
```

The bridge exposes only these tenant-scoped tools:

- `devinsight_context`
- `devinsight_generate_report`

## 6. Start the hosted stack

```bash
npm run prod:up
```

This starts/recreates the core, SonarQube, MCP, and OpenClaw services. Check
status and focused logs:

```bash
npm run prod:ps

docker compose \
  --env-file deploy/.env.prod \
  -f docker-compose.prod.yml \
  logs --tail=150 openclaw-gateway mcp api nginx
```

Expected:

- `api`, `mcp`, and `openclaw-gateway` become healthy;
- `openclaw-gateway` shows only `18789/tcp`, not a `0.0.0.0:18789` binding;
- `mcp` shows only `4100/tcp`;
- no secret value appears in logs.

## 7. Verify gateway, authentication, and MCP

Public liveness:

```bash
curl -fsS https://devinside.softathena.com/openclaw/healthz
```

The chat route must reject an unauthenticated request:

```bash
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' \
  -X POST https://devinside.softathena.com/openclaw/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"openclaw/default","messages":[{"role":"user","content":"health check"}]}'
```

Expected: `HTTP 401` or another gateway authentication rejection.

Load the environment without printing it and perform one real paid-Groq model
turn:

```bash
(
  set -a
  . deploy/.env.prod
  set +a

  curl -fsS https://devinside.softathena.com/openclaw/v1/chat/completions \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" \
    -d '{"model":"openclaw/default","stream":false,"messages":[{"role":"user","content":"Reply with: gateway ok"}]}'
)
```

Probe MCP after its container is healthy:

```bash
npm run prod:openclaw:cli -- mcp doctor devinsight --probe
```

The probe must list both DevInsight tools. Finally, log in to the hosted website
and request a repository report from the chat widget; this proves the context
token, gateway, Groq, MCP, service key, and VPS API together.

## 8. Use the hosted runtime from local development

Copy the updated VPS environment over SSH; run this on the Mac, not the VPS:

```bash
cd /Users/dpmac/Desktop/projects/hobby-project/DevInsight

scp root@144.79.249.78:/opt/projects/dev-insight-saas/deploy/.env.prod \
  deploy/.env.prod

cp deploy/.env.prod apps/api/.env
chmod 600 deploy/.env.prod apps/api/.env
nano apps/api/.env
```

Override only the URLs that differ between a host-run local API and the VPS
Docker network:

```env
PORT=4000
OPENCLAW_GATEWAY_URL="https://devinside.softathena.com/openclaw"
SONAR_BASE_URL="https://devinside.softathena.com/sonarqube"
SONAR_PUBLIC_URL="https://devinside.softathena.com/sonarqube"
```

The local API needs the same gateway token and context-signing secret. It mints
a context token, calls the public gateway, and the hosted MCP passes that token
to the VPS API, which verifies it against the same secret and shared Neon data.

Do not run local SonarQube, OpenClaw, or MCP. Start only the application:

```bash
npm run dev:api
```

In another terminal:

```bash
npm run dev:web
```

Open `http://localhost:3000`, sign in, and test the chat widget.

## 9. Updates and lifecycle

Normal deployment:

```bash
git pull --ff-only
npm run prod:up
```

OpenClaw configuration and installed provider state survive because
`deploy/openclaw/` is bind-mounted. To inspect configuration without exposing
secrets:

```bash
npm run prod:openclaw:cli -- models list --provider groq
npm run prod:openclaw:cli -- mcp status --verbose
```

To rotate the gateway/service trust boundary again:

```bash
npm run security:rotate-prod-openclaw-secrets
npm run prod:up
```

Copy the newly rotated env to local again before using local chat.

## 10. Troubleshooting

- **Chat says not connected:** API must have `OPENCLAW_GATEWAY_URL`,
  `OPENCLAW_GATEWAY_TOKEN`, `OPENCLAW_SERVICE_KEY`, and
  `OPENCLAW_CONTEXT_SIGNING_SECRET`; recreate `api` after editing env.
- **Public health returns 502:** inspect `openclaw-gateway` status/logs and verify
  `deploy/openclaw` is writable by uid 1000.
- **Public chat returns 401:** local/VPS API token does not match the gateway's
  `OPENCLAW_GATEWAY_TOKEN`; copy the latest env and restart the API.
- **Groq returns 401/403:** confirm `GROQ_API_KEY` exists and the official Groq
  provider is installed; do not place the key in OpenClaw config.
- **Groq returns 429:** inspect the paid account's organization limits and the
  response rate-limit headers.
- **MCP probe is unauthorized:** `MCP_ACCESS_TOKEN` differs between the gateway
  environment and `mcp` container; rotate/synchronize env and recreate both.
- **Tool endpoint returns invalid service key:** `OPENCLAW_SERVICE_KEY` differs
  between `api` and `mcp`; recreate both from the same env file.
- **Local tool call reports invalid context:** local and VPS
  `OPENCLAW_CONTEXT_SIGNING_SECRET` differ; securely copy the latest production
  env again.
- **`/openclaw/` returns 404:** expected. Only `/openclaw/healthz` and
  `/openclaw/v1/chat/completions` are public.

## Conversational Telegram boundary

DevInsight report delivery to Telegram and conversational Telegram are separate.
Website chat can call DevInsight tools because it has an authenticated tenant
context. A Telegram conversation does not have that context and therefore cannot
call DevInsight report tools until an explicit account-linking flow exists. This
fail-closed behavior remains unchanged.

## Official references

- OpenClaw Docker: <https://github.com/openclaw/openclaw/blob/main/docs/install/docker.md>
- Gateway security: <https://github.com/openclaw/openclaw/blob/main/docs/gateway/security/index.md>
- Groq provider: <https://docs.openclaw.ai/providers/groq>
- MCP configuration: <https://docs.openclaw.ai/cli/mcp>
