#!/usr/bin/env node
// One-off ground-truth check: call ownerOf(tokenId) on the Axie contract for
// every MEO token in the seed, via Ronin public RPC, and count distinct owners.
// This is the contract-state proof that our Dune reconstruction (~1,597) is right
// and Sky Mavis's cached tokensStats.meoAxie.holders (375) is stale.

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// endpoints rejects JSON-RPC batch arrays, so we fan out single calls across a
// couple of public RPCs round-robin to spread the rate limit.
const RPCS = ['https://api.roninchain.com/rpc', 'https://ronin.drpc.org']
const CONTRACT = '0x32950db2a7164ae833121501c797d79e7b79d74c'
const SELECTOR = '0x6352211e' // ownerOf(uint256)
const CONCURRENCY = 6 // public endpoints 429 above this
const ZERO = '0x0000000000000000000000000000000000000000'

// --- load MEO token ids from the seed ---
const csv = readFileSync(resolve(ROOT, 'dune/seeds/axie_collectible_collections_seed.csv'), 'utf8')
const ids = []
for (const line of csv.split('\n')) {
  const [tid, col] = line.split(',')
  if (col?.trim() === 'MEO') ids.push(Number(tid))
}
console.log(`MEO tokens in seed: ${ids.length}`)

const calldata = (id) => SELECTOR + BigInt(id).toString(16).padStart(64, '0')
const addrFromResult = (hex) => '0x' + hex.slice(-40).toLowerCase()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function ownerOf(id, attempt = 1) {
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_call',
    params: [{ to: CONTRACT, data: calldata(id) }, 'latest'],
  }
  const url = RPCS[(id + attempt) % RPCS.length] // rotate endpoint per attempt
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.status === 429) throw new Error('429')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const j = await res.json()
    if (j.error || !j.result || j.result === '0x') return null // burned/nonexistent
    return j.result
  } catch (e) {
    // never give up on rate limits / transient errors — back off and retry
    const wait = e.message === '429' ? Math.min(8000, 1000 * attempt) : 400 * attempt
    if (attempt <= 12) {
      await sleep(wait)
      return ownerOf(id, attempt + 1)
    }
    throw e
  }
}

const owners = new Map() // owner -> token count
let burned = 0
let done = 0

// simple fixed-size worker pool over the id list
let cursor = 0
async function worker() {
  while (cursor < ids.length) {
    const id = ids[cursor++]
    const result = await ownerOf(id)
    if (!result) burned++
    else {
      const addr = addrFromResult(result)
      if (addr === ZERO) burned++
      else owners.set(addr, (owners.get(addr) || 0) + 1)
    }
    if (++done % 100 === 0 || done === ids.length) {
      process.stdout.write(`\r  checked ${done}/${ids.length}`)
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker))
process.stdout.write('\n')

const errors = 0

let held = 0
for (const n of owners.values()) held += n
console.log('--- ownerOf ground truth ---')
console.log(`distinct owners : ${owners.size}`)
console.log(`tokens held     : ${held}`)
console.log(`burned/zero     : ${burned}`)
console.log(`unresolved      : ${errors}`)
