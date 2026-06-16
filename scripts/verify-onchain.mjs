#!/usr/bin/env node
// Independent verification of the daily metrics, NOT trusting Dune OR the cached
// Sky Mavis aggregates. Two angles per target UTC day:
//
//   Part A — On-chain re-derivation (ground truth). Read Ronin directly via public
//     RPC: eth_getLogs for the Market Gateway settlement event over the day's block
//     range, decode each settlement (price / token_id / payment token / collection),
//     keep the Axie-contract ones, and re-compute sale count + volume from scratch.
//     This is the same decode Dune does, run independently — it catches Dune index
//     lag/gaps and reveals the payment-token mix (incl. native-RON sales that the
//     prices.usd join can't value).
//
//   Part B — Sky Mavis historical reconcile. Page the raw tokenActivities feed
//     (Sale + collection-offer settlements) for the same day and count — a
//     staleness-immune check of a *historical* day, not just the live tip.
//
// Then both are compared to the committed Dune daily row for that day.
//
// Usage:
//   node scripts/verify-onchain.mjs                 # last 2 complete UTC days in the snapshot
//   node scripts/verify-onchain.mjs --days 2026-06-14,2026-06-13
//   node scripts/verify-onchain.mjs --skip-skymavis # Part A only (no GraphQL paging)

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from './lib/api.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const daily = JSON.parse(readFileSync(resolve(ROOT, 'public/dune-daily.json'), 'utf8'))

// ── contracts / event (see memory: axie-gateway-decode) ────────────────────
const GATEWAY = '0x3b3adf1422f84254b7fbb0e7ca62bd0865133fe3'
const AXIE = '0x32950db2a7164ae833121501c797d79e7b79d74c'
const TOPIC0 = '0x109cee1a21fd2e7fba88adb0c288672b657beb8b4f5e36ea950cbebf8a901b6d'

// Payment tokens seen on the marketplace → { symbol, decimals, rateKey }. rateKey
// indexes the exchangeRate response. Unknown tokens are counted but left unpriced
// (exactly how Dune's prices.usd LEFT JOIN behaves) so we can quantify the gap.
const TOKENS = {
  '0xc99a6a985ed2cac1ef41640596c5a5f9f4e19ef5': { sym: 'WETH', dec: 18, rate: 'eth' },
  '0xe514d9deb7966c8be0ca922de8a064264ea6bcd4': { sym: 'WRON', dec: 18, rate: 'ron' },
  '0x0b7007c13325c48911f73a2dad5fa5dcbf808adc': { sym: 'USDC', dec: 6, rate: 'usdc' },
  '0x97a9107c1793bc407d6f527b77e7fff4d812bece': { sym: 'AXS', dec: 18, rate: 'axs' },
  '0xa8754b9fa15fc18bb59458815510e40a12cd2014': { sym: 'SLP', dec: 18, rate: 'slp' },
  '0x0000000000000000000000000000000000000000': { sym: 'RON(native)', dec: 18, rate: 'ron' },
}

// ── RPC plumbing (public endpoints reject batch arrays; rotate to dodge 429s) ──
const RPCS = ['https://api.roninchain.com/rpc', 'https://ronin.drpc.org']
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let rpcCursor = 0
async function rpc(method, params, attempt = 1) {
  const url = RPCS[(rpcCursor++) % RPCS.length]
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    if (res.status === 429) throw new Error('429')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const j = await res.json()
    if (j.error) throw new Error(j.error.message || JSON.stringify(j.error))
    return j.result
  } catch (e) {
    if (attempt > 10) throw e
    await sleep(e.message === '429' ? Math.min(8000, 1000 * attempt) : 400 * attempt)
    return rpc(method, params, attempt + 1)
  }
}

const hexToNum = (h) => Number(BigInt(h))
const dayBounds = (d) => {
  const start = Math.floor(new Date(d + 'T00:00:00Z').getTime() / 1000)
  return [start, start + 86400] // [00:00, next 00:00) UTC
}

async function blockTs(num) {
  // Non-archive endpoints return null for blocks they don't have; rotate + retry.
  for (let i = 0; i < 6; i++) {
    const blk = await rpc('eth_getBlockByNumber', ['0x' + num.toString(16), false])
    if (blk?.timestamp != null) return hexToNum(blk.timestamp)
    await sleep(200)
  }
  throw new Error(`block ${num} unavailable on all RPCs`)
}

// Binary-search the first block whose timestamp is >= ts, within [lo, hi].
async function blockAtOrAfter(ts, lo, hi) {
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((await blockTs(mid)) < ts) lo = mid + 1
    else hi = mid
  }
  return lo
}

// Slice a 32-byte word out of a 0x data string by byte offset (hex = 2 chars/byte).
const wordHex = (data, byteOff, len = 32) => data.slice(2 + byteOff * 2, 2 + (byteOff + len) * 2)
const lowAddr = (topicOrWord) => '0x' + topicOrWord.slice(-40).toLowerCase()

async function getLogsChunked(fromBlock, toBlock, onLog) {
  const STEP = 500 // conservative; public RPCs cap getLogs block-span/result-size
  for (let b = fromBlock; b <= toBlock; b += STEP) {
    const to = Math.min(b + STEP - 1, toBlock)
    const logs = await rpc('eth_getLogs', [{
      fromBlock: '0x' + b.toString(16),
      toBlock: '0x' + to.toString(16),
      address: GATEWAY,
      topics: [TOPIC0],
    }])
    for (const l of logs) onLog(l)
    if (process.stdout.isTTY) {
      process.stdout.write(`\r    scanning blocks ${fromBlock}..${toBlock}  (${Math.min(100, Math.round(100 * (to - fromBlock) / (toBlock - fromBlock || 1)))}%)   `)
    }
  }
  if (process.stdout.isTTY) process.stdout.write('\n')
}

// ── Part A: re-derive a day from chain logs ────────────────────────────────
async function onchainDay(day, tipBlock, rates) {
  const [t0, t1] = dayBounds(day)
  // Bound the search to a RECENT window: estimate blocks-back at ~2.4s/block
  // (faster than Ronin's real ~3s, so the floor lands safely *below* the day's
  // start) plus a 100k-block cushion. This avoids querying ancient blocks that
  // non-archive public RPCs return as null, while never clamping above t0.
  const nowSec = Math.floor(Date.now() / 1000)
  const floor = Math.max(1, tipBlock - Math.ceil((nowSec - t0) / 2.4) - 100_000)
  const lo = await blockAtOrAfter(t0, floor, tipBlock)
  const hi = await blockAtOrAfter(t1, lo, tipBlock)
  const fromBlock = lo
  const toBlock = hi - 1 // hi is the first block of the NEXT day

  let axieSales = 0
  const byToken = {} // sym -> { count, amount(native), usd|null }
  const onLog = (l) => {
    const data = l.data
    // collection address lives in the low 20 bytes of word #24 (byte offset 780)
    const collection = lowAddr(wordHex(data, 780, 20))
    if (collection !== AXIE) return // not an Axie settlement (land/item/etc.)
    axieSales++
    const payToken = lowAddr(l.topics[2])
    const priceRaw = BigInt('0x' + (wordHex(data, 64) || '0')) // settled price, word #2
    const meta = TOKENS[payToken] || { sym: `?${payToken.slice(0, 10)}`, dec: 18, rate: null }
    const amt = Number(priceRaw) / 10 ** meta.dec
    const usd = meta.rate && rates[meta.rate] != null ? amt * rates[meta.rate] : null
    const b = (byToken[meta.sym] ||= { count: 0, amount: 0, usd: 0, priced: true })
    b.count++
    b.amount += amt
    if (usd == null) b.priced = false
    else b.usd += usd
  }
  await getLogsChunked(fromBlock, toBlock, onLog)

  const volUsd = Object.values(byToken).reduce((s, b) => s + (b.priced ? b.usd : 0), 0)
  const unpricedSales = Object.values(byToken).filter((b) => !b.priced).reduce((s, b) => s + b.count, 0)
  return { day, fromBlock, toBlock, axieSales, byToken, volUsd, unpricedSales }
}

// ── Part B: count a day from the Sky Mavis raw activity feed ────────────────
async function skymavisDay(gql, day) {
  const [t0, t1] = dayBounds(day)
  const QUERY = `query($a: String!, $ts: Int, $types: [ActivityType!]){
    tokenActivities(tokenAddress:$a, activityTypes:$types, lastTimestamp:$ts, size:50){
      id createdAt activityType
    }
  }`
  const types = ['Sale', 'CollectionOfferSale', 'AcceptCollectionOffer']
  const seen = new Set()
  const byType = {}
  let cursor = t1 // page backward from the end of the day
  let total = 0
  // Page until we walk past the start of the day. Dedup by id (boundary second repeats).
  while (cursor >= t0) {
    const { data } = await gql(QUERY, { a: AXIE, ts: cursor, types })
    const rows = data.tokenActivities || []
    if (!rows.length) break
    let advanced = false
    for (const r of rows) {
      const ts = Number(r.createdAt)
      if (ts < t0) continue
      if (ts >= t1) continue
      if (seen.has(r.id)) continue
      seen.add(r.id)
      byType[r.activityType] = (byType[r.activityType] || 0) + 1
      total++
    }
    const minTs = Math.min(...rows.map((r) => Number(r.createdAt)))
    if (minTs >= cursor) { cursor = minTs - 1 } else { cursor = minTs } // always make progress
    advanced = true
    if (minTs < t0 && rows.length < 50) break
    if (!advanced) break
  }
  return { day, total, byType }
}

// ── main ───────────────────────────────────────────────────────────────────
const C = { gray: '\x1b[90m', red: '\x1b[31m', grn: '\x1b[32m', yel: '\x1b[33m', cyn: '\x1b[36m', bold: '\x1b[1m', rst: '\x1b[0m' }
const pct = (a, b) => (b ? ((a - b) / b) * 100 : null)
const fmtPct = (p) => (p == null ? '—' : (p >= 0 ? '+' : '') + p.toFixed(1) + '%')
const tag = (p, tol = 2) => { if (p == null) return `${C.gray}n/a${C.rst}`; const a = Math.abs(p); return a <= tol ? `${C.grn}MATCH${C.rst}` : a <= tol * 4 ? `${C.yel}CLOSE${C.rst}` : `${C.red}DIVERGES${C.rst}` }
const usd = (n) => '$' + Math.round(n).toLocaleString()

async function main() {
  const argv = process.argv.slice(2)
  const daysArg = argv.includes('--days') ? argv[argv.indexOf('--days') + 1].split(',') : null
  const skipSM = argv.includes('--skip-skymavis')
  // default: last 2 COMPLETE UTC days (drop the partial current day at the tail)
  const complete = daily.days.slice(0, -1)
  const targets = daysArg || complete.slice(-2).map((d) => d.day)

  console.log(`${C.bold}${C.cyn}On-chain + historical verification${C.rst}`)
  console.log(`${C.gray}  target days: ${targets.join(', ')}${C.rst}`)

  // live rates (approx for historical USD — labeled as such; the exact peer is COUNT)
  const gql = createClient()
  const rates = {}
  try {
    const er = (await gql(`{ exchangeRate{ eth{usd} ron{usd} usdc{usd} axs{usd} slp{usd} } } `)).data.exchangeRate
    for (const k of ['eth', 'ron', 'usdc', 'axs', 'slp']) rates[k] = Number(er[k]?.usd)
    console.log(`${C.gray}  rates(now): ETH $${rates.eth} · RON $${rates.ron} · USDC $${rates.usdc} · AXS $${rates.axs}${C.rst}`)
  } catch (e) { console.log(`${C.yel}  (exchangeRate fetch failed — USD volume will be unpriced)${C.rst}`) }

  const tip = hexToNum(await rpc('eth_blockNumber', []))

  for (const day of targets) {
    const row = daily.days.find((d) => d.day === day)
    if (!row) { console.log(`\n${C.yel}${day}: not in dune-daily.json — skipping${C.rst}`); continue }
    console.log(`\n${C.bold}── ${day} ──${C.rst}  ${C.gray}(Dune: ${row.axie_sales.toLocaleString()} sales, ${usd(row.volume_usd)} vol)${C.rst}`)

    // Part A
    const a = await onchainDay(day, tip, rates)
    const pSales = pct(a.axieSales, row.axie_sales)
    console.log(`  ${C.bold}A · on-chain${C.rst}  blocks ${a.fromBlock}–${a.toBlock}`)
    console.log(`     Axie settlements : ${a.axieSales.toLocaleString()}   vs Dune ${row.axie_sales.toLocaleString()}   ${fmtPct(pSales)}  ${tag(pSales, 2)}`)
    const mix = Object.entries(a.byToken).sort((x, y) => y[1].count - x[1].count)
      .map(([s, b]) => `${s} ${b.count}${b.priced ? '' : C.yel + '(unpriced)' + C.rst}`).join(' · ')
    console.log(`     payment mix      : ${mix}`)
    console.log(`     re-derived vol   : ${usd(a.volUsd)} ${C.gray}(approx — current rates)${C.rst}   vs Dune ${usd(row.volume_usd)}   ${fmtPct(pct(a.volUsd, row.volume_usd))}`)
    if (a.unpricedSales) console.log(`     ${C.yel}${a.unpricedSales} sales in tokens with no rate — counted, not valued (same as Dune)${C.rst}`)

    // Part B
    if (!skipSM) {
      const b = await skymavisDay(gql, day)
      const types = Object.entries(b.byType).map(([t, n]) => `${t} ${n}`).join(' · ')
      const pB = pct(b.total, row.axie_sales)
      console.log(`  ${C.bold}B · Sky Mavis feed${C.rst}  (historical, staleness-immune)`)
      console.log(`     settlements      : ${b.total.toLocaleString()}   vs Dune ${row.axie_sales.toLocaleString()}   ${fmtPct(pB)}  ${tag(pB, 3)}`)
      console.log(`     by type          : ${types || '(none)'}`)
    }
  }
  console.log(`\n${C.gray}Notes: COUNT is the exact independent check; USD volume is approximate (historical rates differ from current). Native-RON & unpriced tokens reveal where Dune's USD volume legitimately undercounts.${C.rst}`)
}

main().catch((e) => { console.error('\n❌', e.message); process.exit(1) })
