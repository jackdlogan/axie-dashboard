#!/usr/bin/env node
// Ingests raw Axie sales into the DuckDB `sales` table by walking the
// marketplace Sale feed backward via the lastTimestamp cursor.
//
// Unlike the old JSON backfill, this PERSISTS EACH PAGE as it goes and
// checkpoints how far back it has reached — so it is fully resumable. A crash,
// or hitting the hourly rate cap, just means you re-run and it continues from
// where it stopped. Inserts are idempotent (ON CONFLICT (id) DO NOTHING).
//
// Usage:
//   node scripts/ingest-sales.mjs            # resume backfill, or incremental if complete
//   node scripts/ingest-sales.mjs --full     # restart the 90-day backfill from now
//   node scripts/ingest-sales.mjs --days 30  # custom window
//
// Limitation: tokenActivities' SaleActivity exposes settlePrice + orderKind but
// NOT the payment token, so payment_token is left NULL and price_token assumes
// 18-decimal ETH/WETH. Resolving multi-token volume needs order-level data.

import { openDb } from './lib/db.mjs'
import { createClient } from './lib/api.mjs'

const AXIE_CONTRACT = '0x32950db2a7164ae833121501c797d79e7b79d74c'
const PAGE = 50

const args = process.argv.slice(2)
const FULL = args.includes('--full')
const daysArg = args.indexOf('--days')
const WINDOW_DAYS = daysArg !== -1 ? Number(args[daysArg + 1]) : 90

const QUERY = `query($t:Int){ tokenActivities(tokenAddress:"${AXIE_CONTRACT}", activityTypes:[Sale], lastTimestamp:$t, size:${PAGE}){ id createdAt txHash token{ ... on Axie { id class } } activityDetails{ ... on SaleActivity { settlePrice orderKind } } } }`

function weiToToken(wei) {
  try {
    return Number(BigInt(wei)) / 1e18
  } catch {
    return Number(wei) / 1e18 // scientific-notation strings like "141e+16"
  }
}
const dayKey = (ts) => new Date(ts * 1000).toISOString().slice(0, 10)

async function main() {
  const db = await openDb()
  const onWait = ({ reason, ms }) =>
    process.stdout.write(`\n  ⏳ pacing (${reason}) — waiting ${(ms / 1000) | 0}s\n`)
  const gql = createClient({ onWait })

  const getState = async (k) =>
    (await db.get(`SELECT value FROM ingest_state WHERE key = '${k}'`))?.value
  const setState = async (k, v) => {
    const s = await db.prepare(
      `INSERT INTO ingest_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`
    )
    s.bindVarchar(1, k)
    s.bindVarchar(2, String(v))
    await s.run()
  }

  const insert = await db.prepare(
    `INSERT INTO sales (id, ts, day, axie_id, class, price_wei, price_token, payment_token, order_kind, tx_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?) ON CONFLICT (id) DO NOTHING`
  )

  async function insertSale(a) {
    const wei = a.activityDetails?.settlePrice ?? '0'
    insert.bindBigInt(1, BigInt(a.id))
    insert.bindBigInt(2, BigInt(a.createdAt))
    insert.bindVarchar(3, dayKey(a.createdAt))
    insert.bindBigInt(4, BigInt(a.token?.id ?? 0))
    insert.bindVarchar(5, a.token?.class ?? 'Unknown')
    insert.bindVarchar(6, String(wei))
    insert.bindDouble(7, weiToToken(wei))
    insert.bindInteger(8, Number(a.activityDetails?.orderKind ?? 0))
    insert.bindVarchar(9, a.txHash ?? '')
    await insert.run()
  }

  const now = Math.floor(Date.now() / 1000)
  const cutoff = now - WINDOW_DAYS * 86400
  const oldestStored = Number(await getState('oldest_ts')) || 0
  const newestStored = Number(await getState('newest_ts')) || 0

  // Decide mode.
  let startCursor, stopTs, mode
  if (FULL || !oldestStored) {
    mode = 'backfill'
    startCursor = undefined // from now
    stopTs = cutoff
  } else if (oldestStored > cutoff + 86400) {
    mode = 'resume-backfill'
    startCursor = oldestStored // continue going back from where we stopped
    stopTs = cutoff
  } else {
    mode = 'incremental'
    startCursor = undefined // from now, stop when we reach what we already have
    stopTs = newestStored
  }
  console.log(`Mode: ${mode} · window ${WINDOW_DAYS}d · cutoff ${dayKey(cutoff)}`)

  let cursor = startCursor
  let inserted = 0
  let reqs = 0
  let minTs = Infinity
  let maxTs = 0
  const t0 = Date.now()

  while (true) {
    const { data } = await gql(QUERY, cursor ? { t: cursor } : {})
    reqs++
    const page = data.tokenActivities
    if (!page.length) break

    let pageOldest = Infinity
    for (const a of page) {
      pageOldest = Math.min(pageOldest, a.createdAt)
      if (a.createdAt <= stopTs) continue // boundary exclusive
      await insertSale(a)
      inserted++
      if (a.createdAt < minTs) minTs = a.createdAt
      if (a.createdAt > maxTs) maxTs = a.createdAt
    }

    // Checkpoint progress so a crash/cap-pause can resume.
    if (mode !== 'incremental' && minTs !== Infinity) await setState('oldest_ts', minTs)
    if (maxTs > newestStored) await setState('newest_ts', Math.max(maxTs, newestStored))

    const nextCursor = page[page.length - 1].createdAt
    if (reqs % 25 === 0) {
      const ago = ((now - pageOldest) / 86400).toFixed(1)
      process.stdout.write(`  ${mode}: ${reqs} reqs, ${inserted} inserted, at ${ago}d ago\r`)
    }
    if (pageOldest <= stopTs) break
    if (nextCursor === cursor) break
    cursor = nextCursor
  }

  const { n, lo, hi } = await db.get(
    'SELECT count(*) AS n, min(day) AS lo, max(day) AS hi FROM sales'
  )
  console.log(
    `\n✅ ${mode} done: +${inserted} sales in ${reqs} reqs (${((Date.now() - t0) / 1000) | 0}s)\n   table now: ${n.toLocaleString()} sales, ${lo} → ${hi}`
  )
}

main().catch((e) => {
  console.error('\n❌ ingest failed:', e.message)
  process.exit(1)
})
