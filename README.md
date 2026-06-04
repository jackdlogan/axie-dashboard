# Axie Marketplace Activity Dashboard

A read-only dashboard summarizing **purchase and sale activity** across the Axie
Infinity marketplace (app.axieinfinity.com), built on the Sky Mavis GraphQL API.

## What it shows

- **KPI cards** — sales volume (24h / 7d / 30d), all-time volume & transactions,
  new Axies minted, and Axies ascended in the last 7 days.
- **Sales Volume by Period** — USD volume across the 24h / 7d / 30d windows.
- **Number of Sales by Period** — sale counts across the same windows.
- **Market Momentum** — week-over-week and month-over-month change in volume,
  sales, buyers, and average price, derived from the 90-day daily series.
- **90-Day Axie Sales History** — a daily trend chart (volume USD / price
  percentiles / average price / sales count / buyers) built from a local
  backfill, since the API only exposes ≤30-day aggregates. See "90-day history"
  below.
- **Top Buyers** — leaderboard of the biggest buyers across recent top sales,
  with total spend, number of buys, and favorite class.
- **Collection Analytics** — per-collection floor price (ETH + USD), unique
  holders, 24h volume (ETH + USD) and supply for all 16 collections, sortable.
- **Top Axie Sales** — the highest sales for a selected period (24h / 7d / 30d),
  with image, class, ETH and USD price, and time since sale. Rows link to the
  Axie's marketplace page.
- **Exchange rates** — live ETH / RON / AXS / SLP / USDC prices in USD.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Add your Sky Mavis API key (get one at https://developers.skymavis.com):

   ```bash
   cp .env.example .env
   # then edit .env and set SKYMAVIS_API_KEY=...
   ```

3. Run the dev server:

   ```bash
   npm run dev
   ```

   Open http://localhost:5173.

## How the API key stays secret

The browser never sees the key. All GraphQL requests go to `/api/graphql`, and
the Vite dev server proxies them to the Sky Mavis endpoint, attaching the
`X-API-Key` header server-side (see `vite.config.js`). The key is read from
`.env`, which is git-ignored.

> Note: `npm run build` produces a static bundle that expects a proxy with the
> key header to exist. For production hosting you'd front it with a small server
> (or serverless function) that injects the header the same way the dev proxy
> does — don't embed the key in the client.

## 90-day history

The Sky Mavis API has **no aggregate longer than 30 days** (`PeriodType` stops at
`Last30D`). To analyze a 90-day window, this project backfills the raw Axie `Sale`
feed once and aggregates it into per-day buckets.

```bash
# Full 90-day backfill (~288k sales, ~5,760 requests, ~15-20 min).
# Writes public/history-90d.json, which the dashboard loads.
node scripts/backfill-history.mjs --full

# Incremental update (only sales since the last run — cheap). Run daily.
node scripts/backfill-history.mjs

# Custom window
node scripts/backfill-history.mjs --full --days 30
```

Notes:
- `tokenActivities` caps page size at **50** and pages sequentially via a
  `lastTimestamp` cursor, so the backfill is inherently sequential.
- Prices are `settlePrice` in **wei** (ETH/WETH); USD in the chart is approximate,
  converted at the ETH rate captured when the file was generated (not per-day
  historical rates).
- To keep it fresh automatically, schedule the incremental command daily (cron, or
  Claude Code's `/schedule`).

## Data source

Sky Mavis Axie Marketplace GraphQL API:
`https://api-gateway.skymavis.com/graphql/axie-marketplace`
Queries used: `overallMarketStats`, `marketStats`, `topSales`, `exchangeRate`.
