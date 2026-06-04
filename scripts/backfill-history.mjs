#!/usr/bin/env node
// Backfills daily Axie sale history by walking the marketplace `Sale` activity
// feed backward via the lastTimestamp cursor, then aggregating into per-day
// buckets. Writes public/history-90d.json, which the dashboard loads directly.
//
// Usage:
//   node scripts/backfill-history.mjs            # incremental if file exists, else 90d backfill
//   node scripts/backfill-history.mjs --full     # force full 90d backfill
//   node scripts/backfill-history.mjs --days 30  # custom window
//
// The API has no >30d aggregate, so this is the only way to get a 90-day view.
// tokenActivities caps size at 50 and pages sequentially. ~3.2k sales/day means
// a full 90d run is ~5,760 requests (~15-20 min). Incremental runs are cheap.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const OUT = resolve(ROOT, 'public/history-90d.json')

const ENDPOINT = 'https://api-gateway.skymavis.com/graphql/axie-marketplace'
const AXIE_CONTRACT = '0x32950db2a7164ae833121501c797d79e7b79d74c'
const PAGE_SIZE = 50 // hard cap for tokenActivities
const REQUEST_DELAY_MS = 120 // gentle pacing to avoid rate limits

// ---- args ----
const args = process.argv.slice(2)
const FULL = args.includes('--full')
const daysArg = args.indexOf('--days')
const WINDOW_DAYS = daysArg !== -1 ? Number(args[daysArg + 1]) : 90

// ---- API key from .env / .env.example / env ----
function loadKey() {
  if (process.env.SKYMAVIS_API_KEY) return process.env.SKYMAVIS_API_KEY
  for (const f of ['.env', '.env.example']) {
    const p = resolve(ROOT, f)
    if (existsSync(p)) {
      const line = readFileSync(p, 'utf8')
        .split('\n')
        .find((l) => l.startsWith('SKYMAVIS_API_KEY='))
      if (line) return line.slice('SKYMAVIS_API_KEY='.length).trim()
    }
  }
  throw new Error('SKYMAVIS_API_KEY not found in env or .env')
}
const API_KEY = loadKey()

const QUERY = `query($t:Int){ tokenActivities(tokenAddress:"${AXIE_CONTRACT}", activityTypes:[Sale], lastTimestamp:$t, size:${PAGE_SIZE}){ id createdAt token{ ... on Axie { class } } activityDetails{ ... on SaleActivity { settlePrice } } } }`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchPage(lastTimestamp, attempt = 0) {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
      body: JSON.stringify({ query: QUERY, variables: lastTimestamp ? { t: lastTimestamp } : {} }),
    })
    if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '))
    return json.data.tokenActivities
  } catch (err) {
    if (attempt >= 5) throw err
    const backoff = 500 * 2 ** attempt
    process.stderr.write(`  retry ${attempt + 1} after ${backoff}ms (${err.message})\n`)
    await sleep(backoff)
    return fetchPage(lastTimestamp, attempt + 1)
  }
}

function weiToEth(wei) {
  try {
    return Number(BigInt(wei)) / 1e18
  } catch {
    return Number(wei) / 1e18 // handles scientific-notation strings like "141e+16"
  }
}

function dayKey(unixSec) {
  return new Date(unixSec * 1000).toISOString().slice(0, 10) // YYYY-MM-DD (UTC)
}

async function getEthUsd() {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
      body: JSON.stringify({ query: '{ exchangeRate { eth { usd } } }' }),
    })
    const json = await res.json()
    return Number(json.data?.exchangeRate?.eth?.usd) || 0
  } catch {
    return 0
  }
}

// Aggregate a flat list of sales into a map keyed by day.
function bucketize(sales, into = {}) {
  for (const s of sales) {
    const day = dayKey(s.createdAt)
    const cls = s.token?.class || 'Unknown'
    const eth = weiToEth(s.activityDetails?.settlePrice ?? '0')
    const b = (into[day] ??= { date: day, count: 0, volumeEth: 0, perClass: {} })
    b.count += 1
    b.volumeEth += eth
    b.perClass[cls] = (b.perClass[cls] || 0) + 1
  }
  return into
}

async function walkBack(stopTs, label) {
  // Pages the feed backward until createdAt < stopTs. Dedupes by activity id
  // (the cursor boundary second can repeat an item). Returns flat sales array.
  const seen = new Set()
  const out = []
  let cursor = undefined
  let reqs = 0
  const start = Date.now()
  while (true) {
    const page = await fetchPage(cursor)
    reqs++
    if (!page.length) break
    let oldest = Infinity
    for (const a of page) {
      oldest = Math.min(oldest, a.createdAt)
      if (a.createdAt <= stopTs) continue // boundary exclusive — avoids re-counting
      if (seen.has(a.id)) continue
      seen.add(a.id)
      out.push(a)
    }
    const nextCursor = page[page.length - 1].createdAt
    if (reqs % 25 === 0) {
      const ago = ((Date.now() / 1000 - oldest) / 86400).toFixed(1)
      process.stdout.write(
        `  ${label}: ${reqs} reqs, ${out.length} sales, at ${ago}d ago\r`
      )
    }
    if (oldest <= stopTs) break
    if (nextCursor === cursor) break // safety: cursor not advancing
    cursor = nextCursor
    await sleep(REQUEST_DELAY_MS)
  }
  process.stdout.write(
    `\n  ${label}: done — ${out.length} sales in ${reqs} reqs (${((Date.now() - start) / 1000).toFixed(0)}s)\n`
  )
  return out
}

async function main() {
  const now = Math.floor(Date.now() / 1000)
  const existing = !FULL && existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null

  let buckets = {}
  let stopTs
  if (existing) {
    // Incremental: only fetch sales newer than the latest we already stored.
    stopTs = existing.latestTs
    for (const d of existing.days) buckets[d.date] = d
    console.log(`Incremental update since ${new Date(stopTs * 1000).toISOString()}…`)
  } else {
    stopTs = now - WINDOW_DAYS * 86400
    console.log(`Full backfill: last ${WINDOW_DAYS} days (Axies only)…`)
  }

  // Incremental fetches only sales strictly newer than latestTs, so adding them
  // onto the existing day buckets correctly extends the partial latest day and
  // appends new days without double-counting.
  const sales = await walkBack(stopTs, existing ? 'incremental' : 'backfill')
  bucketize(sales, buckets)

  // Trim to the rolling window and sort ascending.
  const cutoff = now - WINDOW_DAYS * 86400
  const days = Object.values(buckets)
    .filter((d) => new Date(d.date + 'T00:00:00Z').getTime() / 1000 >= cutoff - 86400)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ ...d, avgPriceEth: d.count ? d.volumeEth / d.count : 0 }))

  const latestTs = sales.length
    ? Math.max(...sales.map((s) => s.createdAt), existing?.latestTs ?? 0)
    : existing?.latestTs ?? now

  const ethUsd = await getEthUsd()
  const totalVolumeEth = days.reduce((s, d) => s + d.volumeEth, 0)
  const totalSales = days.reduce((s, d) => s + d.count, 0)

  const payload = {
    collection: 'Axie',
    contract: AXIE_CONTRACT,
    windowDays: WINDOW_DAYS,
    generatedAt: new Date().toISOString(),
    latestTs,
    ethUsdAtGen: ethUsd,
    totals: { sales: totalSales, volumeEth: totalVolumeEth, volumeUsdApprox: totalVolumeEth * ethUsd },
    days,
  }

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(payload, null, 2))
  console.log(
    `\n✅ Wrote ${OUT}\n   ${days.length} days · ${totalSales.toLocaleString()} sales · ${totalVolumeEth.toFixed(2)} ETH (~$${Math.round(totalVolumeEth * ethUsd).toLocaleString()})`
  )
}

main().catch((e) => {
  console.error('\n❌ Backfill failed:', e.message)
  process.exit(1)
})
