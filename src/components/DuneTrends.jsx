import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { usd, num, compactUsd, compactNum } from '../format.js'

const METRICS = [
  { id: 'volume_usd', label: 'Volume (USD)' },
  { id: 'price', label: 'Price (median + p25–p95)' },
  { id: 'axie_sales', label: 'Sales' },
  { id: 'unique_buyers', label: 'Buyers' },
]

function fmt(metric, v) {
  if (v == null) return '—'
  if (metric === 'volume_usd') return compactUsd(v)
  if (metric === 'price') return '$' + Number(v).toFixed(2)
  return compactNum(v)
}

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{label}</div>
      <div>Volume: {usd(d.volume_usd)}</div>
      <div>Sales: {num(d.axie_sales)} · Buyers: {num(d.unique_buyers)}</div>
      <div>
        Median ${d.median_usd?.toFixed(2)} · p95 ${d.p95_usd?.toFixed(2)}
      </div>
    </div>
  )
}

export default function DuneTrends() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [metric, setMetric] = useState('volume_usd')

  useEffect(() => {
    fetch('/dune-daily.json')
      .then((r) => {
        if (!r.ok) throw new Error(`dune-daily.json not found (HTTP ${r.status})`)
        return r.json()
      })
      .then(setData)
      .catch((e) => setError(e.message))
  }, [])

  const rows = useMemo(() => data?.days ?? [], [data])

  if (error) {
    return (
      <div className="panel">
        <h2>app.axie Sales — 90 Days</h2>
        <p className="muted">
          No Dune data yet — run <code>node scripts/ingest-dune.mjs --run</code>.
        </p>
        <p className="error-inline small">{error}</p>
      </div>
    )
  }
  if (!data) return <div className="panel muted">Loading 90-day trends…</div>

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>app.axie Sales — 90 Days</h2>
        <div className="seg">
          {METRICS.map((m) => (
            <button
              key={m.id}
              className={m.id === metric ? 'seg-btn active' : 'seg-btn'}
              onClick={() => setMetric(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="history-totals">
        <span><strong>{num(data.totals.sales)}</strong> sales</span>
        <span><strong>{compactUsd(data.totals.volume_usd)}</strong> volume</span>
        <span className="muted small">
          {data.totals.ndays}d · on-chain via Dune · as of{' '}
          {new Date(data.generatedAt).toLocaleDateString()}
        </span>
      </div>

      <ResponsiveContainer width="100%" height={330}>
        <ComposedChart data={rows} margin={{ top: 10, right: 16, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="duneFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5b8cff" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#5b8cff" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2f45" vertical={false} />
          <XAxis dataKey="day" stroke="#8a90a6" tickLine={false} minTickGap={28}
                 tickFormatter={(d) => String(d).slice(5)} />
          <YAxis stroke="#8a90a6" tickLine={false} width={64}
                 tickFormatter={(v) => fmt(metric, v)} />
          <Tooltip content={<TrendTooltip />} cursor={{ stroke: '#ffffff30' }} />

          {metric === 'price' ? (
            <>
              {/* p25–p95 spread as faint lines, median emphasized */}
              <Line dataKey="p95_usd" stroke="#ffb80055" dot={false} strokeWidth={1} />
              <Line dataKey="p75_usd" stroke="#2dd4a755" dot={false} strokeWidth={1} />
              <Line dataKey="median_usd" stroke="#2dd4a7" dot={false} strokeWidth={2} />
              <Line dataKey="p25_usd" stroke="#2dd4a755" dot={false} strokeWidth={1} />
            </>
          ) : (
            <Area type="monotone" dataKey={metric} stroke="#5b8cff" strokeWidth={2}
                  fill="url(#duneFill)" />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      {metric === 'price' && (
        <p className="muted small">
          Bold = median sale price · faint lines = p25 / p75 / p95. Most Axies sell near
          the floor; the p95 line shows the high-end tail.
        </p>
      )}
    </div>
  )
}
