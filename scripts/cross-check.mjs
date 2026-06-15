#!/usr/bin/env node
// Cross-checks the committed Dune snapshot (public/*.json — what the dashboard
// actually serves) against the live Sky Mavis GraphQL API, to verify each
// datapoint family is correct. READ-ONLY: it never runs Dune queries, never
// touches DuckDB, and never writes the public JSON. Safe to run anytime; the
// only cost is Sky Mavis read requests (well under the rate limit).
//
// Usage: node scripts/cross-check.mjs
//
// What it reconciles:
//   1. Daily metrics  — Dune daily sums vs marketStats rolling windows (axieCount, volumeUsd)
//   2. Top sales      — Dune gateway-decoded price_usd vs Sky Mavis topSales settlePriceUsd
//   3. Enrichment     — Dune top-sale token_id -> name/class vs axie(axieId)
//   4. Holders        — Dune latest holders/collection vs tokensStats[*].holders
//   5. Prices (soft)  — Dune latest median vs live floor (median should be >= floor)

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from './lib/api.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = resolve(ROOT, 'public')
const readJson = (f) => JSON.parse(readFileSync(resolve(PUBLIC, f), 'utf8'))

const gql = createClient()
const DAY = 86400_000
const now = new Date()

// ── pretty helpers ────────────────────────────────────────────────────────
const C = { gray: '\x1b[90m', red: '\x1b[31m', grn: '\x1b[32m', yel: '\x1b[33m', cyn: '\x1b[36m', bold: '\x1b[1m', rst: '\x1b[0m' }
const usd = (n) => (n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString())
const pct = (a, b) => (b ? ((a - b) / b) * 100 : null)
const fmtPct = (p) => (p == null ? '—' : (p >= 0 ? '+' : '') + p.toFixed(1) + '%')
// verdict tag by absolute % gap, with a per-check tolerance
const tag = (p, tol = 2) => {
  if (p == null) return `${C.gray}n/a${C.rst}`
  const a = Math.abs(p)
  if (a <= tol) return `${C.grn}MATCH${C.rst}`
  if (a <= tol * 4) return `${C.yel}CLOSE${C.rst}`
  return `${C.red}DIVERGES${C.rst}`
}
const h = (s) => console.log(`\n${C.bold}${C.cyn}${s}${C.rst}`)
const sub = (s) => console.log(`${C.gray}${s}${C.rst}`)

// settlePrice etc. can be scientific notation ("141e+16") — BigInt throws on those.
const weiToToken = (wei) => { try { return Number(BigInt(wei)) / 1e18 } catch { return Number(wei) / 1e18 } }

const findings = [] // { sev: 'ok'|'warn'|'bad', msg }
const record = (sev, msg) => findings.push({ sev, msg })

// ── 0. snapshot freshness ─────────────────────────────────────────────────
const daily = readJson('dune-daily.json')
const top = readJson('dune-top-sales.json')
const holders = readJson('dune-collectible-holders.json')
const prices = readJson('dune-collectible-prices.json')

const lastDay = daily.days.at(-1).day
const snapAgeDays = Math.floor((now - new Date(lastDay + 'T00:00:00Z')) / DAY)
h('0 · Snapshot freshness')
sub(`  dune-daily generatedAt : ${daily.generatedAt}`)
sub(`  last day in snapshot   : ${lastDay}  (${snapAgeDays}d ago, today ${now.toISOString().slice(0, 10)})`)
const STALE = snapAgeDays > 1
if (STALE) {
  console.log(`  ${C.yel}⚠  snapshot is ${snapAgeDays}d stale${C.rst} — rolling-window daily reconcile (check 1) is confounded and reported as informational only.`)
  record('warn', `Committed snapshot is ${snapAgeDays} days stale (last day ${lastDay}). Re-run the hourly ingest to refresh public/*.json before trusting "latest" values on the live dashboard.`)
} else {
  console.log(`  ${C.grn}✓ snapshot is current${C.rst}`)
}

// ── pull everything from Sky Mavis up front ───────────────────────────────
h('· Fetching live Sky Mavis data …')
const dash = (await gql(`{
  marketStats {
    last24Hours { count axieCount volume volumeUsd }
    last7Days   { count axieCount volume volumeUsd }
    last30Days  { count axieCount volume volumeUsd }
  }
  exchangeRate { eth { usd } }
  tokensStats {
    originAxie { holders totalSupply } mysticAxie { holders totalSupply }
    shinyAxie { holders totalSupply } japanAxie { holders totalSupply }
    summerAxie { holders totalSupply } nightmareAxie { holders totalSupply }
    xmasAxie { holders totalSupply } meoAxie { holders totalSupply }
  }
}`)).data
const AXIE_CONTRACT = '0x32950db2a7164ae833121501c797d79e7b79d74c'
const topSalesQ = `query($p: PeriodType!, $a: String){ topSales(tokenAddress:$a, periodType:$p, size:20){
  results { settlePrice settlePriceUsd settleQuantity timestamp asset { token { ... on Axie { id name class } } } } } }`
const smTop30 = (await gql(topSalesQ, { p: 'Last30D', a: AXIE_CONTRACT })).data.topSales.results
sub(`  marketStats, tokensStats, exchangeRate, topSales(Last30D ×${smTop30.length}) ✓`)

// ── 1. Daily metrics: Dune daily sums vs Sky Mavis rolling windows ─────────
h('1 · Daily metrics — Dune daily sums vs Sky Mavis marketStats')
// IMPORTANT: marketStats.axieCount is Axie-only (the right peer for Dune sales),
// but marketStats.volume/volumeUsd are ALL token types (Axies are only ~42% of
// settlements). So we reconcile COUNT against axieCount; USD volume has no
// Axie-only peer on marketStats, so it's shown as context (with the Axie share)
// — NOT scored. The current UTC day is partial + Dune's log index lags hours, so
// the 24h window structurally undercounts; verdict is taken on 7d & 30d only.
console.log(`  ${'window'.padEnd(8)} ${'dune sales'.padStart(11)} ${'SM axieCount'.padStart(12)} ${'Δ'.padStart(7)}  verdict   ${C.gray}| dune axie-vol$  SM all-tok-vol$ (axie%)${C.rst}`)
const sumLastDays = (n) => {
  const slice = daily.days.slice(-n)
  return {
    sales: slice.reduce((s, d) => s + Number(d.axie_sales || 0), 0),
    vol: slice.reduce((s, d) => s + Number(d.volume_usd || 0), 0),
  }
}
const windows = [['24h', 1, dash.marketStats.last24Hours, false], ['7d', 7, dash.marketStats.last7Days, true], ['30d', 30, dash.marketStats.last30Days, true]]
for (const [label, ndays, sm, scored] of windows) {
  const d = sumLastDays(ndays)
  const smSales = Number(sm.axieCount)
  const ps = pct(d.sales, smSales)
  const axiePct = (100 * Number(sm.axieCount) / Number(sm.count)).toFixed(0)
  const verdict = scored ? tag(ps, 6) : `${C.gray}partial-day${C.rst}`
  console.log(`  ${label.padEnd(8)} ${d.sales.toLocaleString().padStart(11)} ${smSales.toLocaleString().padStart(12)} ${fmtPct(ps).padStart(7)}  ${verdict.padEnd(9)}   ${C.gray}| ${usd(d.vol).padStart(11)} ${usd(sm.volumeUsd).padStart(13)} (${axiePct}%)${C.rst}`)
  if (label === '30d') {
    if (Math.abs(ps) > 6) record('bad', `30d sale-count reconcile off: Dune ${fmtPct(ps)} vs Sky Mavis axieCount — beyond index-lag tolerance.`)
    else record('ok', `30d sale count matches Sky Mavis axieCount (${fmtPct(ps)}; small undercount = Dune log-index lag + partial current day).`)
  }
}
sub('  note: USD volume is NOT scored — marketStats.volumeUsd is all-token (Axies ~42% of settlements); Dune is Axie-only, so ~half is expected, not a discrepancy.')
sub('  note: Sky Mavis windows are rolling-from-now; Dune sums are whole UTC days, so a few % count gap is expected even when fresh.')

// ── 2. Top sales: Dune decoded price_usd vs Sky Mavis settlePriceUsd ───────
h('2 · Top sales — Dune gateway-decoded USD vs Sky Mavis topSales (matched by token_id)')
// Index Sky Mavis Last30D top sales by token id (a token can recur; keep all).
const smByToken = new Map()
for (const r of smTop30) {
  const id = r.asset?.token?.id
  if (!id) continue
  if (!smByToken.has(id)) smByToken.set(id, [])
  smByToken.get(id).push(r)
}
// The decode-correctness test is the *token amount*, not USD. Dune computes
// price_usd from prices.usd at the trade minute; Sky Mavis uses its own rate, so
// USD always differs a few % even for the identical settlement. Comparing the raw
// token amount (Dune `price` vs settlePrice/1e18) removes that confound — for
// WETH sales both are ETH. (USDC/RON-settled sales aren't 18-decimal, so the ETH
// column is only meaningful where currency=WETH; USD is shown there as context.)
let matched = 0, ethOk = 0, ethComparable = 0
console.log(`  ${'token'.padStart(7)} ${'cur'.padStart(5)} ${'dune amt'.padStart(10)} ${'SM amt'.padStart(10)} ${'Δamt'.padStart(7)}   ${'dune$'.padStart(8)} ${'SM$'.padStart(8)} ${'Δ$'.padStart(7)}  decode`)
for (const s of top.sales) {
  const cands = smByToken.get(String(s.token_id))
  if (!cands) continue
  // pick the Sky Mavis sale closest in time to the Dune sale
  const dt = new Date(s.block_time.replace(' UTC', 'Z').replace(' ', 'T')).getTime()
  let best = cands[0], bestGap = Infinity
  for (const c of cands) {
    const g = Math.abs(Number(c.timestamp) * 1000 - dt)
    if (g < bestGap) { bestGap = g; best = c }
  }
  if (bestGap > 2 * DAY) continue // not the same settlement
  matched++
  const smUsd = Number(best.settlePriceUsd)
  const pUsd = pct(s.price_usd, smUsd)
  // ETH-amount comparison only where the Dune sale settled in WETH (18 decimals).
  const isEth = String(s.currency).toUpperCase() === 'WETH'
  const smAmt = weiToToken(best.settlePrice) // valid as ETH only for 18-dec tokens
  let pAmt = null, decode = `${C.gray}n/a${C.rst}`
  if (isEth) {
    ethComparable++
    pAmt = pct(Number(s.price), smAmt)
    if (Math.abs(pAmt) <= 1) ethOk++
    decode = tag(pAmt, 1)
  }
  console.log(`  ${String(s.token_id).padStart(7)} ${String(s.currency).padStart(5)} ${(s.price ?? '—').toString().padStart(10)} ${(isEth ? smAmt.toFixed(4) : '—').padStart(10)} ${fmtPct(pAmt).padStart(7)}   ${usd(s.price_usd).padStart(8)} ${usd(smUsd).padStart(8)} ${fmtPct(pUsd).padStart(7)}  ${decode}`)
}
if (matched === 0) {
  console.log(`  ${C.yel}no overlapping sales between the snapshot and live Last30D top-20${C.rst} (snapshot too old, or top set rotated).`)
  record('warn', 'Top-sales price check found no overlap with live Sky Mavis Last30D top-20 — likely the snapshot aged out of the window. Refresh and re-run for a clean price-decode verification.')
} else {
  console.log(`  ${C.bold}${matched} matched · ${ethOk}/${ethComparable} WETH amounts identical (≤1%) · USD differs by exchange-rate source (expected)${C.rst}`)
  if (ethComparable && ethOk === ethComparable) record('ok', `Gateway price-decode validated: all ${ethComparable} WETH top-sale amounts match Sky Mavis settlePrice to the token (≤1%); USD-only gaps are rate-source timing, not a decode error.`)
  else if (ethComparable) record('bad', `Gateway price-decode off on ${ethComparable - ethOk}/${ethComparable} WETH top sales (ETH amount differs >1%) — investigate the data-word offset / decimals.`)
  else record('warn', `No WETH-settled overlap to test the decode by token amount; USD gaps alone are inconclusive (rate-source noise).`)
}

// ── 3. Enrichment: token_id -> name/class vs axie(axieId) ──────────────────
// `class` is intrinsic to the token (immutable) — it's the real correctness
// signal that the token_id resolved to the right Axie. `name` is user-editable
// (renames) and comes from the cached axie_meta table, so drift there is a
// display-freshness issue, not a token_id/spine error. Report them separately.
h('3 · Enrichment — Dune top-sale token_id → Sky Mavis axie() (class = correctness, name = freshness)')
const sample = top.sales.slice(0, 8) // first 8 (highest USD)
let classOk = 0, nameOk = 0, enrichChecked = 0
for (const s of sample) {
  const a = (await gql(`query($id: ID!){ axie(axieId:$id){ id name class } }`, { id: String(s.token_id) })).data.axie
  if (!a) { console.log(`  ${String(s.token_id).padStart(8)} ${C.gray}not found on Sky Mavis${C.rst}`); continue }
  // Unenriched row (axie_meta not yet populated for fresh top sales) — class is
  // null/empty, which is "missing", not "wrong". Flag for the enrich step, don't
  // count as a resolution error.
  if (!s.cls) { console.log(`  ${String(s.token_id).padStart(8)} ${C.yel}not enriched yet${C.rst} → sm="${a.name}"/${a.class}  (run enrich-axies.mjs)`); continue }
  enrichChecked++
  const cOk = (s.cls || '') === (a.class || '')
  const nOk = (s.name || '') === (a.name || '')
  if (cOk) classOk++
  if (nOk) nameOk++
  const cMark = cOk ? `${C.grn}class✓${C.rst}` : `${C.red}class✗${C.rst}`
  const nMark = nOk ? `${C.grn}name✓${C.rst}` : `${C.yel}name~${C.rst}`
  console.log(`  ${String(s.token_id).padStart(8)} ${cMark} ${nMark}  dune="${s.name}"/${s.cls}  →  sm="${a.name}"/${a.class}`)
}
if (!enrichChecked) {
  record('warn', `Top sales not enriched yet: axie_meta has no metadata for the current top-sale token_ids — run enrich-axies.mjs (the 2nd pipeline step) to populate name/class/image.`)
} else {
  if (classOk === enrichChecked) record('ok', `Token resolution correct: class matches Sky Mavis on all ${classOk}/${enrichChecked} sampled top-sale tokens (token_id decode is right).`)
  else record('bad', `Token resolution error: class disagrees on ${enrichChecked - classOk}/${enrichChecked} sampled tokens — the decoded token_id may be wrong.`)
  if (nameOk < enrichChecked) record('warn', `Cached display names are stale: ${enrichChecked - nameOk}/${enrichChecked} sampled tokens have been renamed since enrichment (axie_meta cache lag) — re-run enrich-axies.mjs to refresh names.`)
}

// ── 4. Holders: Dune latest vs Sky Mavis tokensStats[*].holders ────────────
h('4 · Holders — Dune latest reconstruction vs live Sky Mavis tokensStats')
const LIVE_KEY = { Origin: 'originAxie', Mystic: 'mysticAxie', Shiny: 'shinyAxie', Japanese: 'japanAxie', Summer: 'summerAxie', Nightmare: 'nightmareAxie', Christmas: 'xmasAxie', MEO: 'meoAxie' }
const KNOWN = { // documented structural divergences (see memory axie-collectible-holders)
  MEO: 'Sky Mavis tokensStats.holders is STALE (frozen ~May 2021 at ~375); on-chain truth ≈ Dune. EXPECTED divergence.',
  Origin: 'single-membership seed files all-Mystic founders under Mystic, shrinking Origin. EXPECTED ~−20%.',
}
const latestH = holders.days.at(-1)
console.log(`  ${'collection'.padEnd(11)} ${'dune'.padStart(7)} ${'SkyMavis'.padStart(8)} ${'Δ'.padStart(7)}  verdict`)
for (const c of holders.collections) {
  const d = Number(latestH[c])
  const sm = Number(dash.tokensStats[LIVE_KEY[c]]?.holders)
  const p = pct(d, sm)
  const known = KNOWN[c]
  // Holders is a slow-moving stock; with the snapshot ~7d behind live, a single-
  // digit % gap is staleness, not error. Only flag a gap too large to be drift.
  const verdict = known ? `${C.yel}KNOWN${C.rst}` : tag(p, 8)
  console.log(`  ${c.padEnd(11)} ${(d || '—').toLocaleString().padStart(7)} ${(sm || '—').toLocaleString().padStart(8)} ${fmtPct(p).padStart(7)}  ${verdict}${known ? '  ' + C.gray + '(' + c + ')' + C.rst : ''}`)
  if (!known) {
    if (Math.abs(p) > 12) record('bad', `Holders mismatch for ${c}: Dune ${d} vs Sky Mavis ${sm} (${fmtPct(p)}) — too large for snapshot lag; investigate.`)
    else record('ok', `Holders for ${c} reconcile with Sky Mavis (${fmtPct(p)}, within snapshot-lag noise).`)
  }
}
for (const [c, why] of Object.entries(KNOWN)) sub(`  • ${c}: ${why}`)

// ── 5. Prices (soft): Dune latest median vs live floor ─────────────────────
h('5 · Collectible prices (soft bound) — Dune latest median vs live floor (median ≥ floor expected)')
// Live order-book floor (cheapest active WETH-priced Sale listing) per collection.
// Mirrors src/api.js fetchCollectibleFloors: six via num* criteria, Origin+MEO via title.
const WETH_RONIN = '0xc99a6a985ed2cac1ef41640596c5a5f9f4e19ef5'
const ALL_SIX = '[1, 2, 3, 4, 5, 6]'
const floorQ = `query {
  mystic:    axies(auctionType: Sale, criteria: { numMystic: ${ALL_SIX} },    sort: PriceAsc, size: 1) { results { order { currentPrice paymentToken } } }
  nightmare: axies(auctionType: Sale, criteria: { numNightmare: ${ALL_SIX} }, sort: PriceAsc, size: 1) { results { order { currentPrice paymentToken } } }
  japan:     axies(auctionType: Sale, criteria: { numJapan: ${ALL_SIX} },     sort: PriceAsc, size: 1) { results { order { currentPrice paymentToken } } }
  xmas:      axies(auctionType: Sale, criteria: { numXmas: ${ALL_SIX} },      sort: PriceAsc, size: 1) { results { order { currentPrice paymentToken } } }
  summer:    axies(auctionType: Sale, criteria: { numSummer: ${ALL_SIX} },    sort: PriceAsc, size: 1) { results { order { currentPrice paymentToken } } }
  shiny:     axies(auctionType: Sale, criteria: { numShiny: ${ALL_SIX} },     sort: PriceAsc, size: 1) { results { order { currentPrice paymentToken } } }
  origin:    axies(auctionType: Sale, criteria: { title: ["Origin"] },                  sort: PriceAsc, size: 1) { results { order { currentPrice paymentToken } } }
  meo:       axies(auctionType: Sale, criteria: { title: ["MEO Corp", "MEO Corp II"] }, sort: PriceAsc, size: 1) { results { order { currentPrice paymentToken } } }
}`
let floors = {}
try {
  const fd = (await gql(floorQ)).data
  for (const k of ['mystic', 'nightmare', 'japan', 'xmas', 'summer', 'shiny', 'origin', 'meo']) {
    const order = fd?.[k]?.results?.[0]?.order
    floors[k] = order && order.paymentToken?.toLowerCase() === WETH_RONIN ? weiToToken(order.currentPrice) : null
  }
} catch (e) { sub('  (floor fetch failed: ' + e.message + ')') }
const FLOOR_KEY = { Mystic: 'mystic', Nightmare: 'nightmare', Japanese: 'japan', Christmas: 'xmas', Summer: 'summer', Shiny: 'shiny', Origin: 'origin', MEO: 'meo' }
const ethUsd = Number(dash.exchangeRate.eth.usd)
// A collection with no settled sale on the final day is simply absent from that
// day's pivot row (not zero). Use the most recent day that actually has a median.
const lastMedian = (c) => {
  for (let i = prices.days.length - 1; i >= 0; i--) {
    const v = prices.days[i][c]
    if (v != null) return { v: Number(v), day: prices.days[i].day }
  }
  return { v: null, day: null }
}
console.log(`  ${'collection'.padEnd(11)} ${'median$'.padStart(9)} ${'asOf'.padStart(11)} ${'floor$'.padStart(9)}  bound`)
for (const c of prices.collections) {
  const { v: med, day: medDay } = lastMedian(c)
  const floorEth = floors[FLOOR_KEY[c]]
  const floorUsd = floorEth != null ? floorEth * ethUsd : null
  let mark = `${C.gray}—${C.rst}`
  if (med != null && floorUsd != null) {
    // median is the typical *settled* price; floor is the cheapest *listing*. Median
    // a touch below floor can happen, but median far below floor is suspicious.
    if (med >= floorUsd * 0.7) mark = `${C.grn}ok${C.rst}`
    else mark = `${C.yel}median ≪ floor?${C.rst}`
  }
  console.log(`  ${c.padEnd(11)} ${(med != null ? usd(med) : '—').padStart(9)} ${(medDay || '—').padStart(11)} ${(floorUsd != null ? usd(floorUsd) : '—').padStart(9)}  ${mark}`)
}
sub('  note: median (settled) vs floor (cheapest live listing) are different measures — this is a sanity bound, not an exact reconcile. No historical median exists on Sky Mavis to match against.')

// ── verdict ───────────────────────────────────────────────────────────────
h('━━ VERDICT ━━')
const bad = findings.filter((f) => f.sev === 'bad')
const warn = findings.filter((f) => f.sev === 'warn')
const ok = findings.filter((f) => f.sev === 'ok')
for (const f of ok) console.log(`  ${C.grn}✓${C.rst} ${f.msg}`)
for (const f of warn) console.log(`  ${C.yel}⚠${C.rst} ${f.msg}`)
for (const f of bad) console.log(`  ${C.red}✗${C.rst} ${f.msg}`)
console.log(`\n  ${C.bold}${ok.length} ok · ${warn.length} warnings · ${bad.length} problems${C.rst}`)
process.exit(bad.length ? 1 : 0)
