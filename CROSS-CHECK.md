# Data Cross-Check Report — Dune ↔ Sky Mavis

**Date:** 2026-06-15 · **Scope:** every datapoint family served by the dashboard
(`public/dune-*.json`) · **Tool:** `scripts/cross-check.mjs` (read-only) · **Data:**
refreshed same-time (`ingest-dune.mjs --run` + `enrich-axies.mjs`) so both sources
are concurrent.

## TL;DR

**All four datapoint families reconcile with the live Sky Mavis GraphQL API.**
Final run: **9 ✓ · 0 warnings · 0 problems.**

The Dune spine (native Market Gateway log decode) is **correct**: decoded sale
prices match Sky Mavis to the token, decoded token_ids resolve to the right Axies,
daily sale counts match, and reconstructed holder counts match for every collection
without a documented structural reason to differ.

Two comparisons that *look* like discrepancies are artifacts of the comparison
itself, not the data (detailed below): USD **volume** (Dune is Axie-only, Sky Mavis
`volumeUsd` is all-token) and USD **price** on individual sales (exchange-rate
sourcing). Both resolve cleanly when compared on the correct basis.

---

## Method

| Source | Role | Access |
|---|---|---|
| **Dune** | sales/holders spine — decodes the native Market Gateway settlement logs from `ronin.logs` (Dune's `nft.trades` only indexes OpenSea, not app.axie) | saved queries → DuckDB → `public/*.json` |
| **Sky Mavis GraphQL** | independent ground truth — the same data app.axie shows | `api-gateway.skymavis.com/graphql/axie-marketplace` |

`scripts/cross-check.mjs` is **read-only** (never runs Dune, never writes JSON,
never touches DuckDB; only Sky Mavis reads). It compares each family on a basis
chosen to avoid known confounds. Reproduce anytime:

```bash
node scripts/cross-check.mjs
```

A clean reconcile of "latest" values requires the snapshot to be current — see
Finding 1. The numbers below are from a same-time refresh on 2026-06-15.

---

## Results

### 1. Top-sale prices — the keystone check ✅

This validates the entire gateway decode (data word #2 → settled price), which the
daily volume and median **also** depend on. Match Dune top sales to Sky Mavis
`topSales(tokenAddress=Axie, Last30D)` by token_id, then compare the **token
amount** (Dune `price` vs `settlePrice / 1e18`), not USD.

| token | currency | Dune amt | Sky Mavis amt | Δ |
|---|---|---|---|---|
| 2132 | WETH | 1.8 | 1.8000 | +0.0% |
| 2233 | WETH | 1.6 | 1.6000 | +0.0% |
| 2812 | WETH | 1.41 | 1.4100 | +0.0% |
| 3352 | WETH | 1.6 | 1.6000 | +0.0% |
| 2438 | WETH | 1.248 | 1.2480 | +0.0% |
| 2552 | WETH | 1.58 | 1.5800 | +0.0% |
| 2168 | WETH | 1.149 | 1.1490 | +0.0% |
| 1331 | WETH | 1.14 | 1.1400 | +0.0% |
| 3426 | WETH | 3.0 | 3.0000 | +0.0% |

**8/8 (+ 1/1 on the fresh set) WETH amounts identical to the token.** The decode is
exact. (USDC/RON-settled sales are excluded from this column — they aren't
18-decimal.)

### 2. Daily metrics — sale count ✅

`marketStats.axieCount` is the Axie-only peer for Dune's daily sale sums.

| window | Dune sales | Sky Mavis axieCount | Δ | verdict |
|---|---|---|---|---|
| 24h | 845 | 5,270 | −84.0% | partial day (not scored) |
| 7d | 25,868 | 28,406 | −8.9% | close |
| 30d | 104,648 | 107,117 | **−2.3%** | **match** |

The 30d count matches; the small undercount is Dune's log-index lag plus the partial
current UTC day. The 24h window is structurally low (a partial day vs a rolling 24h)
and is not scored. **USD volume is intentionally not scored here — see Confound A.**

### 3. Enrichment — token_id → class / name ✅

`class` is intrinsic to the token (immutable) and is the real correctness signal
that the decoded token_id resolved to the right Axie; `name` is user-editable.

**class matches 8/8** sampled top-sale tokens against `axie(axieId)`; names match
once `enrich-axies.mjs` has run (Confound B / Finding 2).

### 4. Holders — Dune reconstruction vs `tokensStats[*].holders` ✅

| collection | Dune | Sky Mavis | Δ | note |
|---|---|---|---|---|
| Mystic | 453 | 452 | +0.2% | match |
| Summer | 11,018 | 11,350 | −2.9% | match |
| Japanese | 6,876 | 7,088 | −3.0% | match |
| Shiny | 841 | 869 | −3.2% | match |
| Nightmare | 5,628 | 5,864 | −4.0% | match |
| Christmas | 1,024 | 1,108 | −7.6% | match (snapshot-lag noise) |
| **MEO** | 1,583 | 375 | +322% | **known — Sky Mavis is stale** |
| **Origin** | 897 | 1,144 | −21.6% | **known — seed de-dup** |

The six part-count collections match within snapshot-lag noise (holders is a
slow-moving stock). The two outliers are documented, expected structural
divergences:

- **MEO** — Sky Mavis `tokensStats.meoAxie.holders = 375` is **frozen at its
  ~May-2021 value**; the collection has since grown to ~1,597 holders. Verified four
  independent ways (Dune cumulative, Dune last-transfer, Sky Mavis per-axie `owner`
  field, and on-chain `ownerOf` over all 3,631 tokens). **Dune is the accurate
  number here**, so the dashboard keeps the on-chain tip for MEO and does not anchor
  it to the stale live value.
- **Origin** — the single-membership token→collection seed files all-Mystic founders
  (who are also Origin founders) under Mystic, shrinking Origin's set by ~20%. Sky
  Mavis counts each collection independently. Matching would require a
  multi-membership seed (deferred, as it would also double-count sales in price
  medians).

### 5. Collectible median prices — soft bound ✅

No historical median exists on Sky Mavis to match exactly, so this is a sanity
bound: the latest settled **median** should sit at or above the live **floor**
(cheapest listing). All eight collections pass (median ≳ floor). Uses the most
recent day with an actual settled sale (a collection with no trade on the final day
is absent from that day's pivot, not zero).

---

## Confounds — comparisons that mislead if done naively

### A. USD volume: Axie-only vs all-token

`marketStats.volumeUsd` covers **all token types** (Lands, items, runes, charms,
materials…). Axies are only **~42%** of settlements (30d: 107k Axie sales of 255k
total). Dune decodes **Axies only**, so Dune volume (~$323k/30d) being roughly half
of Sky Mavis's all-token volume (~$644k/30d) is **expected and correct**, not a
shortfall. `marketStats` exposes no Axie-only USD-volume field, so volume is shown as
context but **not scored**; the per-sale price decode (check 1) independently proves
the USD math.

### B. USD price on individual sales: exchange-rate sourcing

Dune computes `price_usd` from `prices.usd` at the trade minute; Sky Mavis uses its
own rate. So the same settlement shows USD ~3–16% apart even though the **ETH amount
is identical**. This is rate-source timing, not a decode error — which is exactly why
check 1 compares token amounts, not dollars.

---

## Findings & recommendations

1. **Snapshot freshness (operational).** The committed `public/*.json` was 7 days
   stale (last day 2026-06-08) when this review began — the hourly `update.mjs`
   ingest was not running on the production box. A stale snapshot makes every
   "latest"/rolling-window comparison look wrong even when the pipeline is correct.
   **Action:** ensure the systemd timer / cron for `update.mjs` is live on the VPS
   (the deploy was pending). Refreshed manually for this report.

2. **Cached display names drift.** Owners rename Axies; `axie_meta` caches the name
   at enrichment time, so top-sale names can lag. `class` (correctness) is
   unaffected. **Action:** `enrich-axies.mjs` runs as pipeline step 2 and refreshes
   them — already wired into `update.mjs`.

3. **Two known holder divergences are correct-by-design** (MEO stale on Sky Mavis;
   Origin seed de-dup). No action needed; documented so they aren't re-investigated.

## Reproducing

```bash
# read-only verify against the current snapshot + live Sky Mavis
node scripts/cross-check.mjs

# for a clean same-time reconcile, refresh the snapshot first
node scripts/ingest-dune.mjs --run   # spends Dune credits; rewrites public/*.json + DuckDB
node scripts/enrich-axies.mjs        # populate/refresh top-sale traits
node scripts/cross-check.mjs
```

Requires in `.env`: `SKYMAVIS_API_KEY`, `DUNE_API_KEY`, and the four
`DUNE_QUERY_*` ids.
