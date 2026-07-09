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

Run **all `docker compose` commands from the `openclaw` repo root** (where
`docker-compose.yml` lives).

## 2. Point OpenClaw's LLM at Groq (OpenAI-compatible)
```bash
docker compose run --rm openclaw-cli config set models.openaiCompatible.baseUrl "https://api.groq.com/openai/v1"
docker compose run --rm openclaw-cli config set models.openaiCompatible.apiKey  "gsk_…your-groq-key…"
docker compose run --rm openclaw-cli config set models.openaiCompatible.model   "llama-3.3-70b-versatile"
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

## ✅ Working LLM config (Z.ai GLM-5.2) — RESOLVED

The OpenClaw **default agent's base context is large (~21–30k tokens** — it loads
several built-in plugins/skills), so the LLM provider must allow that per request.
**Groq free tier (12k TPM) was too small** (`413 Request too large`). We switched to
**Z.ai GLM-5.2 on the Coding Plan endpoint**, which works (verified end-to-end,
~13s/call with prompt caching). The exact runtime config:
```bash
# from the openclaw repo root
docker compose run --rm openclaw-cli config set models.providers.zai.apiKey  "<z.ai key>"
docker compose run --rm openclaw-cli config set models.providers.zai.baseUrl "https://api.z.ai/api/coding/paas/v4"   # Coding Plan endpoint (GLM-5.2 lives here)
docker compose run --rm openclaw-cli config set agents.defaults.model        "zai/glm-5.2"
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
