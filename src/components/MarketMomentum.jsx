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

// Threshold (in %) below which a change is treated as "flat" for the regime read.
const FLAT = 3

// Turns a % delta into a short verb clause, e.g. "rose 11.4%" / "fell 6.0%".
function move(p) {
  if (p == null) return 'n/a'
  if (p >= FLAT) return `rose ${p.toFixed(1)}%`
  if (p <= -FLAT) return `fell ${Math.abs(p).toFixed(1)}%`
  return `was flat (${signed(p)})`
}

function classify(volP, buyersP, medianP) {
  const volUp = volP != null && volP > FLAT
  const volDown = volP != null && volP < -FLAT
  const buyersUp = buyersP != null && buyersP > FLAT
  const buyersDown = buyersP != null && buyersP < -FLAT
  const medianDown = medianP != null && medianP < -FLAT
  const medianUp = medianP != null && medianP > FLAT

  // Volume rising while the buyer base and/or floor weakens → top-heavy.
  if (volUp && (buyersDown || medianDown)) return 'whale'
  if (volUp && buyersUp) return 'broad'
  if (volDown && buyersDown) return 'cooling'
  if (volDown || buyersDown || medianDown) return 'soft'
  if (volUp || buyersUp || medianUp) return 'firming'
  return 'flat'
}

const HEADLINES = {
  whale: 'Top-heavy market — volume is holding up on a few large sales while the buyer base thins.',
  broad: 'Broad-based growth — more buyers and higher volume together.',
  cooling: 'Cooling across the board — fewer buyers and lower volume.',
  soft: 'Softening — demand is easing off recent levels.',
  firming: 'Firming up — activity is ticking higher.',
  flat: 'Holding steady — activity is roughly flat versus the prior period.',
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

    const regime = classify(deltas.vol, deltas.buyers, deltas.median)

    const cards = [
      { label: `Volume · ${span}d`, value: compactUsd(vol.cur), delta: deltas.vol },
      { label: `Sales · ${span}d`, value: compactNum(sales.cur), delta: deltas.sales },
      { label: 'Buyers/day', value: compactNum(buyers.cur), delta: deltas.buyers },
      { label: 'Median price', value: usdPrecise(median.cur), delta: deltas.median },
      { label: 'Avg price', value: usdPrecise(avgPrice.cur), delta: deltas.avgPrice },
    ]

    return { vol, sales, buyers, median, avgPrice, deltas, floorDrift, regime, cards }
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
          <p className="summary-headline">{HEADLINES[view.regime]}</p>

          <p className="summary-narrative">
            Over the last {span} days, app.axie booked{' '}
            <strong>{compactNum(view.sales.cur)} sales</strong> for{' '}
            <strong>{compactUsd(view.vol.cur)}</strong> in volume. Volume {move(view.deltas.vol)}{' '}
            and sales {move(view.deltas.sales)} {compareWord}. Buyers averaged{' '}
            {compactNum(view.buyers.cur)}/day ({move(view.deltas.buyers)}), the median sale price
            was {usdPrecise(view.median.cur)} ({move(view.deltas.median)}), and the average
            sale price was {usdPrecise(view.avgPrice.cur)} ({move(view.deltas.avgPrice)}).
          </p>

          {view.regime === 'whale' && (
            <div className="summary-callout">
              <span className="summary-callout-tag">Divergence</span>
              Volume is up {signed(view.deltas.vol)} but buyers are {signed(view.deltas.buyers)} and the
              median is {signed(view.deltas.median)} — the gains are concentrated in a few high-value
              sales, not broad demand. Watch the top sales, not the headline volume.
            </div>
          )}

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
