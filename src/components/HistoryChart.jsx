import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { usd, num, compactUsd, compactNum } from '../format.js'

const METRICS = [
  { id: 'volumeUsd', label: 'Volume (USD)', color: '#5b8cff' },
  { id: 'count', label: 'Sales', color: '#2dd4a7' },
  { id: 'avgPriceEth', label: 'Avg price (ETH)', color: '#ffb800' },
]

function fmtAxis(metric, v) {
  if (metric === 'volumeUsd') return compactUsd(v)
  if (metric === 'count') return compactNum(v)
  return v < 1 ? v.toFixed(4) : v.toFixed(2)
}

function HistoryTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{label}</div>
      <div>Volume: {usd(d.volumeUsd)}</div>
      <div>Sales: {num(d.count)}</div>
      <div>Avg price: {d.avgPriceEth.toFixed(4)} ETH</div>
    </div>
  )
}

export default function HistoryChart() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [metric, setMetric] = useState('volumeUsd')

  useEffect(() => {
    fetch('/history-90d.json')
      .then((r) => {
        if (!r.ok) throw new Error(`history file not found (HTTP ${r.status})`)
        return r.json()
      })
      .then(setData)
      .catch((e) => setError(e.message))
  }, [])

  const rows = useMemo(() => {
    if (!data) return []
    const eth = data.ethUsdAtGen || 0
    return data.days.map((d) => ({
      ...d,
      volumeUsd: d.volumeEth * eth,
    }))
  }, [data])

  const active = METRICS.find((m) => m.id === metric)

  if (error) {
    return (
      <div className="panel">
        <h2>90-Day Axie Sales History</h2>
        <p className="muted">
          No history data yet — run{' '}
          <code>node scripts/backfill-history.mjs --full</code> to build{' '}
          <code>public/history-90d.json</code>, then refresh.
        </p>
        <p className="error-inline small">{error}</p>
      </div>
    )
  }

  if (!data) return <div className="panel muted">Loading 90-day history…</div>

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>90-Day Axie Sales History</h2>
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
        <span>
          <strong>{num(data.totals.sales)}</strong> sales
        </span>
        <span>
          <strong>{data.totals.volumeEth.toFixed(1)} ETH</strong> volume
        </span>
        <span>
          <strong>{compactUsd(data.totals.volumeUsdApprox)}</strong> (approx)
        </span>
        <span className="muted small">
          {data.days.length}d · as of {new Date(data.generatedAt).toLocaleDateString()}
        </span>
      </div>

      <ResponsiveContainer width="100%" height={320}>
        <AreaChart data={rows} margin={{ top: 10, right: 16, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="histFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={active.color} stopOpacity={0.5} />
              <stop offset="100%" stopColor={active.color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2f45" vertical={false} />
          <XAxis
            dataKey="date"
            stroke="#8a90a6"
            tickLine={false}
            minTickGap={28}
            tickFormatter={(d) => d.slice(5)} /* MM-DD */
          />
          <YAxis
            stroke="#8a90a6"
            tickLine={false}
            width={64}
            tickFormatter={(v) => fmtAxis(metric, v)}
          />
          <Tooltip content={<HistoryTooltip />} cursor={{ stroke: '#ffffff30' }} />
          <Area
            type="monotone"
            dataKey={metric}
            stroke={active.color}
            strokeWidth={2}
            fill="url(#histFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
      <p className="muted small">
        USD is approximate — converted at the ETH rate when the file was generated
        (${Math.round(data.ethUsdAtGen).toLocaleString()}/ETH), not per-day historical rates.
      </p>
    </div>
  )
}
