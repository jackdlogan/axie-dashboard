#!/usr/bin/env node
// Verifies the ingested sales data is complete and sane. Run this AFTER the
// ingestion finishes (DuckDB locks the file while ingesting, so this will error
// with a lock message if it's still running).
//
// Checks:
//   1. Coverage   — does the date range span the full window with no missing days?
//   2. Integrity  — row count vs unique ids (no dupes), price sanity
//   3. Reconcile  — DB's last-30-day sale count vs the API's marketStats (truth check)
//
// Usage: node scripts/check-data.mjs [--days 90]

import { openDb } from './lib/db.mjs'
import { createClient } from './lib/api.mjs'

const daysArg = process.argv.indexOf('--days')
const WINDOW_DAYS = daysArg !== -1 ? Number(process.argv[daysArg + 1]) : 90

let db
try {
  db = await openDb()
} catch (e) {
  console.error(
    '❌ Could not open the database. If ingestion is still running, wait for it ' +
      'to finish (DuckDB allows only one writer).\n   ' + e.message
  )
  process.exit(1)
}

const ok = (b) => (b ? '✅' : '⚠️ ')

// ---- 1. Coverage ----
const span = await db.get(
  'SELECT count(*) AS rows, count(DISTINCT id) AS uniq, count(DISTINCT day) AS days, ' +
    'min(day) AS lo, max(day) AS hi, min(ts) AS minTs FROM sales'
)
const now = Math.floor(Date.now() / 1000)
const cutoff = now - WINDOW_DAYS * 86400
const reachedBack = span.minTs && span.minTs <= cutoff + 2 * 86400
const expectedDays = WINDOW_DAYS + 1

console.log('── Coverage ──')
console.log(`  rows: ${span.rows.toLocaleString()}  ·  distinct days: ${span.days}/${expectedDays}`)
console.log(`  range: ${span.lo} → ${span.hi}`)
console.log(`  ${ok(reachedBack)} reaches back ~${WINDOW_DAYS}d (oldest ts ${reachedBack ? 'past' : 'NOT past'} cutoff)`)

// Missing-day gaps within the covered range.
const gaps = await db.all(`
  WITH d AS (SELECT DISTINCT day FROM sales),
       cal AS (SELECT (max(day) - CAST(x AS INTEGER)) AS day
               FROM (SELECT min(day) AS mn, max(day) AS mx FROM sales),
                    range(0, datediff('day', mn, mx) + 1) t(x))
  SELECT cal.day FROM cal LEFT JOIN d USING (day) WHERE d.day IS NULL ORDER BY 1`)
console.log(`  ${ok(gaps.length === 0)} missing days: ${gaps.length}${gaps.length ? ' → ' + gaps.slice(0, 5).map((g) => g.day).join(', ') + (gaps.length > 5 ? '…' : '') : ''}`)

// ---- 2. Integrity ----
const dupes = span.rows - span.uniq
const price = await db.get(
  'SELECT round(min(price_token),6) AS lo, round(max(price_token),3) AS hi, ' +
    'count(*) FILTER (WHERE price_token <= 0) AS zero FROM sales'
)
console.log('\n── Integrity ──')
console.log(`  ${ok(dupes === 0)} duplicate ids: ${dupes}`)
console.log(`  price range: ${price.lo} – ${price.hi} ETH  ·  ${ok(price.zero === 0)} zero-price rows: ${price.zero}`)

// Per-day volume sample (last 5 days).
const recent = await db.all(
  'SELECT day, count(*) AS sales, round(sum(price_token),3) AS eth FROM sales ' +
    'GROUP BY 1 ORDER BY 1 DESC LIMIT 5'
)
console.log('  recent days:')
for (const r of recent) console.log(`    ${r.day}: ${r.sales} sales, ${r.eth} ETH`)

// ---- 3. Reconcile vs API ----
console.log('\n── Reconciliation (DB vs API) ──')
try {
  const gql = createClient()
  const { data } = await gql('{ marketStats { last30Days { count } } overallMarketStats { mkpTxs { last30D } } }')
  const apiCount = Number(data.marketStats?.last30Days?.count)
  const dbCount = (await db.get(`SELECT count(*) AS n FROM sales WHERE ts >= ${now - 30 * 86400}`)).n
  const diffPct = apiCount ? (((dbCount - apiCount) / apiCount) * 100).toFixed(1) : 'n/a'
  console.log(`  DB last-30d sales:  ${dbCount.toLocaleString()}`)
  console.log(`  API marketStats:    ${apiCount.toLocaleString()} (note: API counts ALL tokens, not just Axies)`)
  console.log(`  diff: ${diffPct}%  — DB should be ≤ API since this is Axies-only`)
} catch (e) {
  console.log('  (skipped — ' + e.message + ')')
}

console.log('\nDone.')
