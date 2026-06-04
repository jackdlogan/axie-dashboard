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
  fetched_at  VARCHAR
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
