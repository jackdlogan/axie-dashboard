import { useEffect, useMemo, useState } from 'react'
import { usdPrecise, num } from '../format.js'

const short = (addr) => (addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '—')

// Roll the top-sale rows up by buyer address: total spend and number of buys.
function rollup(sales) {
  const byBuyer = new Map()
  for (const s of sales) {
    if (!s.buyer) continue
    const b = byBuyer.get(s.buyer) ?? { buyer: s.buyer, spend: 0, buys: 0 }
    b.spend += Number(s.price_usd) || 0
    b.buys += 1
    byBuyer.set(s.buyer, b)
  }
  return [...byBuyer.values()].sort((a, b) => b.spend - a.spend)
}

export default function TopBuyers() {
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

  const buyers = useMemo(() => (sales ? rollup(sales).slice(0, 10) : []), [sales])

  if (error) {
    return (
      <div className="panel">
        <h2>Top Buyers</h2>
        <p className="error-inline small">{error}</p>
      </div>
    )
  }
  if (!sales) return <div className="panel muted">Loading top buyers…</div>

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Top Buyers</h2>
        <span className="muted small">by spend across recent top sales · via Dune</span>
      </div>
      <table className="sales-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Buyer</th>
            <th className="num">Buys</th>
            <th className="num">Total spent</th>
          </tr>
        </thead>
        <tbody>
          {buyers.map((b, i) => (
            <tr key={b.buyer}>
              <td className="rank">{i + 1}</td>
              <td>
                <a
                  href={`https://app.roninchain.com/address/${b.buyer}`}
                  target="_blank"
                  rel="noreferrer"
                  className="axie-cell"
                  title={b.buyer}
                >
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{short(b.buyer)}</span>
                </a>
              </td>
              <td className="num">{num(b.buys)}</td>
              <td className="num strong">{usdPrecise(b.spend)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
