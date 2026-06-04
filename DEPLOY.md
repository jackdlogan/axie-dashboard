# Deploying to a VPS (Docker Compose + Caddy)

The stack is three containers:

- **web** — serves the built dashboard and proxies `/api/graphql` to Sky Mavis with
  the `X-API-Key` injected server-side (the key never reaches the browser).
- **refresh** — runs `scripts/update.mjs` (Dune ingest + trait enrich) on start and
  then hourly, writing the JSON to a volume the **web** container serves live.
- **caddy** — reverse proxy with automatic HTTPS for your domain.

## Prerequisites

- A VPS with **Docker** + the **compose** plugin installed.
- A **domain** with an `A` record pointing at the VPS's public IP.
- Inbound ports **80** and **443** open (Caddy needs both for HTTPS issuance).

## Steps (dedicated VPS — this app owns ports 80/443)

```bash
# 1. Get the code onto the VPS
git clone <your-repo-url> axie-dashboard && cd axie-dashboard

# 2. Configure secrets + domain
cp .env.example .env
nano .env   # set SKYMAVIS_API_KEY, DUNE_API_KEY, DUNE_QUERY_*, DOMAIN, ACME_EMAIL

# 3. Build and start (includes bundled Caddy for HTTPS)
docker compose --profile caddy up -d --build

# 4. Watch it come up (TLS issuance takes a few seconds on first run)
docker compose logs -f caddy
```

## Steps (shared VPS — another app already uses 80/443)

If nginx, Apache, or another Caddy instance already binds ports 80/443, **do not**
start the bundled `caddy` service. Run only **web** + **refresh**, bind the app to
localhost, and add a vhost in your existing reverse proxy.

```bash
git clone <your-repo-url> axie-dashboard && cd axie-dashboard
cp .env.example .env
nano .env   # SKYMAVIS_API_KEY, DUNE_API_KEY, DUNE_QUERY_* (DOMAIN/ACME_EMAIL unused here)

# Stop any failed/partial stack from a prior attempt
docker compose down

# web + refresh only; listens on 127.0.0.1:8090
docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --build
docker compose logs -f web
```

Then proxy a **subdomain** (recommended) to the dashboard. The app listens on
`127.0.0.1:<DASHBOARD_HOST_PORT>` (default **8090**); your host reverse proxy
keeps using **80/443** — no port conflict.

### Host Caddy (recommended on a shared VPS)

Your system Caddy continues to terminate HTTPS on `:443`. Add one site block
that forwards to the dashboard's localhost port.

1. In `.env`, set the subdomain and port (pick a free port if 8090 is taken):

   ```bash
   DOMAIN=dashboard.yourdomain.com
   DASHBOARD_HOST_PORT=8090
   ```

2. Start the dashboard stack:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --build
   ```

3. Verify the app responds locally:

   ```bash
   curl -s http://127.0.0.1:8090/ | head
   ```

4. Add to your **host** Caddyfile (see `deploy/caddy.host.example`):

   ```caddy
   dashboard.yourdomain.com {
       encode zstd gzip
       reverse_proxy 127.0.0.1:8090
   }
   ```

5. Validate and reload host Caddy:

   ```bash
   sudo caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```

6. Point DNS: `A` record for `dashboard.yourdomain.com` → VPS IP.

Caddy on the host issues the TLS cert automatically — you do **not** need the
bundled `caddy` Docker service or `ACME_EMAIL` in `.env` for this mode.

### nginx

See `deploy/nginx.example.conf` (upstream `http://127.0.0.1:8090`).

Verify locally before changing DNS/proxy:

```bash
curl -s http://127.0.0.1:${DASHBOARD_HOST_PORT:-8090}/ | head
```

Then open `https://<your DOMAIN>`. Live panels (KPIs, collections, rates, floors)
work immediately; the Dune panels populate after the first `refresh` run (a few
minutes — `docker compose logs -f refresh`).

## Day-to-day

| Task | Command |
|------|---------|
| View logs | `docker compose logs -f web` (or `refresh` / `caddy`) |
| Restart | `docker compose restart web` |
| Deploy new code (dedicated) | `git pull && docker compose --profile caddy up -d --build` |
| Deploy new code (shared VPS) | `git pull && docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --build` |
| Force a data refresh now | `docker compose exec refresh node scripts/update.mjs` |
| Stop everything | `docker compose down` (keep `-v` OFF to preserve certs + data) |

## Notes

- **Persistent volumes**: `caddy-data` (TLS certs — don't delete or you'll re-issue),
  `dashboard-data` (DuckDB warehouse), `dashboard-public` (the served JSON). `docker
  compose down -v` wipes these.
- **Dune cost**: `refresh` runs `ingest-dune --run` hourly (executes the queries =
  credits). To cut cost, increase the `sleep` in `docker-compose.yml`, or schedule the
  queries on Dune and change the command to `node scripts/ingest-dune.mjs` (no `--run`,
  uses cached results, free).
- **`.env` is never baked into the image** (it's in `.dockerignore`); compose injects it
  at runtime via `env_file`.
- **arm64 VPS**: the image uses `node:20-slim`; `@duckdb/node-api` ships arm64 prebuilts,
  so it works on ARM hosts too.
