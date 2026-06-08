-- DuckDB schema for the Axie analytics warehouse (local, research-grade).
-- Idempotent: safe to run on every startup. The raw `sales` table is the
-- source of truth — every aggregate/view is derived from it, so we can
-- re-compute medians, percentiles, per-class, concentration, etc. without
-- re-fetching from the API.

-- One row per settled Axie sale.
CREATE TABLE IF NOT EXISTS sales (
  id            BIGINT PRIMARY KEY,  -- marketplace activity id (dedupe key)
  ts            BIGINT  NOT NULL,    -- unix seconds (createdAt)
  day           DATE    NOT NULL,    -- UTC day bucket
  axie_id       BIGINT,
  class         VARCHAR,
  price_wei     VARCHAR,             -- raw settlePrice in wei (string, no precision loss)
  price_token   DOUBLE,              -- price in token units (price_wei / 1e18)
  payment_token VARCHAR,             -- WETH | RON | USDC | ... (best-effort)
  order_kind    INTEGER,
  tx_hash       VARCHAR
);
CREATE INDEX IF NOT EXISTS idx_sales_ts  ON sales(ts);
CREATE INDEX IF NOT EXISTS idx_sales_day ON sales(day);

-- Daily fiat reference rates, used to value token volume in USD using the
-- rate that was true on each day (not a single current rate).
CREATE TABLE IF NOT EXISTS prices (
  day   DATE    NOT NULL,
  token VARCHAR NOT NULL,            -- 'eth' | 'ron'
  usd   DOUBLE  NOT NULL,
  PRIMARY KEY (day, token)
);

-- Hourly collection-level snapshots from tokensStats (floor / holders series).
CREATE TABLE IF NOT EXISTS holder_snapshots (
  ts           BIGINT  NOT NULL,
  collection   VARCHAR NOT NULL,
  holders      BIGINT,
  floor_eth    DOUBLE,
  vol24h_eth   DOUBLE,
  total_supply BIGINT,
  PRIMARY KEY (ts, collection)
);

-- Small key/value store for ingestion checkpoints (resume support).
CREATE TABLE IF NOT EXISTS ingest_state (
  key   VARCHAR PRIMARY KEY,
  value VARCHAR
);

-- Daily app.axie sale metrics sourced from Dune (gateway decode + prices.usd).
CREATE TABLE IF NOT EXISTS dune_daily (
  day           DATE PRIMARY KEY,
  axie_sales    BIGINT,
  unique_buyers BIGINT,
  volume_usd    DOUBLE,
  median_usd    DOUBLE,
  p25_usd       DOUBLE,
  p75_usd       DOUBLE,
  p95_usd       DOUBLE
);

-- Axie trait metadata from Sky Mavis, keyed by token_id (bounded enrichment).
CREATE TABLE IF NOT EXISTS axie_meta (
  token_id    VARCHAR PRIMARY KEY,
  name        VARCHAR,
  axie_class  VARCHAR,
  image       VARCHAR,
  breed_count INTEGER,
  collectible VARCHAR,             -- special collection label (Mystic/Origin/…) or '' if regular
  fetched_at  VARCHAR
);
-- Migrate older warehouses that predate the collectible column.
ALTER TABLE axie_meta ADD COLUMN IF NOT EXISTS collectible VARCHAR;

-- Daily median settle price per collectible collection, from Dune.
-- Long format: one row per (day, collection). Powers the price-over-time chart.
-- median_weth is the ETH-equivalent median (price_usd ÷ ETH/USD at the trade
-- minute), so the series isn't distorted by the ETH/USD rate moving.
CREATE TABLE IF NOT EXISTS dune_collectible_daily (
  day         DATE    NOT NULL,
  collection  VARCHAR NOT NULL,  -- Origin | Mystic | Shiny | Japanese | Summer | Nightmare | Christmas | MEO
  sales       BIGINT,
  median_usd  DOUBLE,
  median_weth DOUBLE,
  PRIMARY KEY (day, collection)
);
-- Migrate older warehouses that predate the WETH-denominated median.
ALTER TABLE dune_collectible_daily ADD COLUMN IF NOT EXISTS median_weth DOUBLE;

-- Daily distinct-holder count per collectible collection, from Dune.
-- Long format: one row per (day, collection). Reconstructed from ERC-721
-- Transfer events joined to the token→collection seed — a holder on day D is a
-- distinct address owning >=1 token of that collection as of D. Unlike the price
-- series (a per-day flow), holders is a *stock* that carries across quiet days;
-- the ingest forward-fills gaps when exporting. Powers the holders-over-time chart.
CREATE TABLE IF NOT EXISTS dune_collectible_holders_daily (
  day        DATE    NOT NULL,
  collection VARCHAR NOT NULL,  -- Origin | Mystic | Shiny | Japanese | Summer | Nightmare | Christmas | MEO
  holders    BIGINT,
  PRIMARY KEY (day, collection)
);

-- Recent top sales from Dune (also drives trait enrichment by token_id).
CREATE TABLE IF NOT EXISTS dune_top_sales (
  tx_hash    VARCHAR,
  token_id   VARCHAR,
  block_time VARCHAR,
  buyer      VARCHAR,
  currency   VARCHAR,
  price      DOUBLE,
  price_usd  DOUBLE,
  PRIMARY KEY (tx_hash, token_id)
);
