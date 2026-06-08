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
import { usdPrecise, compactUsd, eth, compactEth } from '../format.js'

// Shared collection accent colors (match the deep-dive panel and top sales).
const COLORS = {
  Origin: '#5b8cff', Mystic: '#b06bff', Shiny: '#2dd4a7', Japanese: '#ff6b6b',
  Summer: '#ffb800', Nightmare: '#8a90a6', Christmas: '#6abe30', MEO: '#ff8fc7',
}

function PriceTooltip({ active, payload, label, fmt }) {
  if (!active || !payload?.length) return null
  const rows = payload
    .filter((p) => p.value != null)
    .sort((a, b) => b.value - a.value)
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{label}</div>
      {rows.map((p) => (
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.dataKey}: <span style={{ color: 'var(--text)' }}>{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export default function CollectiblePriceTrends() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [cur, setCur] = useState('weth') // 'weth' | 'usd'
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
  // WETH-denominated series (ETH-equivalent), falling back to empty when the
  // Dune query hasn't been updated to emit median_weth yet.
  const rowsWeth = useMemo(() => data?.daysWeth ?? [], [data])
  const rowsUsd = useMemo(() => data?.days ?? [], [data])
  const rows = cur === 'weth' ? rowsWeth : rowsUsd
  const wethReady = rowsWeth.length > 0

  const cellFmt = cur === 'weth' ? eth : usdPrecise
  const axisFmt = cur === 'weth' ? compactEth : compactUsd

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

  const unitLabel = cur === 'weth' ? 'WETH (Ξ)' : 'USD'

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Collectible Price History</h2>
        <div className="seg-row">
          <div className="seg">
            <button className={cur === 'weth' ? 'seg-btn active' : 'seg-btn'} onClick={() => setCur('weth')}>
              WETH
            </button>
            <button className={cur === 'usd' ? 'seg-btn active' : 'seg-btn'} onClick={() => setCur('usd')}>
              USD
            </button>
          </div>
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
        Daily median settle price ({unitLabel}) per collectible · on-chain via Dune · click a
        collection to toggle
        {cur === 'weth' && ' · ETH-equivalent, so the ETH/USD rate moving doesn’t skew the trend'}
      </p>

      {cur === 'weth' && !wethReady ? (
        <p className="muted small">
          WETH series isn’t populated yet. Update the saved Dune query to also return{' '}
          <code>median_weth</code> (see <code>dune/README.md</code>), then run{' '}
          <code>node scripts/ingest-dune.mjs --run</code>. Switch to USD to view the current data.
        </p>
      ) : (
        <>
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
                tickFormatter={(v) => axisFmt(v)}
              />
              <Tooltip content={<PriceTooltip fmt={cellFmt} />} cursor={{ stroke: '#ffffff30' }} />
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
        </>
      )}
    </div>
  )
}
