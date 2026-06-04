import { useEffect, useMemo, useState } from 'react'
import { compactUsd, compactNum, usdPrecise } from '../format.js'

// Sums a metric over the last `n` days of the series, and over the `n` days
// before that, so we can show a period-over-period delta. Returns nulls when
// there isn't enough history to form both windows.
// NOTE: do not name this `window` — that shadows the global the React Fast
// Refresh preamble depends on, which blanks the app in dev.
function sumWindow(rows, n, key) {
  if (rows.length < n * 2) return { current: null, prev: null }
  const current = rows.slice(-n)
  const prev = rows.slice(-n * 2, -n)
  const sum = (arr) => arr.reduce((a, r) => a + (Number(r[key]) || 0), 0)
  return { current: sum(current), prev: sum(prev) }
}

// Average price = total volume / total sales over the same window (weighted,
// not a mean-of-dailies — matches how the headline volume/sales relate).
function avgPriceWindow(rows, n) {
  const vol = sumWindow(rows, n, 'volume_usd')
  const sales = sumWindow(rows, n, 'axie_sales')
  const div = (v, s) => (s ? v / s : null)
  return { current: div(vol.current, sales.current), prev: div(vol.prev, sales.prev) }
}

function pct(current, prev) {
  if (current == null || prev == null || prev === 0) return null
  return ((current - prev) / prev) * 100
}

function Delta({ value }) {
  if (value == null) return <span className="mom-delta muted">—</span>
  const up = value >= 0
  return (
    <span className={up ? 'mom-delta up' : 'mom-delta down'}>
      {up ? '▲' : '▼'} {Math.abs(value).toFixed(1)}%
    </span>
  )
}

const CARDS = [
  { id: 'volume_usd', label: 'Volume', fmt: compactUsd, agg: sumWindow },
  { id: 'axie_sales', label: 'Sales', fmt: compactNum, agg: sumWindow },
  { id: 'unique_buyers', label: 'Buyers', fmt: compactNum, agg: sumWindow },
  { id: 'avg_price', label: 'Avg price', fmt: usdPrecise, agg: avgPriceWindow },
]

export default function MarketMomentum() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [span, setSpan] = useState(7) // 7 = WoW, 30 = MoM

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

  const cards = useMemo(
    () =>
      CARDS.map((c) => {
        const w = c.agg(rows, span, c.id)
        return { ...c, ...w, delta: pct(w.current, w.prev) }
      }),
    [rows, span]
  )

  if (error) {
    return (
      <div className="panel">
        <h2>Market Momentum</h2>
        <p className="error-inline small">{error}</p>
      </div>
    )
  }
  if (!data) return <div className="panel muted">Loading momentum…</div>

  const enough = rows.length >= span * 2
  const label = span === 7 ? 'week over week' : 'month over month'

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Market Momentum</h2>
        <div className="seg">
          <button className={span === 7 ? 'seg-btn active' : 'seg-btn'} onClick={() => setSpan(7)}>
            WoW
          </button>
          <button className={span === 30 ? 'seg-btn active' : 'seg-btn'} onClick={() => setSpan(30)}>
            MoM
          </button>
        </div>
      </div>

      {!enough ? (
        <p className="muted small">
          Not enough history for a {label} comparison yet (need {span * 2} days).
        </p>
      ) : (
        <>
          <div className="mom-grid">
            {cards.map((c) => (
              <div key={c.id} className="mom-card">
                <div className="kpi-label">{c.label}</div>
                <div className="mom-value">{c.fmt(c.current)}</div>
                <Delta value={c.delta} />
              </div>
            ))}
          </div>
          <p className="muted small">
            Last {span} days vs the prior {span}, {label} · on-chain via Dune.
          </p>
        </>
      )}
    </div>
  )
}
