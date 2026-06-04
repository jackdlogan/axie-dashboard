#!/usr/bin/env node
// Builds the token_id -> collectible-collection seed for the Dune spellbook.
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
// reachable. Overlaps (e.g. an Origin with mystic parts, or NightmareShiny) are
// resolved by COLLECTIONS priority order (Mystic > Origin > MEO > Shiny >
// Nightmare > Summer > Japanese > Christmas), matching scripts/lib/collectible.mjs.
//
// Usage: node scripts/export-collection-map.mjs
// Output: dune/seeds/axie_collectible_collections_seed.csv

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from './lib/api.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'dune/seeds/axie_collectible_collections_seed.csv')
const PAGE = 100
const OFFSET_CAP = 10000 // the API stops returning rows past this offset
const CLASSES = ['Beast', 'Aquatic', 'Plant', 'Bug', 'Bird', 'Reptile', 'Mech', 'Dawn', 'Dusk']

// Highest priority first — a token is assigned to the first collection it
// matches. Shiny sits above the part-based collections so that a NightmareShiny
// / SummerShiny counts as Shiny (its rarer, more notable designation).
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
  const assigned = new Map() // token_id -> collection (first match wins = priority)
  for (const [name, criteria] of COLLECTIONS) {
    const ids = await enumerate(criteria)
    let added = 0
    for (const id of ids) {
      const key = String(id)
      if (!assigned.has(key)) {
        assigned.set(key, name)
        added++
      }
    }
    console.log(`  ${name.padEnd(10)} fetched ${ids.length} ids, ${added} newly assigned`)
  }

  const lines = ['token_id,collection']
  for (const [token_id, collection] of assigned) lines.push(`${token_id},${collection}`)
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, lines.join('\n') + '\n')
  console.log(`✅ wrote ${assigned.size} token→collection rows to ${OUT}`)
}

main().catch((e) => {
  console.error('❌ export-collection-map failed:', e.message)
  process.exit(1)
})
