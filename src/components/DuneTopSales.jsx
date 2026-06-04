import { useEffect, useState } from 'react'
import { usdPrecise } from '../format.js'

// Collection accent colors, matched to the Collectible Axies deep-dive panel.
const COLLECTIBLE_COLORS = {
  Origin: '#5b8cff', Mystic: '#b06bff', Shiny: '#2dd4a7', Japanese: '#ff6b6b',
  Summer: '#ffb800', Nightmare: '#8a90a6', Christmas: '#6abe30', MEO: '#ff8fc7',
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
            <th>Collectible</th>
            <th className="num">Price</th>
            <th className="num">USD</th>
          </tr>
        </thead>
        <tbody>
          {sales.map((s, i) => {
            const color = COLLECTIBLE_COLORS[s.collectible] ?? '#8a90a6'
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
                  {s.collectible ? (
                    <span className="class-badge" style={{ background: color + '22', color }}>
                      {s.collectible}
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
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
