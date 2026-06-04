#!/usr/bin/env node
// Pulls the two saved Dune queries (daily metrics + top sales) into DuckDB and
// exports the JSON the dashboard reads. Cheap and idempotent.
//
// Usage:
//   node scripts/ingest-dune.mjs          # uses last cached Dune results (no credits)
//   node scripts/ingest-dune.mjs --run    # executes the queries fresh, then pulls
//
// Requires in .env: DUNE_API_KEY, DUNE_QUERY_DAILY_METRICS, DUNE_QUERY_TOP_SALES

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from './lib/db.mjs'
import { createDuneClient } from './lib/dune.mjs'
import { env } from './lib/env.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = resolve(ROOT, 'public')
const FRESH = process.argv.includes('--run')

const DAILY_ID = env('DUNE_QUERY_DAILY_METRICS')
const TOP_ID = env('DUNE_QUERY_TOP_SALES')
// Optional: daily median settle price per collectible collection. The dashboard
// degrades gracefully when this isn't set yet.
const PRICES_ID = env('DUNE_QUERY_COLLECTIBLE_PRICES')

// Dune number columns may arrive as number or string; normalize.
const n = (v) => (v == null || v === '' ? null : Number(v))
const day10 = (d) => String(d).slice(0, 10)

function bindNum(stmt, i, v) {
  if (v == null || Number.isNaN(v)) stmt.bindNull(i)
  else stmt.bindDouble(i, v)
}

async function main() {
  if (!DAILY_ID || !TOP_ID) {
    throw new Error('Set DUNE_QUERY_DAILY_METRICS and DUNE_QUERY_TOP_SALES in .env')
  }
  const db = await openDb()
  const dune = createDuneClient()
  const get = FRESH ? (id) => dune.run(id) : (id) => dune.latest(id)

  // ---------- daily metrics ----------
  const daily = await get(DAILY_ID)
  // A transient empty Dune response must never clobber good data. Upserts with
  // zero rows are harmless, but skip the work and warn so it's visible.
  if (!daily.length) {
    console.warn('⚠️  Dune daily query returned 0 rows — keeping existing data, skipping daily upsert.')
  }
  const insDaily = await db.prepare(
    `INSERT INTO dune_daily (day, axie_sales, unique_buyers, volume_usd, median_usd, p25_usd, p75_usd, p95_usd)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT (day) DO UPDATE SET
       axie_sales=excluded.axie_sales, unique_buyers=excluded.unique_buyers,
       volume_usd=excluded.volume_usd, median_usd=excluded.median_usd,
       p25_usd=excluded.p25_usd, p75_usd=excluded.p75_usd, p95_usd=excluded.p95_usd`
  )
  for (const r of daily) {
    insDaily.bindVarchar(1, day10(r.day))
    insDaily.bindBigInt(2, BigInt(n(r.axie_sales) ?? 0))
    insDaily.bindBigInt(3, BigInt(n(r.unique_buyers) ?? 0))
    bindNum(insDaily, 4, n(r.volume_usd))
    bindNum(insDaily, 5, n(r.median_usd))
    bindNum(insDaily, 6, n(r.p25_usd))
    bindNum(insDaily, 7, n(r.p75_usd))
    bindNum(insDaily, 8, n(r.p95_usd))
    await insDaily.run()
  }

  // ---------- top sales ----------
  // This is a destructive replace (DELETE then re-insert "current top N"). If
  // the fetch came back empty (transient Dune hiccup / rate limit), do NOT
  // delete — that would wipe the table and export an empty top-sales JSON.
  const top = await get(TOP_ID)
  if (!top.length) {
    console.warn('⚠️  Dune top-sales query returned 0 rows — keeping existing top sales, skipping replace.')
  }
  if (top.length) {
    await db.run('DELETE FROM dune_top_sales') // small + always "current top N"
  }
  const insTop = await db.prepare(
    `INSERT INTO dune_top_sales (tx_hash, token_id, block_time, buyer, currency, price, price_usd)
     VALUES (?,?,?,?,?,?,?) ON CONFLICT (tx_hash, token_id) DO NOTHING`
  )
  for (const r of top) {
    insTop.bindVarchar(1, String(r.tx_hash ?? ''))
    insTop.bindVarchar(2, String(r.token_id ?? ''))
    insTop.bindVarchar(3, String(r.block_time ?? ''))
    insTop.bindVarchar(4, String(r.buyer ?? ''))
    insTop.bindVarchar(5, String(r.currency ?? ''))
    bindNum(insTop, 6, n(r.price))
    bindNum(insTop, 7, n(r.price_usd))
    await insTop.run()
  }

  // ---------- collectible median prices over time (optional) ----------
  if (PRICES_ID) {
    const prices = await get(PRICES_ID)
    if (!prices.length) {
      console.warn('⚠️  Dune collectible-prices query returned 0 rows — keeping existing data.')
    } else {
      const insPrice = await db.prepare(
        `INSERT INTO dune_collectible_daily (day, collection, sales, median_usd)
         VALUES (?,?,?,?)
         ON CONFLICT (day, collection) DO UPDATE SET
           sales=excluded.sales, median_usd=excluded.median_usd`
      )
      for (const r of prices) {
        insPrice.bindVarchar(1, day10(r.day))
        insPrice.bindVarchar(2, String(r.collection ?? ''))
        insPrice.bindBigInt(3, BigInt(n(r.sales) ?? 0))
        bindNum(insPrice, 4, n(r.median_usd))
        await insPrice.run()
      }
    }
  }

  // ---------- export JSON for the dashboard ----------
  mkdirSync(PUBLIC, { recursive: true })
  const days = await db.all(
    `SELECT CAST("day" AS VARCHAR) AS "day", axie_sales, unique_buyers,
            volume_usd, median_usd, p25_usd, p75_usd, p95_usd
     FROM dune_daily ORDER BY "day"`
  )
  const totals = await db.get(
    `SELECT count(*) ndays, sum(axie_sales) sales, sum(volume_usd) volume_usd FROM dune_daily`
  )
  writeFileSync(
    resolve(PUBLIC, 'dune-daily.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), source: 'dune', totals, days }, null, 2)
  )

  // Join cached metadata so an ingest-only run keeps name/class/image/collectible
  // for already-enriched tokens (enrich-axies.mjs fills in any new ones after).
  const topRows = await db.all(
    `SELECT t.tx_hash, t.token_id, t.block_time, t.buyer, t.currency, t.price, t.price_usd,
            m.name AS name, m.axie_class AS cls, m.image AS image, m.collectible AS collectible
     FROM dune_top_sales t
     LEFT JOIN axie_meta m USING (token_id)
     ORDER BY t.price_usd DESC NULLS LAST`
  )
  writeFileSync(
    resolve(PUBLIC, 'dune-top-sales.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), sales: topRows }, null, 2)
  )

  // Collectible median prices — pivot long (day, collection) → wide (one key per
  // collection per day) so the chart can draw a line per collection directly.
  const priceRows = await db.all(
    `SELECT CAST("day" AS VARCHAR) AS "day", collection, median_usd
     FROM dune_collectible_daily ORDER BY "day"`
  )
  if (priceRows.length) {
    const collections = [...new Set(priceRows.map((r) => r.collection))].sort()
    const byDay = new Map()
    for (const r of priceRows) {
      if (!byDay.has(r.day)) byDay.set(r.day, { day: r.day })
      byDay.get(r.day)[r.collection] = n(r.median_usd)
    }
    writeFileSync(
      resolve(PUBLIC, 'dune-collectible-prices.json'),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          metric: 'median_usd',
          collections,
          days: [...byDay.values()],
        },
        null,
        2
      )
    )
  }

  console.log(
    `✅ Dune ingest: ${days.length} days (${Number(totals.sales).toLocaleString()} sales, ` +
      `$${Math.round(Number(totals.volume_usd) || 0).toLocaleString()} volume), ${topRows.length} top sales` +
      (priceRows.length ? `, ${priceRows.length} collectible-price points` : '')
  )
}

main().catch((e) => {
  console.error('❌ ingest-dune failed:', e.message)
  process.exit(1)
})
