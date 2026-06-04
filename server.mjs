#!/usr/bin/env node
// Production server. Does in prod what the Vite dev proxy does in dev:
//   1. POST /api/graphql  -> forwards to Sky Mavis with the X-API-Key header
//      injected server-side, so the key never reaches the browser.
//   2. Serves the Dune JSON from public/ *live* (no-cache) so the data-refresh
//      cron (scripts/update.mjs) is reflected without rebuilding.
//   3. Serves the built SPA from dist/ (run `npm run build` first).
//
// Env: SKYMAVIS_API_KEY (required), PORT (default 8080), HOST (default 0.0.0.0).

import express from 'express'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { env } from './scripts/lib/env.mjs'

const ROOT = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 8080
const HOST = process.env.HOST || '0.0.0.0'
const API_KEY = env('SKYMAVIS_API_KEY')
const UPSTREAM = 'https://api-gateway.skymavis.com/graphql/axie-marketplace'
const DIST = resolve(ROOT, 'dist')

if (!API_KEY) {
  console.error('❌ SKYMAVIS_API_KEY is not set (env or .env). Refusing to start.')
  process.exit(1)
}
if (!existsSync(resolve(DIST, 'index.html'))) {
  console.error('❌ dist/ not found. Run `npm run build` before starting the server.')
  process.exit(1)
}

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))

// --- GraphQL proxy: inject the API key server-side ---
app.post('/api/graphql', async (req, res) => {
  try {
    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
      body: JSON.stringify(req.body),
    })
    const body = await upstream.text()
    res.status(upstream.status).type('application/json').send(body)
  } catch (err) {
    console.error('proxy error:', err.message)
    res.status(502).json({ errors: [{ message: 'Upstream request failed' }] })
  }
})

// --- Live data: serve public/*.json fresh so the refresh cron shows up ---
app.use(
  express.static(resolve(ROOT, 'public'), {
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  })
)

// --- Built app (hashed assets can cache hard; index.html should not) ---
app.use(express.static(DIST, { index: false }))
// SPA fallback. Express 5 routing rejects a bare '*' path, so use a terminal
// middleware (the GraphQL POST and static assets are already handled above).
app.use((_req, res) => {
  res.setHeader('Cache-Control', 'no-cache')
  res.sendFile(resolve(DIST, 'index.html'))
})

app.listen(PORT, HOST, () => {
  console.log(`✅ axie-dashboard listening on http://${HOST}:${PORT}`)
})
