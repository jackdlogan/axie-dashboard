# Dune — Axie collectible collection spell

A `token_id → collectible collection` mapping for Ronin Axies, used to attribute
`nft.trades` sales to a collection (Mystic, Origin, Nightmare, …). Collection
membership comes from Axie genes/parts, which aren't decoded on-chain, so this is
a **seed-backed** reference table rather than a SQL derivation.

## Files

- `seeds/axie_collectible_collections_seed.csv` — the data (generated, git-ignored
  until you run the generator). Columns: `token_id,collection`.
- `seeds/axie_collectible_collections_seed.yml` — seed config (column types).
- `models/axie_collectible_collections.sql` — the spell: exposes the seed as
  `axie.collectible_collections`.
- `models/axie_collectible_collections.yml` — description + `unique` /
  `accepted_values` tests.

## 1. Generate the seed

```bash
node scripts/export-collection-map.mjs    # needs SKYMAVIS_API_KEY in .env
```

Enumerates every collectible token from the Sky Mavis `axies` search (cap-aware
partitioning by class/breedCount), resolves overlaps by priority, and writes
`seeds/axie_collectible_collections_seed.csv`. Takes a few minutes.

## 2. Publish the mapping to Dune

**Option A — Spellbook PR (shared table `axie.collectible_collections`).**
Copy `models/` and `seeds/` into a checkout of `duneanalytics/spellbook`, then
`dbt seed && dbt run --select axie_collectible_collections && dbt test`.

**Option B — Quick (no PR).** Upload the CSV via Dune → *Create → Upload data*
as `dune.<you>.axie_collectible_collections`, and reference that name below.

## 3. The price query

Save this as a Dune query and put its ID in `.env` as
`DUNE_QUERY_COLLECTIBLE_PRICES`. It must return
`day, collection, sales, median_usd, median_weth`.

`median_weth` is the **ETH-equivalent** median: each sale's USD price divided by
the ETH/USD rate at its trade minute, so the series isn't distorted when ETH
itself moves against the dollar. Dividing `price_usd` by the ETH rate (rather
than only taking WETH-settled trades) keeps the multi-currency sales (USDC, WRON,
AXS) in the median too.

> Source note: Axie sales settle through the Mavis Marketplace `OrderMatched`
> event, which Dune's `nft.trades` spell does **not** fully index (only ~962 of
> ~352k/90d show up). So we decode the raw event from `ronin.logs` — the same
> source as the daily-metrics query — and pull `token_id` from the order data
> (the asset `id` word at byte offset 801, right after the NFT address at 781).
> Reference your uploaded mapping as `dune.<your_username>.axie_collectible_collections`
> (or `axie.collectible_collections` once the Spellbook PR merges).

```sql
SELECT
    "day",
    collection,
    count(*)                          AS sales,
    approx_percentile(price_usd, 0.5) AS median_usd,
    approx_percentile(price_eth, 0.5) AS median_weth
FROM (
    SELECT
      date_trunc('day', l.block_time) AS "day",
      bytearray_to_uint256(bytearray_substring(l.data, 801, 32)) AS token_id,
      (bytearray_to_uint256(bytearray_substring(l.data, 65, 32))
         / power(10, COALESCE(p.decimals, 18))) * p.price AS price_usd,
      -- ETH-equivalent: USD price ÷ ETH/USD at the same minute (eth.price).
      ((bytearray_to_uint256(bytearray_substring(l.data, 65, 32))
         / power(10, COALESCE(p.decimals, 18))) * p.price) / eth.price AS price_eth
    FROM ronin.logs l
    LEFT JOIN prices.usd p
      ON p.blockchain = 'ronin'
     AND p.contract_address = bytearray_substring(l.topic2, 13, 20)
     AND p.minute = date_trunc('minute', l.block_time)
    LEFT JOIN prices.usd eth
      ON eth.blockchain = 'ronin'
     AND eth.contract_address = 0xc99a6a985ed2cac1ef41640596c5a5f9f4e19ef5  -- WETH (Ronin)
     AND eth.minute = date_trunc('minute', l.block_time)
    WHERE l.contract_address = 0x3B3aDf1422f84254B7fbb0e7cA62Bd0865133fe3
      AND l.topic0 = 0x109cee1a21fd2e7fba88adb0c288672b657beb8b4f5e36ea950cbebf8a901b6d
      AND bytearray_substring(l.data, 781, 20) = 0x32950db2a7164ae833121501c797d79e7b79d74c
      AND l.block_time >= CURRENT_DATE - INTERVAL '180' day
  ) t
JOIN dune.<your_username>.axie_collectible_collections c
  ON cast(t.token_id AS varchar) = cast(c.token_id AS varchar)
GROUP BY 1, 2
ORDER BY 1, 2
```

Then: `node scripts/ingest-dune.mjs --run` → the dashboard's *Collectible Price
History* panel fills in.

## 4. The holders-over-time query

Save this as a separate Dune query and put its ID in `.env` as
`DUNE_QUERY_COLLECTIBLE_HOLDERS`. It must return `day, collection, holders`.

A *holder* of a collection on day D is a distinct address owning ≥1 token of that
collection as of D. We reconstruct this from **ERC-721 `Transfer` events** —
unlike *sales*, every ownership change emits a standard `Transfer` log that Dune's
`nft.transfers` spell indexes in full, so the native Market Gateway problem (the
reason sales need the raw `ronin.logs` decode) does **not** apply here.

Technique: collapse each address's history into **transition events** (+1 the day
its balance for a collection goes 0 → positive, −1 the day it returns to 0), then a
running sum per collection over days gives the exact distinct-holder count — no
address×day cross join. Holders is a *stock*, so the ingest forward-fills the count
across quiet days when exporting the JSON.

> Reference your uploaded mapping as `dune.<your_username>.axie_collectible_collections`
> (or `axie.collectible_collections` once the Spellbook PR merges). If `nft.transfers`
> ever looks incomplete for Ronin Axies, the fallback is to decode the standard
> `Transfer(address,address,uint256)` topic
> (`0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef`) straight
> from `ronin.logs` on the Axie contract — `from`/`to` in `topic1`/`topic2`,
> `token_id` in `topic3`.

```sql
WITH seed AS (
    SELECT cast(token_id AS varchar) AS token_id, collection
    FROM dune.<your_username>.axie_collectible_collections
),
moves AS (
    SELECT date_trunc('day', t.block_time) AS d, s.collection, t."to" AS addr, 1 AS delta
    FROM nft.transfers t
    JOIN seed s ON cast(t.token_id AS varchar) = s.token_id
    WHERE t.blockchain = 'ronin'
      AND t.contract_address = 0x32950db2a7164ae833121501c797d79e7b79d74c
    UNION ALL
    SELECT date_trunc('day', t.block_time) AS d, s.collection, t."from" AS addr, -1 AS delta
    FROM nft.transfers t
    JOIN seed s ON cast(t.token_id AS varchar) = s.token_id
    WHERE t.blockchain = 'ronin'
      AND t.contract_address = 0x32950db2a7164ae833121501c797d79e7b79d74c
),
daily_delta AS (   -- net change per (collection, address, day); drop the zero-address mint/burn sink
    SELECT collection, addr, d, sum(delta) AS delta
    FROM moves
    WHERE addr <> 0x0000000000000000000000000000000000000000
    GROUP BY 1, 2, 3
),
running AS (        -- cumulative balance per (collection, address) over the days it transacted
    SELECT collection, addr, d,
           sum(delta) OVER (PARTITION BY collection, addr ORDER BY d) AS bal
    FROM daily_delta
),
state AS (
    SELECT collection, addr, d, bal,
           lag(bal) OVER (PARTITION BY collection, addr ORDER BY d) AS prev_bal
    FROM running
),
holder_delta AS (  -- +1 when an address becomes a holder, -1 when it exits
    SELECT collection, d, sum(CASE
        WHEN bal  > 0 AND coalesce(prev_bal, 0) <= 0 THEN  1
        WHEN bal <= 0 AND coalesce(prev_bal, 0)  > 0 THEN -1
        ELSE 0 END) AS hd
    FROM state
    GROUP BY 1, 2
)
SELECT
    d AS "day",
    collection,
    sum(hd) OVER (PARTITION BY collection ORDER BY d) AS holders
FROM holder_delta
ORDER BY 1, 2
```

Then: `node scripts/ingest-dune.mjs --run` → the dashboard's *Holders Over Time*
panel fills in. (`day` is reserved in DuneSQL — keep it quoted/aliased.)
