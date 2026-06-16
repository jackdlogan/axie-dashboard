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
// Optional: daily distinct-holder count per collectible collection (same pattern).
const HOLDERS_ID = env('DUNE_QUERY_COLLECTIBLE_HOLDERS')

// Collections created by *evolving* existing Axies rather than being fixed at
// birth. The token→collection seed only captures current membership, so counting
// a token's pre-event ownership wrongly attributes normal-Axie history to the
// collectible (e.g. Nightmare showed thousands of "holders" back in 2021). Clip
// each such series to its on-chain launch so it can't predate the mechanic.
// Nightmare = "The Wings of Nightmare" evolution event, live 2024-11-21.
// (Mystic/Shiny/Origin/seasonal/MEO are birth-fixed, so their early history is real.)
const COLLECTION_INCEPTION = { Nightmare: '2024-11-21' }

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
  } else {
    // Full-replace: the query returns the whole window each run, so a day that
    // falls out of the window (e.g. after trimming 730→365 days) must be removed,
    // not left as a stale orphan. Guarded by daily.length so a transient empty
    // response never wipes good data.
    await db.run('DELETE FROM dune_daily')
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
      // Full-replace, not upsert: the query returns the whole 180d window each run,
      // and a (day, collection) pair can DISAPPEAR between runs (e.g. a thin day
      // whose only sale was re-attributed to another collection). A plain upsert
      // would never overwrite that now-absent row, leaving a stale orphan. Clear
      // first so the table exactly mirrors the latest query result.
      await db.run('DELETE FROM dune_collectible_daily')
      const insPrice = await db.prepare(
        `INSERT INTO dune_collectible_daily (day, collection, sales, median_usd, median_weth)
         VALUES (?,?,?,?,?)
         ON CONFLICT (day, collection) DO UPDATE SET
           sales=excluded.sales, median_usd=excluded.median_usd, median_weth=excluded.median_weth`
      )
      for (const r of prices) {
        insPrice.bindVarchar(1, day10(r.day))
        insPrice.bindVarchar(2, String(r.collection ?? ''))
        insPrice.bindBigInt(3, BigInt(n(r.sales) ?? 0))
        bindNum(insPrice, 4, n(r.median_usd))
        // median_weth is null until the saved Dune query is updated to emit it.
        bindNum(insPrice, 5, n(r.median_weth))
        await insPrice.run()
      }
    }
  }

  // ---------- collectible distinct holders over time (optional) ----------
  if (HOLDERS_ID) {
    const holders = await get(HOLDERS_ID)
    if (!holders.length) {
      console.warn('⚠️  Dune collectible-holders query returned 0 rows — keeping existing data.')
    } else {
      // Full-replace for the same reason as prices (see above): the query returns
      // the full history each run, so mirror it exactly rather than upserting.
      await db.run('DELETE FROM dune_collectible_holders_daily')
      const insHolders = await db.prepare(
        `INSERT INTO dune_collectible_holders_daily (day, collection, holders)
         VALUES (?,?,?)
         ON CONFLICT (day, collection) DO UPDATE SET holders=excluded.holders`
      )
      for (const r of holders) {
        insHolders.bindVarchar(1, day10(r.day))
        insHolders.bindVarchar(2, String(r.collection ?? ''))
        insHolders.bindBigInt(3, BigInt(n(r.holders) ?? 0))
        await insHolders.run()
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
  // Two series: `days` in USD (legacy) and `daysWeth` in ETH-equivalent. The
  // WETH pivot stays empty until the saved Dune query emits median_weth.
  const priceRows = await db.all(
    `SELECT CAST("day" AS VARCHAR) AS "day", collection, median_usd, median_weth
     FROM dune_collectible_daily ORDER BY "day"`
  )
  if (priceRows.length) {
    const collections = [...new Set(priceRows.map((r) => r.collection))].sort()
    // Pivot one metric to [{ day, <collection>: value, … }], skipping null cells.
    const pivot = (key) => {
      const byDay = new Map()
      for (const r of priceRows) {
        const v = n(r[key])
        if (v == null) continue
        if (!byDay.has(r.day)) byDay.set(r.day, { day: r.day })
        byDay.get(r.day)[r.collection] = v
      }
      return [...byDay.values()]
    }
    writeFileSync(
      resolve(PUBLIC, 'dune-collectible-prices.json'),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          metric: 'median_usd',
          collections,
          days: pivot('median_usd'),
          daysWeth: pivot('median_weth'),
        },
        null,
        2
      )
    )
  }

  // Collectible holders — pivot long (day, collection) → wide. Holders is a
  // *stock*, so unlike prices we forward-fill: each collection carries its last
  // known count across quiet days, staying null only before its first data point
  // (so each line starts where the collection begins, with no gaps after).
  const holderRows = await db.all(
    `SELECT CAST("day" AS VARCHAR) AS "day", collection, holders
     FROM dune_collectible_holders_daily ORDER BY "day"`
  )
  if (holderRows.length) {
    const collections = [...new Set(holderRows.map((r) => r.collection))].sort()
    const allDays = [...new Set(holderRows.map((r) => r.day))].sort()
    const raw = new Map() // day -> { collection: holders }
    for (const r of holderRows) {
      if (!raw.has(r.day)) raw.set(r.day, {})
      raw.get(r.day)[r.collection] = n(r.holders)
    }
    const last = {} // collection -> last seen value (for forward-fill)
    const days = allDays.map((day) => {
      const row = { day }
      const cells = raw.get(day) || {}
      for (const c of collections) {
        if (cells[c] != null) last[c] = cells[c]
        if (last[c] != null) row[c] = last[c]
      }
      return row
    })
    // Clip evolution-based collections to their launch date (string compare is
    // safe for YYYY-MM-DD). Removing the key makes the line start at inception.
    for (const row of days) {
      for (const [c, since] of Object.entries(COLLECTION_INCEPTION)) {
        if (row[c] != null && row.day < since) delete row[c]
      }
    }
    writeFileSync(
      resolve(PUBLIC, 'dune-collectible-holders.json'),
      JSON.stringify(
        { generatedAt: new Date().toISOString(), metric: 'holders', collections, days },
        null,
        2
      )
    )
  }

  console.log(
    `✅ Dune ingest: ${days.length} days (${Number(totals.sales).toLocaleString()} sales, ` +
      `$${Math.round(Number(totals.volume_usd) || 0).toLocaleString()} volume), ${topRows.length} top sales` +
      (priceRows.length ? `, ${priceRows.length} collectible-price points` : '') +
      (holderRows.length ? `, ${holderRows.length} collectible-holder points` : '')
  )
}

main().catch((e) => {
  console.error('❌ ingest-dune failed:', e.message)
  process.exit(1)
})
