// Rate-limit-aware Sky Mavis GraphQL client.
//
// The API publishes its budget in response headers:
//   x-ratelimit-remaining-second / -minute / -hour / -day
// The binding limits are 300/min and 5,000/hour. This client paces itself off
// those headers: it slows down as the minute budget runs low, and when the
// hourly budget is exhausted it waits (rather than hammering and failing) until
// the rolling window frees up. On 429 it backs off with an escalating sleep.

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const ENDPOINT = 'https://api-gateway.skymavis.com/graphql/axie-marketplace'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function loadKey() {
  if (process.env.SKYMAVIS_API_KEY) return process.env.SKYMAVIS_API_KEY
  for (const f of ['.env', '.env.example']) {
    const p = resolve(ROOT, f)
    if (existsSync(p)) {
      const line = readFileSync(p, 'utf8')
        .split('\n')
        .find((l) => l.startsWith('SKYMAVIS_API_KEY='))
      if (line) return line.slice('SKYMAVIS_API_KEY='.length).trim()
    }
  }
  throw new Error('SKYMAVIS_API_KEY not found in env or .env')
}

const numHeader = (res, name) => {
  const v = Number(res.headers.get(name))
  return Number.isFinite(v) ? v : Infinity
}

export function createClient({ key = loadKey(), onWait } = {}) {
  async function gql(query, variables, attempt = 0) {
    let res
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
        body: JSON.stringify({ query, variables }),
      })
    } catch (err) {
      if (attempt >= 6) throw err
      await sleep(500 * 2 ** attempt)
      return gql(query, variables, attempt + 1)
    }

    if (res.status === 429) {
      // Rolling windows free up gradually; escalate the wait, retry generously.
      const reset = numHeader(res, 'ratelimit-reset')
      const wait = Math.min(60_000, Math.max(reset * 1000 || 1000, 1000 * 2 ** Math.min(attempt, 6)))
      onWait?.({ reason: '429', ms: wait })
      await sleep(wait)
      return gql(query, variables, attempt + 1)
    }
    if (res.status >= 500) {
      if (attempt >= 6) throw new Error(`HTTP ${res.status}`)
      await sleep(500 * 2 ** attempt)
      return gql(query, variables, attempt + 1)
    }

    const remMin = numHeader(res, 'x-ratelimit-remaining-minute')
    const remHour = numHeader(res, 'x-ratelimit-remaining-hour')

    const json = await res.json()
    if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '))

    // Proactive pacing so we rarely actually hit a 429.
    if (remHour <= 1) {
      onWait?.({ reason: 'hour-budget', ms: 60_000 })
      await sleep(60_000) // hour budget gone — pause and let the window roll
    } else if (remMin <= 2) {
      await sleep(2_000)
    }

    return { data: json.data, remMin, remHour }
  }
  return gql
}
