import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { num, compactNum } from '../format.js'

// Shared collection accent colors (match the deep-dive + price-history panels).
const COLORS = {
  Origin: '#5b8cff', Mystic: '#b06bff', Shiny: '#2dd4a7', Japanese: '#ff6b6b',
  Summer: '#ffb800', Nightmare: '#8a90a6', Christmas: '#6abe30', MEO: '#ff8fc7',
}

// Map our collection label → the tokensStats key Sky Mavis uses. The historical
// series is reconstructed from Dune; the *latest* point is pinned to this live,
// authoritative count (the same source app.axie shows) so "now" always matches.
const LIVE_KEY = {
  Origin: 'originAxie', Mystic: 'mysticAxie', Shiny: 'shinyAxie', Japanese: 'japanAxie',
  Summer: 'summerAxie', Nightmare: 'nightmareAxie', Christmas: 'xmasAxie', MEO: 'meoAxie',
}

// Collections whose live Sky Mavis holder count is STALE and must not override the
// on-chain reconstruction. MEO: Sky Mavis reports 375, which is exactly the on-chain
// owner count from ~May 2021 — the index froze there and never updated, while the
// collection grew to ~1,597 today (verified on-chain two ways). So for MEO the
// accurate series is our reconstruction; we skip the live-anchor for it.
const STALE_LIVE_HOLDERS = new Set(['MEO'])

function HolderTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const rows = payload
    .filter((p) => p.value != null)
    .sort((a, b) => b.value - a.value)
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{label}</div>
      {rows.map((p) => (
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.dataKey}: <span style={{ color: 'var(--text)' }}>{num(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export default function CollectibleHolderTrends({ tokensStats }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [scale, setScale] = useState('linear') // 'log' | 'linear'
  const [hidden, setHidden] = useState(() => new Set())

  useEffect(() => {
    fetch('/dune-collectible-holders.json')
      .then((r) => {
        if (!r.ok) throw new Error(`dune-collectible-holders.json not found (HTTP ${r.status})`)
        return r.json()
      })
      .then(setData)
      .catch((e) => setError(e.message))
  }, [])

  const collections = useMemo(() => data?.collections ?? [], [data])
  // Reconstructed history with the latest point anchored to the live Sky Mavis
  // holder count per collection — the canonical "now" value app.axie reports.
  // This corrects both the few-hour Dune index lag and any token→collection seed
  // drift at the current tip (e.g. a stale MEO mapping) without touching history.
  const rows = useMemo(() => {
    const base = data?.days ?? []
    if (!base.length || !tokensStats) return base
    const out = base.slice()
    const last = { ...out[out.length - 1] }
    for (const c of collections) {
      if (STALE_LIVE_HOLDERS.has(c)) continue // keep the on-chain tip; live value is frozen
      const live = Number(tokensStats[LIVE_KEY[c]]?.holders)
      if (Number.isFinite(live) && live > 0) last[c] = live
    }
    out[out.length - 1] = last
    return out
  }, [data, tokensStats, collections])

  function toggle(c) {
    setHidden((prev) => {
      const next = new Set(prev)
      next.has(c) ? next.delete(c) : next.add(c)
      return next
    })
  }

  if (error) {
    return (
      <div className="panel">
        <h2>Holders Over Time</h2>
        <p className="muted">
          No collectible holder series yet — set <code>DUNE_QUERY_COLLECTIBLE_HOLDERS</code> and run{' '}
          <code>node scripts/ingest-dune.mjs --run</code>.
        </p>
        <p className="error-inline small">{error}</p>
      </div>
    )
  }
  if (!data) return <div className="panel muted">Loading holders over time…</div>

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Holders Over Time</h2>
        <div className="seg-row">
          <div className="seg">
            <button className={scale === 'log' ? 'seg-btn active' : 'seg-btn'} onClick={() => setScale('log')}>
              Log
            </button>
            <button className={scale === 'linear' ? 'seg-btn active' : 'seg-btn'} onClick={() => setScale('linear')}>
              Linear
            </button>
          </div>
        </div>
      </div>

      <p className="muted small" style={{ marginTop: 0, marginBottom: 14 }}>
        Distinct holders per collectible (addresses owning ≥1 token) · history reconstructed on-chain
        from ERC-721 transfers via Dune, latest point pinned to the live Sky Mavis count · click a
        collection to toggle. Evolution-based collections (Nightmare) start at their event launch, so
        their early ramp is approximate. MEO uses the on-chain count throughout (Sky Mavis’s live
        holder figure for MEO is stale, frozen at its ~2021 value).
      </p>

      <div className="legend">
        {collections.map((c) => {
          const off = hidden.has(c)
          const color = COLORS[c] ?? '#8a90a6'
          return (
            <button
              key={c}
              className="legend-chip"
              onClick={() => toggle(c)}
              style={{ opacity: off ? 0.35 : 1 }}
            >
              <span className="legend-dot" style={{ background: color }} />
              {c}
            </button>
          )
        })}
      </div>

      <ResponsiveContainer width="100%" height={360}>
        <LineChart data={rows} margin={{ top: 10, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#20222b" vertical={false} />
          <XAxis dataKey="day" stroke="#6b7180" tickLine={false} minTickGap={28}
                 tickFormatter={(d) => String(d).slice(5)} />
          <YAxis
            stroke="#6b7180"
            tickLine={false}
            width={64}
            scale={scale}
            domain={scale === 'log' ? ['auto', 'auto'] : [0, 'auto']}
            allowDataOverflow
            tickFormatter={(v) => compactNum(v)}
          />
          <Tooltip content={<HolderTooltip />} cursor={{ stroke: '#ffffff30' }} />
          {collections.map((c) =>
            hidden.has(c) ? null : (
              <Line
                key={c}
                type="monotone"
                dataKey={c}
                stroke={COLORS[c] ?? '#8a90a6'}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            )
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
