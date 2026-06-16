#!/usr/bin/env node
// Builds the (token_id, collection) seed for the Dune spellbook.
//
// Why a seed (and not on-chain SQL): a collection like Mystic / Nightmare is
// defined by an Axie's genes/parts, which aren't available in decoded form on
// Ronin. We enumerate membership from the Sky Mavis `axies` search instead,
// using the per-collection criteria filters (numMystic / numNightmare / … and
// `title` for Origin / MEO).
//
// The search caps reachable offset at 10,000, so collections larger than that
// (Summer ~53k, Nightmare ~34k, Japanese ~17k) are partitioned by class — and,
// if a class slice is still over the cap, by breedCount — so every token is
// reachable.
//
// MULTI-MEMBERSHIP: a token is emitted once per collection it belongs to (no
// priority dedup). Many Axies are in two collections (e.g. a Christmas+Nightmare,
// or an Origin with mystic parts), and Sky Mavis counts each collection
// independently — so attributing a token to a single "primary" collection makes
// every overlapping collection's holder/median run low vs app.axie. One row per
// (token, collection) makes the Dune holders + price queries (which GROUP BY
// collection) match Sky Mavis. The single "most notable" label used for top-sale
// display lives in scripts/lib/collectible.mjs (off the Axie's own fields), not
// this seed, so it is unaffected.
//
// Usage: node scripts/export-collection-map.mjs
// Output: dune/seeds/axie_collectible_collections_seed.csv (one row per membership)

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from './lib/api.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'dune/seeds/axie_collectible_collections_seed.csv')
const PAGE = 100
const OFFSET_CAP = 10000 // the API stops returning rows past this offset
const CLASSES = ['Beast', 'Aquatic', 'Plant', 'Bug', 'Bird', 'Reptile', 'Mech', 'Dawn', 'Dusk']

// Every collection + its search criteria. Order is irrelevant now (multi-
// membership: a token is recorded for each collection it matches, not just one).
const COLLECTIONS = [
  ['Mystic', { numMystic: [1, 2, 3, 4, 5, 6] }],
  ['Origin', { title: ['Origin'] }],
  ['MEO', { title: ['MEO Corp', 'MEO Corp II'] }],
  ['Shiny', { numShiny: [1, 2, 3, 4, 5, 6] }],
  ['Nightmare', { numNightmare: [1, 2, 3, 4, 5, 6] }],
  ['Summer', { numSummer: [1, 2, 3, 4, 5, 6] }],
  ['Japanese', { numJapan: [1, 2, 3, 4, 5, 6] }],
  ['Christmas', { numXmas: [1, 2, 3, 4, 5, 6] }],
]

const QUERY = `query($criteria: AxieSearchCriteria, $from: Int!, $size: Int!) {
  axies(auctionType: All, criteria: $criteria, sort: IdAsc, from: $from, size: $size) {
    total
    results { id }
  }
}`

const gql = createClient()

async function page(criteria, from, size) {
  const { data } = await gql(QUERY, { criteria, from, size })
  const a = data.axies
  return { total: a.total, ids: (a.results ?? []).map((r) => r.id) }
}

// Paginate one criteria up to the offset cap.
async function collect(criteria) {
  const ids = []
  for (let from = 0; from < OFFSET_CAP; from += PAGE) {
    const { ids: batch } = await page(criteria, from, PAGE)
    ids.push(...batch)
    if (batch.length < PAGE) break
  }
  return ids
}

// Enumerate all ids for a criteria, partitioning to stay under the offset cap.
async function enumerate(criteria, depth = 0) {
  const { total } = await page(criteria, 0, 1)
  if (total === 0) return []
  if (total <= OFFSET_CAP) return collect(criteria)

  // Too many to reach by offset alone — split into smaller buckets.
  const ids = []
  if (depth === 0) {
    for (const cls of CLASSES) ids.push(...(await enumerate({ ...criteria, classes: [cls] }, 1)))
  } else if (depth === 1) {
    for (let bc = 0; bc <= 7; bc++) ids.push(...(await enumerate({ ...criteria, breedCount: [bc] }, 2)))
  } else {
    // Out of partition dimensions; take what we can and warn about the shortfall.
    console.warn(`⚠️  partition still over cap (total=${total}): ${JSON.stringify(criteria)}`)
    ids.push(...(await collect(criteria)))
  }
  return ids
}

async function main() {
  const rows = [] // [token_id, collection] — one per membership (multi-membership)
  const memberships = new Map() // token_id -> count, for stats only
  for (const [name, criteria] of COLLECTIONS) {
    const { total } = await page(criteria, 0, 1) // API's own count, for a completeness guard
    const ids = await enumerate(criteria)
    const uniq = [...new Set(ids.map(String))] // partitions are disjoint, but be safe
    // Guard against a future enumeration regression (cap/partition shortfall).
    if (total && uniq.length < total * 0.98) {
      console.warn(`⚠️  ${name}: enumerated ${uniq.length} but API reports ${total} — possible shortfall`)
    }
    for (const id of uniq) {
      rows.push([id, name])
      memberships.set(id, (memberships.get(id) || 0) + 1)
    }
    console.log(`  ${name.padEnd(10)} ${String(uniq.length).padStart(6)} members  (API total ${total})`)
  }

  const lines = ['token_id,collection']
  for (const [token_id, collection] of rows) lines.push(`${token_id},${collection}`)
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, lines.join('\n') + '\n')
  const multi = [...memberships.values()].filter((n) => n > 1).length
  console.log(
    `✅ wrote ${rows.length} (token,collection) rows · ${memberships.size} distinct tokens · ` +
      `${multi} in >1 collection → ${OUT}`
  )
}

main().catch((e) => {
  console.error('❌ export-collection-map failed:', e.message)
  process.exit(1)
})
