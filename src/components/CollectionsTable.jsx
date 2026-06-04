import { useMemo, useState } from 'react'
import { usd, num, compactNum } from '../format.js'

// Maps tokensStats field keys -> human labels. Order = default display order.
const COLLECTIONS = [
  ['axie', 'Axie'],
  ['originAxie', 'Origin Axie'],
  ['mysticAxie', 'Mystic Axie'],
  ['shinyAxie', 'Shiny Axie'],
  ['japanAxie', 'Japanese Axie'],
  ['summerAxie', 'Summer Axie'],
  ['nightmareAxie', 'Nightmare Axie'],
  ['xmasAxie', 'Christmas Axie'],
  ['meoAxie', 'MEO Axie'],
  ['land', 'Land'],
  ['landItems', 'Land Items'],
  ['accessories', 'Accessories'],
  ['runes', 'Runes'],
  ['charms', 'Charms'],
  ['materials', 'Materials'],
  ['consumables', 'Consumables'],
]

const COLUMNS = [
  { key: 'name', label: 'Collection', align: 'left' },
  { key: 'floorEth', label: 'Floor (ETH)', align: 'right' },
  { key: 'floorUsd', label: 'Floor (USD)', align: 'right' },
  { key: 'holders', label: 'Unique holders', align: 'right' },
  { key: 'volEth', label: '24h Vol (ETH)', align: 'right' },
  { key: 'volUsd', label: '24h Vol (USD)', align: 'right' },
  { key: 'supply', label: 'Supply', align: 'right' },
]

function fmtEth(n) {
  if (!n) return '—'
  if (n < 0.0001) return n.toExponential(2)
  if (n < 1) return n.toFixed(5)
  return n.toFixed(3)
}

export default function CollectionsTable({ tokensStats, ethUsd }) {
  const [sort, setSort] = useState({ key: 'volUsd', dir: 'desc' })

  const rows = useMemo(() => {
    if (!tokensStats) return []
    return COLLECTIONS.map(([key, name]) => {
      const s = tokensStats[key] || {}
      const floorEth = parseFloat(s.floorPrice) || 0
      const volEth = parseFloat(s.last24HVolume) || 0
      return {
        key,
        name,
        floorEth,
        floorUsd: floorEth * ethUsd,
        holders: Number(s.holders) || 0,
        volEth,
        volUsd: volEth * ethUsd,
        supply: Number(s.totalSupply) || 0,
      }
    })
  }, [tokensStats, ethUsd])

  const sorted = useMemo(() => {
    const r = [...rows]
    r.sort((a, b) => {
      const av = a[sort.key]
      const bv = b[sort.key]
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return r
  }, [rows, sort])

  function toggle(key) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' }
    )
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Collection Analytics</h2>
        <span className="muted small">floor &amp; volume denominated in ETH/WETH · click a header to sort</span>
      </div>
      <table className="sales-table">
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                className={c.align === 'right' ? 'num sortable' : 'sortable'}
                onClick={() => toggle(c.key)}
              >
                {c.label}
                {sort.key === c.key && (sort.dir === 'asc' ? ' ▲' : ' ▼')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.key}>
              <td>{r.name}</td>
              <td className="num">{fmtEth(r.floorEth)}</td>
              <td className="num">{r.floorUsd ? usd(r.floorUsd) : '—'}</td>
              <td className="num">{compactNum(r.holders)}</td>
              <td className="num">{fmtEth(r.volEth)}</td>
              <td className="num strong">{r.volUsd ? usd(r.volUsd) : '—'}</td>
              <td className="num muted">{r.supply ? compactNum(r.supply) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
