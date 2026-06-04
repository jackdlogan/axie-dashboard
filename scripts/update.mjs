#!/usr/bin/env node
// Hourly update orchestrator — keeps the warehouse current after the one-time
// backfill is complete. Designed to be run by cron every hour. Each step is
// idempotent and safe to re-run; steps run sequentially so they never contend
// for the DuckDB writer lock. A lockfile prevents overlapping runs.
//
// Steps (Dune-spine pipeline):
//   1. ingest-dune.mjs --run  — refresh daily metrics + top sales from Dune → DuckDB → JSON
//   2. enrich-axies.mjs       — fetch traits for any new top-sale token_ids (Sky Mavis)
//
// Usage: node scripts/update.mjs

import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LOCK = resolve(ROOT, 'data/.update.lock')

function run(script, args = []) {
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, [resolve(ROOT, script), ...args], {
      cwd: ROOT,
      stdio: 'inherit',
    })
    p.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${script} exited ${code}`))))
    p.on('error', rej)
  })
}

async function main() {
  // Prevent overlapping runs (mkdir is atomic; cron may fire while a slow run
  // is still going). Stale locks older than 2h are cleared.
  mkdirSync(resolve(ROOT, 'data'), { recursive: true })
  if (existsSync(LOCK)) {
    console.error('Another update is in progress (lock present) — skipping this run.')
    process.exit(0)
  }
  mkdirSync(LOCK)
  const stamp = new Date().toISOString()
  try {
    console.log(`\n=== update ${stamp} ===`)
    await run('scripts/ingest-dune.mjs', ['--run']) // refresh from Dune → DuckDB → JSON
    await run('scripts/enrich-axies.mjs') // traits for new top-sale token_ids
    console.log(`=== update done ${new Date().toISOString()} ===`)
  } finally {
    rmSync(LOCK, { recursive: true, force: true })
  }
}

main().catch((e) => {
  console.error('❌ update failed:', e.message)
  process.exit(1)
})
