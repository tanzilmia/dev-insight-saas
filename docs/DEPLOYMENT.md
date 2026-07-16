# DevInsight — VPS Deployment (Docker)

Production runs the whole app in Docker on a single VPS, behind a Caddy reverse
proxy on port **80** (HTTP, IP-only for now). The database stays on **Neon**
(external) — no app Postgres container.

```
                         VPS (one host, port 80)
   browser ──HTTP──▶  ┌──────────────── caddy ────────────────┐
                      │   /api/*  ─▶ api:4000  (Express)       │
                      │   /*      ─▶ web:3000  (Next.js)       │
                      └───────────────────────────────────────┘
                                api ──▶ Neon (external Postgres)

   optional profiles:  sonar    → sonarqube (+ its own Postgres)
                       openclaw  → mcp:4100 + openclaw-gateway:18789 (AI chat)
```

Everything below runs **from the repo root on the VPS**. Local development is
unchanged — keep using `npm run dev` (see the main README / CLAUDE.md).

---

## What's in the box

| File | Purpose |
|------|---------|
| `docker-compose.prod.yml` | The production stack (core + `sonar`/`openclaw` profiles) |
| `apps/api/Dockerfile` + `docker-entrypoint.sh` | API image; runs `prisma migrate deploy` on start |
| `apps/web/Dockerfile` | Next.js **standalone** image |
| `integrations/devinsight-mcp-server/Dockerfile` | MCP bridge image (OpenClaw chat) |
| `deploy/Caddyfile` | Reverse proxy (`:80`, `/api` → api, else → web) |
| `deploy/env.prod.example` | Production env template → copy to `deploy/.env.prod` |

---

## 1. Prerequisites on the VPS

- Docker Engine + the Compose plugin
  ```bash
  curl -fsSL https://get.docker.com | sh
  ```
- Open port **80** (and 443 later when you add a domain) in the firewall / cloud security group.
- The code on the box: `git clone <your-repo>` and `cd` into it.
- ~2 GB RAM is enough for the core; add ~2 GB more if you enable the `sonar` profile.

## 2. Configure environment

```bash
cp deploy/env.prod.example deploy/.env.prod
nano deploy/.env.prod
```

Fill in at minimum:

- `DATABASE_URL` — your Neon connection string (keep `?sslmode=require`).
- `JWT_ACCESS_SECRET` and `GIT_TOKEN_ENCRYPTION_KEY` — **copy the exact values
  from your current `apps/api/.env`.** They must match, because the Neon data
  already contains JWTs and Git PATs encrypted with those secrets. A new key
  makes existing PATs undecryptable.
- Leave `NEXT_PUBLIC_API_URL=""` (same-origin API calls via Caddy).
- `PUBLIC_API_URL="http://YOUR_VPS_IP"` if you want GitHub live-sync webhooks.
- LLM / OpenClaw / SonarQube / GitHub App values as needed (all optional).

## 3. Start

```bash
# Everything (core + SonarQube + OpenClaw), build images on first run:
npm run prod:up

# …or just the core (web + api + caddy):
npm run prod:core
```

The `api` container applies pending Prisma migrations automatically before
serving. Open **`http://YOUR_VPS_IP`** — the dashboard loads, and API calls go to
`http://YOUR_VPS_IP/api/...` on the same origin.

Useful commands:

```bash
npm run prod:ps      # status
npm run prod:logs    # follow logs (Ctrl+C to stop following)
npm run prod:down    # stop everything (volumes/data are kept)
npm run prod:config  # render the fully-resolved compose config (validation)
```

Raw equivalent (if you prefer not to use the npm scripts):

```bash
docker compose --env-file deploy/.env.prod -f docker-compose.prod.yml \
  --profile sonar --profile openclaw up -d --build
```

## 4. Updating a deployed version

```bash
git pull
npm run prod:up      # rebuilds changed images and restarts; migrations auto-apply
```

Migrations run on every api start via `prisma migrate deploy` (safe: only applies
already-created migrations, never resets).

---

## Profiles

Services without a profile (`caddy`, `web`, `api`) always start. The rest are
opt-in:

- **`sonar`** — `sonarqube` + its own Postgres. Bound to `127.0.0.1:9000` on the
  VPS (not public). To use code-quality features, set `SONAR_TOKEN` /
  `SONAR_BASE_URL=http://sonarqube:9000` in `deploy/.env.prod`, or configure a
  per-org connection in the UI. Change `SONAR_DB_PASSWORD`.
- **`openclaw`** — `mcp` (our bridge, fully containerized) + `openclaw-gateway`
  (the external OpenClaw runtime). The gateway still needs its own setup — an LLM
  provider and `openclaw mcp set devinsight` pointing at `http://mcp:4100/mcp`.
  Follow `docs/OPENCLAW_SETUP.md`; its state lives in `deploy/openclaw/`. If you
  already run OpenClaw elsewhere, you can drop the gateway service and keep only
  `mcp`. Without this profile the chat widget simply shows "not connected".

Start a subset, e.g. core + sonar only:

```bash
docker compose --env-file deploy/.env.prod -f docker-compose.prod.yml \
  --profile sonar up -d --build
```

---

## Notes & gotchas

- **Single API instance.** The scheduler and the deep-collection worker run
  in-process with in-memory claim guards, so **do not scale `api` to >1 replica**
  (a shared queue would be needed first — see PROJECT_STATE "Phase E").
- **Same-origin design.** `NEXT_PUBLIC_API_URL=""` means the web bundle never
  hard-codes the host, so you don't rebuild the web image when the IP changes.
- **Data safety.** All persistent Docker data (Caddy certs, SonarQube) lives in
  named volumes; `prod:down` keeps them. The app's real data is in Neon.

## Later: add a domain + HTTPS

1. Point an A record at the VPS IP.
2. In `deploy/Caddyfile`, replace `:80` with `yourdomain.com` and delete the
   `auto_https off` block.
3. Uncomment the `- "443:443"` port in `docker-compose.prod.yml` and open 443.
4. `npm run prod:up`. Caddy fetches a Let's Encrypt certificate automatically.

No image rebuild is needed for the API URL (it's already same-origin). If you had
set `PUBLIC_API_URL`, update it to `https://yourdomain.com`.
