#!/usr/bin/env node
// Enriches the top-sale token_ids with trait metadata (name/class/image) from
// the Sky Mavis API, then re-exports dune-top-sales.json with that metadata
// joined in. Bounded: only fetches token_ids not already cached in axie_meta,
// batched 100 per request — typically 1 request.
//
// Usage: node scripts/enrich-axies.mjs

import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from './lib/db.mjs'
import { createClient } from './lib/api.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = resolve(ROOT, 'public')

const QUERY = `query($ids: [ID!]) {
  axies(axieIds: $ids, size: 100) {
    results { id name class image breedCount }
  }
}`

async function main() {
  const db = await openDb()
  const gql = createClient()

  const need = await db.all(
    `SELECT DISTINCT token_id FROM dune_top_sales
     WHERE token_id <> '' AND token_id NOT IN (SELECT token_id FROM axie_meta)`
  )
  const ids = need.map((r) => r.token_id)

  if (ids.length) {
    const ins = await db.prepare(
      `INSERT INTO axie_meta (token_id, name, axie_class, image, breed_count, fetched_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT (token_id) DO UPDATE SET
         name=excluded.name, axie_class=excluded.axie_class,
         image=excluded.image, breed_count=excluded.breed_count, fetched_at=excluded.fetched_at`
    )
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100)
      const { data } = await gql(QUERY, { ids: batch })
      for (const a of data.axies?.results ?? []) {
        ins.bindVarchar(1, String(a.id))
        ins.bindVarchar(2, a.name ?? '')
        ins.bindVarchar(3, a.class ?? '')
        ins.bindVarchar(4, a.image ?? '')
        ins.bindInteger(5, Number(a.breedCount ?? 0))
        ins.bindVarchar(6, new Date().toISOString())
        await ins.run()
      }
    }
  }

  // Re-export top sales joined with metadata.
  const rows = await db.all(`
    SELECT t.tx_hash, t.token_id, t.block_time, t.buyer, t.currency,
           t.price, t.price_usd,
           m.name AS name, m.axie_class AS cls, m.image AS image
    FROM dune_top_sales t
    LEFT JOIN axie_meta m USING (token_id)
    ORDER BY t.price_usd DESC NULLS LAST`)
  writeFileSync(
    resolve(PUBLIC, 'dune-top-sales.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), sales: rows }, null, 2)
  )

  console.log(`✅ enriched ${ids.length} new axies; exported ${rows.length} top sales with traits`)
}

main().catch((e) => {
  console.error('❌ enrich failed:', e.message)
  process.exit(1)
})
