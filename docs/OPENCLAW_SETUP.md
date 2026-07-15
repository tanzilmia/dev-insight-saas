# OpenClaw Runtime — Docker Setup (for DevInsight)

Goal: stand up the **OpenClaw agent runtime** in Docker so DevInsight's website chat
box (and later Telegram/Discord) can route report requests through it. This is the
**operator's task** (runs on your machine/server). Once it's up and you've copied two
values into `apps/api/.env`, tell the assistant and it will build the **DevInsight
OpenClaw plugin** and flip the chat box live.

> OpenClaw = an external, self-hosted AI-agent runtime (openclaw.ai). It exposes an
> HTTP gateway on **port 18789**; our backend talks to it server-side (the gateway
> token never reaches the browser). Sources: docs.openclaw.ai/install/docker,
> docs.openclaw.ai/gateway/security.

---

## 0. Prerequisites
- **Docker Desktop** (or Docker Engine) + **Docker Compose v2**.
- **~4 GB RAM** free for the running container, **~20 GB disk** (image + state).
- Your **Groq API key** (`gsk_…`) — the same one in `apps/api/.env` works.

## 1. Get OpenClaw and run the setup
```bash
git clone https://github.com/openclaw/openclaw.git
cd openclaw

# (optional, faster) use the prebuilt image instead of building locally:
export OPENCLAW_IMAGE=ghcr.io/openclaw/openclaw:latest

# builds/pulls the image, runs onboarding, starts the gateway via docker compose
./scripts/docker/setup.sh
```
The onboarding wizard runs interactively. When it asks about the **model provider**,
you can skip/accept defaults and set Groq in the next step. Onboarding generates a
**gateway token** and writes it to OpenClaw's `.env` as `OPENCLAW_GATEWAY_TOKEN`.

Initial onboarding still runs from the `openclaw` repository. After onboarding,
DevInsight's root `compose.yml` includes that upstream file while preserving its own
`.env`, paths, state, and secrets. Run normal lifecycle and CLI commands from the
**DevInsight repository root** so Docker Desktop groups the gateway with the other
`devinsight` services.

The setup script initially starts the gateway under an `openclaw` Compose project. Adopt
it into DevInsight once, from the DevInsight repository root:

```bash
docker compose -f ../openclaw/docker-compose.yml down  # keeps host-mounted OpenClaw state
npm run docker:up
```

This recreates only the container ownership; agent configuration, workspace data, and
credentials remain in their existing host mounts.

## 2. Point OpenClaw's LLM at Groq (OpenAI-compatible)
```bash
npm run docker:openclaw:cli -- config set models.openaiCompatible.baseUrl "https://api.groq.com/openai/v1"
npm run docker:openclaw:cli -- config set models.openaiCompatible.apiKey  "gsk_…your-groq-key…"
npm run docker:openclaw:cli -- config set models.openaiCompatible.model   "llama-3.3-70b-versatile"
```
(You can also do this in the Control UI → Settings → Models. Note: the docs' example
model `mixtral-8x7b-32768` is deprecated on Groq — use `llama-3.3-70b-versatile`.)

## 3. Confirm it's healthy
```bash
curl -fsS http://127.0.0.1:18789/healthz   # -> ok
```
Open the **Control UI** at `http://127.0.0.1:18789/` and paste the token from OpenClaw's
`.env` when prompted. Try a message in the built-in chat to confirm the agent + Groq work.

Get the gateway token anytime:
```bash
grep OPENCLAW_GATEWAY_TOKEN .env      # (in the openclaw repo root)
```

## 4. Wire DevInsight → OpenClaw
Add to **`apps/api/.env`** (DevInsight repo), then restart the DevInsight API:
```bash
OPENCLAW_GATEWAY_URL="http://localhost:18789"
OPENCLAW_GATEWAY_TOKEN="…paste the token from step 3…"
OPENCLAW_SERVICE_KEY="pick-a-long-random-secret"   # OpenClaw plugin will use this to call DevInsight
```
- `OPENCLAW_GATEWAY_URL` = the host reaches the published container port at `localhost:18789`.
- `OPENCLAW_SERVICE_KEY` = a secret you choose now; the DevInsight plugin (built next)
  sends it as `x-openclaw-key` to call `/api/openclaw/tools/*`.

After restart, `GET /api/openclaw/chat/status` returns `configured: true` and the chat
box stops showing "not connected".

## 5. Tell the assistant — it builds the plugin, then chat goes live
The remaining pieces (assistant's task):
1. **DevInsight OpenClaw plugin** — a small package using `defineToolPlugin` (TypeBox)
   whose tools call the DevInsight backend at **`http://host.docker.internal:4000`**
   (from inside the OpenClaw container → your host-run API) with the `OPENCLAW_SERVICE_KEY`.
   Installed via `openclaw plugins install <path>`, configured with `serviceUrl` +
   `apiKey`.
2. **`SKILL.md`** — teaches the agent when to call the report tools and how to format output.
3. Then a message in the website chat box → DevInsight backend → OpenClaw gateway
   (`/v1/chat/completions`, `model: openclaw:main`) → the agent calls the DevInsight
   plugin tools → a report comes back in the chat.

### Networking cheat-sheet (dev: DevInsight on host, OpenClaw in Docker)
| From → To | URL |
|---|---|
| DevInsight backend → OpenClaw gateway | `http://localhost:18789` |
| OpenClaw plugin (in container) → DevInsight API (host) | `http://host.docker.internal:4000` |
| Browser → DevInsight API | `http://localhost:4000` (unchanged) |

In production (real domain/HTTPS): OpenClaw stays on a **private/internal** network and
is never exposed publicly; only the DevInsight web + api are public over HTTPS. Only the
URLs above change (env), no code changes — see PROJECT_STATE.md §11.4 / deployment notes.

## Run everything (day-to-day)

Chat → reports needs these running (ports: web 3000, api 4000, MCP 4100, OpenClaw 18789):

1. **SonarQube + OpenClaw** (Docker, persistent): from the DevInsight repository root,
   `npm run docker:up` (stop with `npm run docker:down`, inspect with
   `npm run docker:status`). The command starts only long-running services; the
   interactive `openclaw-cli` helper remains a one-off container.
2. **DevInsight web + api**: from the DevInsight repo root, `npm run dev`.
3. **DevInsight MCP server**: `cd integrations/devinsight-mcp-server && ./run.sh`.

Then open the dashboard → the **💬 chat box** → e.g. *"give me this month's report for
the backend repo"*. The agent resolves the repo and returns the AI report in chat.

One-time registration: add `DEVINSIGHT_MCP_TOKEN=<MCP_ACCESS_TOKEN>` to OpenClaw's
ignored `.env`, then run `openclaw mcp set devinsight
'{"url":"http://host.docker.internal:4100/mcp","transport":"streamable-http","headers":{"Authorization":"Bearer ${DEVINSIGHT_MCP_TOKEN}"}}'`.

## Conversational Telegram (chat WITH the bot to get reports)

There are **two independent Telegram features** — don't confuse them:

| Feature | Direction | Where it's configured | Status |
|---|---|---|---|
| **Report delivery** (Channels page) | DevInsight → Telegram (**outbound**) | DevInsight admin panel (`/dashboard/channels`) | ✅ built in DevInsight |
| **Conversational** (this section) | Telegram → OpenClaw (**inbound**) | OpenClaw runtime (Docker) | report tools disabled until account linking exists |

The website chat mints a short-lived tenant token after authenticating a DevInsight user.
Telegram currently has no DevInsight account-linking flow, so Telegram conversations may
use the general OpenClaw agent but **cannot call DevInsight report tools**. This is a
fail-closed security boundary, not a runtime error.

### Steps (operator, one-time)
1. **Create a Telegram bot** with [@BotFather](https://t.me/BotFather) → `/newbot` →
   copy the bot **token**. (This can be the *same* bot you use for report delivery, or a
   separate one — a separate bot is cleaner so delivery and conversation don't collide.)
2. **Register the Telegram channel in OpenClaw** so inbound messages route to the default
   agent. From the DevInsight repo root (verify exact keys against
   `docs.openclaw.ai/channels/telegram` — OpenClaw's channel schema is authoritative):
   ```bash
   npm run docker:openclaw:cli -- config set channels.telegram.enabled true
   npm run docker:openclaw:cli -- config set channels.telegram.token   "<botfather token>"
   npm run docker:openclaw:cli -- config set channels.telegram.agent   "default"   # the same agent the web chat uses
   docker compose restart openclaw-gateway
   ```
   (Equivalently, the Control UI → **Channels → Add Telegram**.)
3. **Message the bot** for non-DevInsight conversation. DevInsight reports require a
   future account-linking flow that can mint an authenticated tenant context.

### Important: tenant scoping

The MCP server has no default organization or requester. Every DevInsight tool call must
carry a ten-minute API-signed context token minted by authenticated website chat. A
channel without such a token receives no organization data.

### Networking
The agent runs inside the OpenClaw container and reaches the DevInsight MCP server at
`http://host.docker.internal:4100/mcp` (already registered). Telegram reaches OpenClaw
via long-polling (OpenClaw calls Telegram's `getUpdates` outbound) — **no inbound webhook
/ public URL is required** for the conversational path, unlike GitHub live-sync.

## ✅ Working LLM config (Z.ai GLM-5.2) — RESOLVED

The OpenClaw **default agent's base context is large (~21–30k tokens** — it loads
several built-in plugins/skills), so the LLM provider must allow that per request.
**Groq free tier (12k TPM) was too small** (`413 Request too large`). We switched to
**Z.ai GLM-5.2 on the Coding Plan endpoint**, which works (verified end-to-end,
~13s/call with prompt caching). The exact runtime config:
```bash
# from the DevInsight repo root
npm run docker:openclaw:cli -- config set models.providers.zai.apiKey  "<z.ai key>"
npm run docker:openclaw:cli -- config set models.providers.zai.baseUrl "https://api.z.ai/api/coding/paas/v4"   # Coding Plan endpoint (GLM-5.2 lives here)
npm run docker:openclaw:cli -- config set agents.defaults.model        "zai/glm-5.2"
docker compose restart openclaw-gateway
```
Notes: GLM-5.2 is served by the **Coding Plan** endpoint (`api/coding/paas/v4`), not
the general one (`api/paas/v4`) — using the general endpoint returns
`429 Insufficient balance / no resource package` for a Coding-Plan key. The DevInsight
chat proxy sends `model: "openclaw/default"`; the gateway resolves it to this agent.

### Other provider options (if not using Z.ai)

- **Google Gemini free tier (recommended, free):** ~1M TPM. Get a key at
  aistudio.google.com, then reconfigure the `openai` provider:
  `models.providers.openai.baseUrl = https://generativelanguage.googleapis.com/v1beta/openai`,
  `.apiKey = <gemini key>`, model entry id `gemini-2.0-flash` (set `agents.defaults.model = openai/gemini-2.0-flash`).
- **Groq Dev tier (paid, cheap):** upgrade at console.groq.com/settings/billing → much higher TPM.
- **Local model (Ollama):** no token limits; needs a capable machine.
- (Advanced) shrink the agent by disabling unused built-in plugins so the base prompt fits 12k.

The current runtime is configured for Groq; switching = re-running the three
`config set models.providers.openai.*` commands with the new provider values + restart.

## Troubleshooting
- **Chat box still "not connected"** → DevInsight API didn't pick up the env; restart
  `npm run dev`. Check `GET /api/openclaw/chat/status`.
- **Gateway 401** → wrong/expired `OPENCLAW_GATEWAY_TOKEN`; re-copy from OpenClaw's `.env`.
- **Agent errors on model** → Groq model name/key wrong in `models.openaiCompatible`.
- **Plugin can't reach DevInsight** → use `host.docker.internal`, not `localhost`, inside
  the container.
