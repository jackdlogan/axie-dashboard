#!/usr/bin/env node
// Fetches daily USD reference rates for ETH and RON from CoinGecko and upserts
// them into the `prices` table, so historical token volume can be valued at the
// rate that was true on each day (instead of one current rate).
//
// Usage: node scripts/fetch-prices.mjs [--days 120]
// CoinGecko's free API needs no key. We request a window and bucket whatever
// granularity it returns down to one (last) reading per UTC day.

import { openDb } from './lib/db.mjs'
import { sleep } from './lib/api.mjs'

const daysArg = process.argv.indexOf('--days')
const DAYS = daysArg !== -1 ? Number(process.argv[daysArg + 1]) : 120

// CoinGecko coin ids → our token labels (matching the `prices.token` column).
const COINS = [
  ['ethereum', 'eth'],
  ['ronin', 'ron'],
]

function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10)
}

async function fetchSeries(coinId) {
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${DAYS}`
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (res.status === 429) {
    console.log(`  ${coinId}: rate-limited, waiting 15s…`)
    await sleep(15_000)
    return fetchSeries(coinId)
  }
  if (!res.ok) throw new Error(`CoinGecko ${coinId}: HTTP ${res.status}`)
  const json = await res.json()
  // prices: [[ms, usd], ...] — keep the last reading per UTC day.
  const byDay = new Map()
  for (const [ms, usd] of json.prices ?? []) byDay.set(dayKey(ms), usd)
  return byDay
}

async function main() {
  const db = await openDb()
  let total = 0
  for (const [coinId, token] of COINS) {
    const byDay = await fetchSeries(coinId)
    const stmt = await db.prepare(
      'INSERT INTO prices (day, token, usd) VALUES (?, ?, ?) ' +
        'ON CONFLICT (day, token) DO UPDATE SET usd = excluded.usd'
    )
    for (const [day, usd] of byDay) {
      stmt.bindVarchar(1, day)
      stmt.bindVarchar(2, token)
      stmt.bindDouble(3, usd)
      await stmt.run()
    }
    total += byDay.size
    console.log(`  ${token}: ${byDay.size} daily rates`)
    await sleep(1500) // be gentle with CoinGecko's free tier
  }
  const { n, lo, hi } = await db.get(
    'SELECT count(*) AS n, min(day) AS lo, max(day) AS hi FROM prices'
  )
  console.log(`✅ prices table: ${n} rows spanning ${lo} → ${hi} (added/updated ${total})`)
}

main().catch((e) => {
  console.error('❌ fetch-prices failed:', e.message)
  process.exit(1)
})
