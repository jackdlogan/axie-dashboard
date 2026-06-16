# Data Accuracy Verification Report

**Date:** 2026-06-15 · **Against:** live data (current snapshot, live Sky Mavis, on-chain Ronin)
**Tools:** `scripts/cross-check.mjs` (read-only) + `scripts/verify-onchain.mjs` (independent on-chain)
**Result:** cross-check **10 ✓ · 0 warnings · 0 problems** · on-chain re-derivation **exact (0.0%)** on both tested days

---

## TL;DR

The sales/price/count **spine is verified to the settlement** by an independent
on-chain re-derivation that reads Ronin directly and matches Dune exactly. Holders
now reconcile within ±2.6% live (materially tighter than the earlier report). The
only unverifiable piece is historical median *levels* (no ground-truth source
exists for them), and the only "divergence" observed is Sky Mavis's own activity
feed lagging — not Dune.

This run is clean partly *because the snapshot is current* (0 days stale). Accuracy
on the live dashboard stays this good only while the hourly `update.mjs` ingest is
actually running on the VPS.

---

## 1. Cross-check vs live Sky Mavis (`cross-check.mjs`)

Snapshot freshness: **current (0d stale)** — `generatedAt 2026-06-15T09:03Z`.

### Daily metrics (count is the scored peer; USD volume is all-token, not scored)

| window | Dune sales | SM axieCount | Δ | verdict |
|---|---|---|---|---|
| 24h | 1,559 | 5,256 | −70.3% | partial day (not scored) |
| 7d | 26,582 | 28,364 | −6.3% | close |
| 30d | 105,362 | 107,176 | **−1.7%** | **match** |

### Top-sale decode (ETH amount, not USD — removes rate confound)

| token | currency | Dune amt | SM amt | Δ | decode |
|---|---|---|---|---|---|
| 3426 | WETH | 3 | 3.0000 | +0.0% | match |

Only one live top-20 overlap this run (the live set rotates), but it's exact. USD
differs −3.6% = exchange-rate sourcing, expected.

### Enrichment — token_id → class (correctness) / name (freshness)

**class 8/8 ✓ · name 8/8 ✓** on the sampled top-sale tokens. The decoded token_ids
resolve to the right Axies.

### Holders — Dune reconstruction vs `tokensStats[*].holders`

| collection | Dune | Sky Mavis | Δ | verdict |
|---|---|---|---|---|
| Mystic | 453 | 452 | +0.2% | match |
| Summer | 11,243 | 11,350 | −0.9% | match |
| Japanese | 7,052 | 7,088 | −0.5% | match |
| Shiny | 860 | 869 | −1.0% | match |
| Nightmare | 5,712 | 5,864 | −2.6% | match |
| Christmas | 1,097 | 1,108 | −1.0% | match |
| Origin | 1,132 | 1,144 | −1.0% | match |
| **MEO** | 1,583 | 375 | +322% | **known — Sky Mavis frozen ~2021; Dune is correct** |

All scored collections within ±2.6% (the earlier report had gaps up to ±7.6%).
Origin is now scored normally (−1.0%) after the multi-membership seed fix.

### Collectible median prices (soft bound: median ≳ floor)

All 8 collections pass. Median (settled) vs floor (cheapest live listing) are
different measures — this is a sanity bound, not an exact reconcile. No historical
median exists on Sky Mavis to match against.

---

## 2. Independent on-chain re-derivation (`verify-onchain.mjs`)

**Part A** reads Ronin directly (`eth_getLogs` over the Market Gateway, decoded
independently of *both* Dune and Sky Mavis). This is true ground truth.

| day | on-chain sales | Dune | Δ | on-chain vol* | Dune vol | Δ |
|---|---|---|---|---|---|---|
| 2026-06-13 | 3,448 | 3,448 | **+0.0%** | $13,786 | $13,507 | +2.1% |
| 2026-06-14 | 8,159 | 8,159 | **+0.0%** | $20,846 | $20,301 | +2.7% |

\* Volume re-derived at *current* rates, so the small + delta is rate timing, not
a decode error. Counts are settlement-for-settlement **identical**.

Payment mix confirms the decode handles all tokens (06-14: WETH 4,332 · USDC 3,318
· AXS 290 · WRON 207 · SLP 12).

**Part B** (Sky Mavis raw `tokenActivities` feed) showed **−14.9% on 06-14**
(SM 6,941 vs Dune 8,159). Since Part A on-chain confirms 8,159 exactly, this is
**Sky Mavis's feed under-reporting** on a heavy-USDC day — not a Dune problem. Even
the API we treat as "ground truth" has completeness gaps; the chain is the arbiter,
and there Dune is dead-on.

---

## 3. Confidence by datapoint family

| family | confidence | basis |
|---|---|---|
| Daily sale count | **~97%** | on-chain re-derivation exact (0.0%) on two full days |
| Sale-price decode | **~96%** | ETH amounts match to the token; full-day volume re-derivation within rate noise |
| Token resolution (class) | ~90% | class 8/8, but small sample |
| Holders | **~85%** | all within ±2.6% live; Origin fixed; MEO correct-by-design |
| Median price *levels* | ~65% | pass soft bound, but no historical ground truth exists to reconcile |

---

## 4. The one caveat that matters

This verification is clean *because the snapshot is fresh right now*. The accuracy
guarantee is conditional on the hourly `update.mjs` running on the VPS — the
pending-deploy risk noted previously. Confirm the systemd timer / cron is live so
the live dashboard stays as accurate as this report.

## Reproducing

```bash
node scripts/cross-check.mjs        # read-only; live Sky Mavis only
node scripts/verify-onchain.mjs     # independent on-chain + SM historical
```
