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

## Steps

```bash
# 1. Get the code onto the VPS
git clone <your-repo-url> axie-dashboard && cd axie-dashboard

# 2. Configure secrets + domain
cp .env.example .env
nano .env   # set SKYMAVIS_API_KEY, DUNE_API_KEY, DUNE_QUERY_*, DOMAIN, ACME_EMAIL

# 3. Build and start
docker compose up -d --build

# 4. Watch it come up (TLS issuance takes a few seconds on first run)
docker compose logs -f caddy
```

Then open `https://<your DOMAIN>`. Live panels (KPIs, collections, rates, floors)
work immediately; the Dune panels populate after the first `refresh` run (a few
minutes — `docker compose logs -f refresh`).

## Day-to-day

| Task | Command |
|------|---------|
| View logs | `docker compose logs -f web` (or `refresh` / `caddy`) |
| Restart | `docker compose restart web` |
| Deploy new code | `git pull && docker compose up -d --build` |
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
