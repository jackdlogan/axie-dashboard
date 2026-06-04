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
`DUNE_QUERY_COLLECTIBLE_PRICES`. It must return `day, collection, sales, median_usd`.

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
    approx_percentile(price_usd, 0.5) AS median_usd
FROM (
    SELECT
      date_trunc('day', l.block_time) AS "day",
      bytearray_to_uint256(bytearray_substring(l.data, 801, 32)) AS token_id,
      (bytearray_to_uint256(bytearray_substring(l.data, 65, 32))
         / power(10, COALESCE(p.decimals, 18))) * p.price AS price_usd
    FROM ronin.logs l
    LEFT JOIN prices.usd p
      ON p.blockchain = 'ronin'
     AND p.contract_address = bytearray_substring(l.topic2, 13, 20)
     AND p.minute = date_trunc('minute', l.block_time)
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
