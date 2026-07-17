# DevInsight — VPS Deployment (Docker)

Production runs the whole app in Docker on a single VPS, behind **nginx** on
ports **80/443** at `devinside.softathena.com`. The database stays on
**Neon** (external) — no app Postgres container.

```
                         VPS (one host, port 80)
   browser ──HTTP──▶  ┌──────────────── nginx ────────────────┐
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
| `deploy/nginx.conf` | Reverse proxy (`:80`, `/api` → api, else → web) |
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
- `JWT_ACCESS_SECRET` and `GIT_TOKEN_ENCRYPTION_KEY` — **copy the exact existing
  production values.** The encryption key still protects Sonar and channel
  integration secrets.
- Leave `NEXT_PUBLIC_API_URL=""` (same-origin API calls via nginx).
- Configure `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, and
  `GITHUB_APP_WEBHOOK_SECRET` for customer repositories and live push ingestion.
- LLM / OpenClaw / SonarQube values remain optional. For the hosted OpenClaw
  profile, set `GROQ_API_KEY`, keep
  `OPENCLAW_GATEWAY_URL=http://openclaw-gateway:18789`, and follow
  `docs/OPENCLAW_SETUP.md` before the first `prod:up`.

## 3. Start

```bash
# Everything (core + SonarQube + OpenClaw), build images on first run:
npm run prod:up

# …or just the core (web + api + nginx):
npm run prod:core
```

The `api` container applies pending Prisma migrations automatically before
serving. Open **`https://devinside.softathena.com`**; API calls use the same origin.

> The `20260717090000_github_app_only` migration is intentionally destructive:
> it permanently deletes every repository that lacks a matching active GitHub
> App access grant, including its repository-scoped history/reports. Take a Neon
> snapshot first only if you want an operator rollback point.

Useful commands:

```bash
npm run prod:ps      # status
npm run prod:logs    # follow logs (Ctrl+C to stop following)
npm run prod:down    # stop everything (volumes/data are kept)
npm run prod:config  # render the fully-resolved compose config (validation)
npm run prod:openclaw:cli -- <args> # one-off CLI using persistent gateway state
```

Raw equivalent (if you prefer not to use the npm scripts):

```bash
docker compose --env-file deploy/.env.prod -f docker-compose.prod.yml \
  --profile sonar --profile openclaw up -d --build
```

## 4. Updating a deployed version

```bash
git pull --ff-only
npm run prod:up      # rebuilds changed images and restarts; migrations auto-apply
```

Migrations run on every api start via `prisma migrate deploy` (safe: only applies
already-created migrations, never resets).

---

## Profiles

Services without a profile (`nginx`, `web`, `api`) always start. The rest are
opt-in:

- **`sonar`** — `sonarqube` + its own Postgres. Direct port 9000 is retained for
  VPS administration; client scans use the HTTPS `/sonarqube` route. Set
  `SONAR_TOKEN`, `SONAR_BASE_URL=http://sonarqube:9000/sonarqube`, and
  `SONAR_PUBLIC_URL=https://devinside.softathena.com/sonarqube`. Change
  `SONAR_DB_PASSWORD`.
- **`openclaw`** — `mcp` (our bridge, fully containerized) + `openclaw-gateway`
  (the external OpenClaw runtime). State lives in `deploy/openclaw/`. Port 18789
  is private to Compose; nginx exposes only authenticated
  `/openclaw/v1/chat/completions` plus `/openclaw/healthz`. MCP stays internal at
  `http://mcp:4100/mcp`. One-time Groq/onboarding/MCP registration and local
  shared-runtime setup are in `docs/OPENCLAW_SETUP.md`. Without this profile the
  chat widget simply shows "not connected".

Start a subset, e.g. core + sonar only:

```bash
docker compose --env-file deploy/.env.prod -f docker-compose.prod.yml \
  --profile sonar up -d --build
```

---

## Notes & gotchas

- **Single API instance.** The scheduler/deep worker and per-repository push FIFO
  support one API replica; do not scale `api` above one yet.
- **Same-origin design.** `NEXT_PUBLIC_API_URL=""` means the web bundle never
  hard-codes the host, so you don't rebuild the web image when the IP changes.
- **Data safety.** Persistent Docker data (SonarQube) lives in named volumes;
  `prod:down` keeps them. The app's real data is in Neon.
- **NDJSON chat stream.** `deploy/nginx.conf` sets `proxy_buffering off` on
  `/api/` so the AI chat streams token-by-token; don't remove it or the reply
  will only appear once, at the end.
- **Restricted OpenClaw surface.** Do not publish ports 18789 or 4100. Local
  development uses `OPENCLAW_GATEWAY_URL=https://devinside.softathena.com/openclaw`
  with the same rotated gateway/context secrets; it never calls MCP directly.
- **No 502 after updates.** The proxy uses Docker's DNS resolver
  (`resolver 127.0.0.11`) so it re-resolves `api`/`web` when they are rebuilt.

## Later: add a domain + HTTPS

nginx does not fetch certificates automatically, so pick one of:

**Option A — Certbot (Let's Encrypt) on the host.** Simplest if the VPS terminates
TLS itself.
1. Point an A record at the VPS IP and open port **443** (uncomment `- "443:443"`
   in `docker-compose.prod.yml`).
2. Get certs (e.g. `certbot certonly --standalone -d yourdomain.com` while nginx
   is briefly stopped, or use the webroot method) and mount them into the nginx
   container — uncomment the `./deploy/certs:/etc/nginx/certs:ro` volume.
3. Add an SSL server block to `deploy/nginx.conf` and redirect `:80` → `:443`:
   ```nginx
   server {
       listen 80;
       server_name yourdomain.com;
       return 301 https://$host$request_uri;
   }
   server {
       listen 443 ssl;
       http2 on;
       server_name yourdomain.com;
       ssl_certificate     /etc/nginx/certs/fullchain.pem;
       ssl_certificate_key /etc/nginx/certs/privkey.pem;
       # …then the same location /api/, /health, / blocks as the :80 server.
   }
   ```
4. `npm run prod:up`. Renewals: `certbot renew` + `docker compose … restart nginx`
   (or reload).

**Option B — Cloudflare (or any managed TLS front).** Point the domain through
Cloudflare with SSL "Full", keep the container on plain HTTP `:80`, and let
Cloudflare terminate TLS. Nothing in the stack changes.

No image rebuild is needed for the API URL because it is same-origin.
