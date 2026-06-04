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
import { usdPrecise, compactUsd } from '../format.js'

// Shared collection accent colors (match the deep-dive panel and top sales).
const COLORS = {
  Origin: '#5b8cff', Mystic: '#b06bff', Shiny: '#2dd4a7', Japanese: '#ff6b6b',
  Summer: '#ffb800', Nightmare: '#8a90a6', Christmas: '#6abe30', MEO: '#ff8fc7',
}

function PriceTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const rows = payload
    .filter((p) => p.value != null)
    .sort((a, b) => b.value - a.value)
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{label}</div>
      {rows.map((p) => (
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.dataKey}: <span style={{ color: 'var(--text)' }}>{usdPrecise(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export default function CollectiblePriceTrends() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [scale, setScale] = useState('log') // 'log' | 'linear'
  const [hidden, setHidden] = useState(() => new Set())

  useEffect(() => {
    fetch('/dune-collectible-prices.json')
      .then((r) => {
        if (!r.ok) throw new Error(`dune-collectible-prices.json not found (HTTP ${r.status})`)
        return r.json()
      })
      .then(setData)
      .catch((e) => setError(e.message))
  }, [])

  const collections = useMemo(() => data?.collections ?? [], [data])
  const rows = useMemo(() => data?.days ?? [], [data])

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
        <h2>Collectible Price History</h2>
        <p className="muted">
          No collectible price series yet — set <code>DUNE_QUERY_COLLECTIBLE_PRICES</code> and run{' '}
          <code>node scripts/ingest-dune.mjs --run</code>.
        </p>
        <p className="error-inline small">{error}</p>
      </div>
    )
  }
  if (!data) return <div className="panel muted">Loading collectible price history…</div>

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Collectible Price History</h2>
        <div className="seg">
          <button className={scale === 'log' ? 'seg-btn active' : 'seg-btn'} onClick={() => setScale('log')}>
            Log
          </button>
          <button className={scale === 'linear' ? 'seg-btn active' : 'seg-btn'} onClick={() => setScale('linear')}>
            Linear
          </button>
        </div>
      </div>

      <p className="muted small" style={{ marginTop: 0, marginBottom: 14 }}>
        Daily median settle price (USD) per collectible · on-chain via Dune · click a collection to toggle
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
            tickFormatter={(v) => compactUsd(v)}
          />
          <Tooltip content={<PriceTooltip />} cursor={{ stroke: '#ffffff30' }} />
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
