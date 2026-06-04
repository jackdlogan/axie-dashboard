import { useEffect, useState } from 'react'
import { fetchTopSales } from '../api.js'
import { weiToToken, usdPrecise, timeAgo } from '../format.js'

const PERIODS = [
  { id: 'Last24H', label: '24h' },
  { id: 'Last7D', label: '7d' },
  { id: 'Last30D', label: '30d' },
]

const CLASS_COLORS = {
  Beast: '#ffb800',
  Aquatic: '#00b2ff',
  Plant: '#6abe30',
  Bug: '#ff5252',
  Bird: '#ff8fc7',
  Reptile: '#b06bff',
  Mech: '#8a90a6',
  Dawn: '#7c8cff',
  Dusk: '#3ad1c4',
}

export default function TopSalesTable() {
  const [period, setPeriod] = useState('Last24H')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchTopSales(period)
      .then((results) => {
        if (!cancelled) setRows(results)
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [period])

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Top Axie Sales</h2>
        <div className="seg">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              className={p.id === period ? 'seg-btn active' : 'seg-btn'}
              onClick={() => setPeriod(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error-inline">Failed to load: {error}</div>}
      {loading && <div className="muted">Loading top sales…</div>}

      {!loading && !error && (
        <table className="sales-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Axie</th>
              <th>Class</th>
              <th className="num">Price (ETH)</th>
              <th className="num">Price (USD)</th>
              <th className="num">When</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const axie = r.asset?.token ?? {}
              const color = CLASS_COLORS[axie.class] ?? '#8a90a6'
              return (
                <tr key={r.orderId ?? i}>
                  <td className="rank">{i + 1}</td>
                  <td>
                    <a
                      className="axie-cell"
                      href={`https://app.axieinfinity.com/marketplace/axies/${axie.id}/`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {axie.image && <img src={axie.image} alt="" loading="lazy" />}
                      <span>{axie.name || `Axie #${axie.id}`}</span>
                    </a>
                  </td>
                  <td>
                    <span className="class-badge" style={{ background: color + '22', color }}>
                      {axie.class || '—'}
                    </span>
                  </td>
                  <td className="num">{weiToToken(r.settlePrice).toFixed(4)}</td>
                  <td className="num strong">{usdPrecise(r.settlePriceUsd)}</td>
                  <td className="num muted">{timeAgo(r.timestamp)}</td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="muted center">
                  No sales found for this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}
