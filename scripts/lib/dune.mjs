// Dune Analytics API client.
//
// Two ways to get a query's data:
//   • latest(queryId)  — returns the LAST cached execution's rows. Cheap (no
//     execution credits). Use when a fresh run isn't needed every time.
//   • run(queryId)     — executes the query fresh, polls until done, returns
//     rows. Spends execution credits; use on the hourly refresh.
// Both paginate transparently.
//
// Needs a paid Dune plan with API access. Key is read from DUNE_API_KEY
// (env or project .env).

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const BASE = 'https://api.dune.com/api/v1'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function loadDuneKey() {
  if (process.env.DUNE_API_KEY) return process.env.DUNE_API_KEY
  for (const f of ['.env', '.env.local']) {
    const p = resolve(ROOT, f)
    if (existsSync(p)) {
      const line = readFileSync(p, 'utf8')
        .split('\n')
        .find((l) => l.startsWith('DUNE_API_KEY='))
      if (line) return line.slice('DUNE_API_KEY='.length).trim()
    }
  }
  throw new Error('DUNE_API_KEY not found in env or .env')
}

export function createDuneClient({ key = loadDuneKey() } = {}) {
  const headers = { 'X-Dune-API-Key': key }

  // Transient failures (network blips, rate limits, gateway errors) should be
  // retried with exponential backoff rather than aborting the whole ingest.
  // 4xx other than 429 are permanent (bad query id, auth) — fail fast.
  const RETRIABLE = new Set([408, 429, 500, 502, 503, 504])
  const MAX_TRIES = 5

  async function req(path, init) {
    let lastErr
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      let res
      try {
        res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...init?.headers } })
      } catch (e) {
        // Network-level error (DNS, reset, timeout) — always retriable.
        lastErr = e
        if (attempt === MAX_TRIES) throw e
        await backoff(attempt, res)
        continue
      }
      if (res.ok) return res.json()

      const body = await res.text().catch(() => '')
      lastErr = new Error(`Dune ${res.status} ${res.statusText} on ${path} ${body.slice(0, 200)}`)
      if (!RETRIABLE.has(res.status) || attempt === MAX_TRIES) throw lastErr
      console.warn(`Dune ${res.status} on ${path} — retry ${attempt}/${MAX_TRIES - 1}`)
      await backoff(attempt, res)
    }
    throw lastErr
  }

  // Exponential backoff (1s, 2s, 4s, 8s) with jitter; honors Retry-After when
  // the server sends it on a 429.
  async function backoff(attempt, res) {
    const retryAfter = Number(res?.headers?.get?.('retry-after'))
    const base = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** (attempt - 1) * 1000
    await sleep(base + Math.random() * 250)
  }

  // Walk paginated results for a completed execution or saved query.
  async function fetchAllRows(path) {
    const rows = []
    let offset = 0
    const limit = 1000
    while (true) {
      const j = await req(`${path}?limit=${limit}&offset=${offset}`)
      const batch = j.result?.rows ?? []
      rows.push(...batch)
      if (batch.length < limit) break
      offset += limit
    }
    return rows
  }

  return {
    // Last cached results — no execution spent.
    async latest(queryId) {
      return fetchAllRows(`/query/${queryId}/results`)
    },

    // Execute fresh, poll to completion, return rows.
    async run(queryId, { pollMs = 2500, timeoutMs = 600_000, params } = {}) {
      const exec = await req(`/query/${queryId}/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params ? { query_parameters: params } : {}),
      })
      const execId = exec.execution_id
      const deadline = Date.now() + timeoutMs
      while (true) {
        const s = await req(`/execution/${execId}/status`)
        if (s.state === 'QUERY_STATE_COMPLETED') break
        if (s.state === 'QUERY_STATE_FAILED' || s.state === 'QUERY_STATE_CANCELLED') {
          throw new Error(`Dune execution ${execId} ${s.state}`)
        }
        if (Date.now() > deadline) throw new Error(`Dune execution ${execId} timed out`)
        await sleep(pollMs)
      }
      return fetchAllRows(`/execution/${execId}/results`)
    },
  }
}
