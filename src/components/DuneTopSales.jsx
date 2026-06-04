import { useEffect, useState } from 'react'
import { usdPrecise } from '../format.js'

const CLASS_COLORS = {
  Beast: '#ffb800', Aquatic: '#00b2ff', Plant: '#6abe30', Bug: '#ff5252',
  Bird: '#ff8fc7', Reptile: '#b06bff', Mech: '#8a90a6', Dawn: '#7c8cff', Dusk: '#3ad1c4',
}

export default function DuneTopSales() {
  const [sales, setSales] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('/dune-top-sales.json')
      .then((r) => {
        if (!r.ok) throw new Error(`dune-top-sales.json not found (HTTP ${r.status})`)
        return r.json()
      })
      .then((d) => setSales(d.sales))
      .catch((e) => setError(e.message))
  }, [])

  if (error) {
    return (
      <div className="panel">
        <h2>Top Axie Sales — 7 Days</h2>
        <p className="error-inline small">{error}</p>
      </div>
    )
  }
  if (!sales) return <div className="panel muted">Loading top sales…</div>

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Top Axie Sales — 7 Days</h2>
        <span className="muted small">on-chain via Dune · settled prices</span>
      </div>
      <table className="sales-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Axie</th>
            <th>Class</th>
            <th className="num">Price</th>
            <th className="num">USD</th>
          </tr>
        </thead>
        <tbody>
          {sales.map((s, i) => {
            const color = CLASS_COLORS[s.cls] ?? '#8a90a6'
            return (
              <tr key={s.tx_hash + s.token_id}>
                <td className="rank">{i + 1}</td>
                <td>
                  <a className="axie-cell"
                     href={`https://app.axieinfinity.com/marketplace/axies/${s.token_id}/`}
                     target="_blank" rel="noreferrer">
                    {s.image && <img src={s.image} alt="" loading="lazy" />}
                    <span>{s.name || `Axie #${s.token_id}`}</span>
                  </a>
                </td>
                <td>
                  <span className="class-badge" style={{ background: color + '22', color }}>
                    {s.cls || '—'}
                  </span>
                </td>
                <td className="num">{s.price?.toFixed(4)} {s.currency}</td>
                <td className="num strong">{usdPrecise(s.price_usd)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
