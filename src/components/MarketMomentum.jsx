import { useEffect, useMemo, useState } from 'react'
import { compactUsd, compactNum, usdPrecise } from '../format.js'

// Sum a metric over the last `n` rows and the `n` rows before that, so we can
// show a period-over-period delta.
// NOTE: do not name this `window` — that shadows the global the React Fast
// Refresh preamble depends on, which blanks the app in dev.
function sumWindow(rows, n, key) {
  const cur = rows.slice(-n)
  const prev = rows.slice(-n * 2, -n)
  const sum = (arr) => arr.reduce((a, r) => a + (Number(r[key]) || 0), 0)
  return { cur: sum(cur), prev: sum(prev) }
}

// Volume-weighted average price over a window (total volume / total sales).
function avgPriceWindow(rows, n) {
  const v = sumWindow(rows, n, 'volume_usd')
  const s = sumWindow(rows, n, 'axie_sales')
  const div = (a, b) => (b ? a / b : null)
  return { cur: div(v.cur, s.cur), prev: div(v.prev, s.prev) }
}

// Mean of a daily metric over a window (for per-day series like buyers/median).
function meanWindow(rows, n, key) {
  const w = sumWindow(rows, n, key)
  return { cur: w.cur / n, prev: w.prev / n }
}

function pct(cur, prev) {
  if (cur == null || prev == null || prev === 0) return null
  return ((cur - prev) / prev) * 100
}

// "+12.3%" / "−6.0%" with an explicit sign, for inline narrative use.
function signed(p) {
  if (p == null) return '—'
  const s = p >= 0 ? '+' : '−'
  return `${s}${Math.abs(p).toFixed(1)}%`
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

  const view = useMemo(() => {
    if (rows.length < span * 2) return null
    const vol = sumWindow(rows, span, 'volume_usd')
    const sales = sumWindow(rows, span, 'axie_sales')
    const buyers = meanWindow(rows, span, 'unique_buyers') // avg buyers/day
    const median = meanWindow(rows, span, 'median_usd')
    const avgPrice = avgPriceWindow(rows, span)

    const deltas = {
      vol: pct(vol.cur, vol.prev),
      sales: pct(sales.cur, sales.prev),
      buyers: pct(buyers.cur, buyers.prev),
      median: pct(median.cur, median.prev),
      avgPrice: pct(avgPrice.cur, avgPrice.prev),
    }

    // Long-run floor drift: median over the first `span` days of the whole
    // series vs the most recent `span` days.
    const firstMedian =
      rows.slice(0, span).reduce((a, r) => a + (Number(r.median_usd) || 0), 0) / span
    const floorDrift = pct(median.cur, firstMedian)

    const cards = [
      { label: `Volume · ${span}d`, value: compactUsd(vol.cur), delta: deltas.vol },
      { label: `Sales · ${span}d`, value: compactNum(sales.cur), delta: deltas.sales },
      { label: 'Buyers/day', value: compactNum(buyers.cur), delta: deltas.buyers },
      { label: 'Median price', value: usdPrecise(median.cur), delta: deltas.median },
      { label: 'Avg price', value: usdPrecise(avgPrice.cur), delta: deltas.avgPrice },
    ]

    return { vol, sales, buyers, median, avgPrice, deltas, floorDrift, cards }
  }, [rows, span])

  if (error) {
    return (
      <div className="panel">
        <h2>Market Summary</h2>
        <p className="error-inline small">{error}</p>
      </div>
    )
  }
  if (!data) return <div className="panel muted">Loading market summary…</div>

  const periodWord = span === 7 ? 'week' : 'month'
  const compareWord = span === 7 ? 'week over week' : 'month over month'

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Market Summary</h2>
        <div className="seg">
          <button className={span === 7 ? 'seg-btn active' : 'seg-btn'} onClick={() => setSpan(7)}>
            WoW
          </button>
          <button className={span === 30 ? 'seg-btn active' : 'seg-btn'} onClick={() => setSpan(30)}>
            MoM
          </button>
        </div>
      </div>

      {!view ? (
        <p className="muted small">
          Not enough history for a {compareWord} summary yet (need {span * 2} days).
        </p>
      ) : (
        <>
          <div className="mom-grid">
            {view.cards.map((c) => (
              <div key={c.label} className="mom-card">
                <div className="kpi-label">{c.label}</div>
                <div className="mom-value">{c.value}</div>
                <Delta value={c.delta} />
              </div>
            ))}
          </div>

          <p className="muted small">
            Floor (median sale) is {signed(view.floorDrift)} across the tracked{' '}
            {data.totals.ndays} days · {compactNum(data.totals.sales)} sales /{' '}
            {compactUsd(data.totals.volume_usd)} all-time · on-chain via Dune, as of{' '}
            {new Date(data.generatedAt).toLocaleDateString()}. Compares the last {span} days
            with the prior {span} ({periodWord} over {periodWord}).
          </p>
        </>
      )}
    </div>
  )
}
