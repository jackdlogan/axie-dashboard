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
  { id: 'avg_price_usd', label: 'Avg price' },
  { id: 'axie_sales', label: 'Sales' },
  { id: 'unique_buyers', label: 'Buyers' },
]

function fmt(metric, v) {
  if (v == null) return '—'
  if (metric === 'volume_usd') return compactUsd(v)
  if (metric === 'price' || metric === 'avg_price_usd') return '$' + Number(v).toFixed(2)
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

  // Derive a per-day average price (volume / sales) so it can be charted like
  // any other daily metric.
  const rows = useMemo(
    () =>
      (data?.days ?? []).map((d) => ({
        ...d,
        avg_price_usd: d.axie_sales ? d.volume_usd / d.axie_sales : null,
      })),
    [data]
  )

  if (error) {
    return (
      <div className="panel">
        <h2>app.axie Sales Trend</h2>
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
        <h2>app.axie Sales — {data.totals.ndays} Days</h2>
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
          on-chain via Dune · as of{' '}
          {new Date(data.generatedAt).toLocaleDateString()}
        </span>
      </div>

      <ResponsiveContainer width="100%" height={330}>
        <ComposedChart data={rows} margin={{ top: 10, right: 16, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="duneFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4e6bff" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#4e6bff" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#20222b" vertical={false} />
          <XAxis dataKey="day" stroke="#6b7180" tickLine={false} minTickGap={28}
                 tickFormatter={(d) => String(d).slice(5)} />
          <YAxis stroke="#6b7180" tickLine={false} width={64}
                 tickFormatter={(v) => fmt(metric, v)} />
          <Tooltip content={<TrendTooltip />} cursor={{ stroke: '#ffffff30' }} />

          {metric === 'price' ? (
            <>
              {/* p25–p95 spread as faint lines, median emphasized */}
              <Line dataKey="p95_usd" stroke="#34d39966" dot={false} strokeWidth={1} />
              <Line dataKey="p75_usd" stroke="#4e6bff55" dot={false} strokeWidth={1} />
              <Line dataKey="median_usd" stroke="#4e6bff" dot={false} strokeWidth={2} />
              <Line dataKey="p25_usd" stroke="#4e6bff55" dot={false} strokeWidth={1} />
            </>
          ) : (
            <Area type="monotone" dataKey={metric} stroke="#4e6bff" strokeWidth={2}
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
