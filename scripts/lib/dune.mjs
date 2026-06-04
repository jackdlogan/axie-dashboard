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

  async function req(path, init) {
    const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...init?.headers } })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Dune ${res.status} ${res.statusText} on ${path} ${body.slice(0, 200)}`)
    }
    return res.json()
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
