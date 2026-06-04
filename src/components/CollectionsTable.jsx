import { useMemo, useState } from 'react'
import { usd, usd4, compactNum } from '../format.js'

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
  ['materials', 'Materials'],
  ['consumables', 'Consumables'],
]

// Collection badge icons from the Axie marketplace CDN. Most live under
// /badge/<slug>.png; Nightmare uses a different /icon-nightmare.png path.
// Collections not listed here (base Axie, Land, Materials, Consumables) have no
// badge and fall back to a neutral placeholder.
const ICON_BASE = 'https://cdn.axieinfinity.com/marketplace-website/asset-icon'
const COLLECTION_ICONS = {
  axie: `${ICON_BASE}/axie-tab-icon.png`,
  originAxie: `${ICON_BASE}/badge/origin.png`,
  mysticAxie: `${ICON_BASE}/badge/mystic.png`,
  shinyAxie: `${ICON_BASE}/badge/shiny.png`,
  japanAxie: `${ICON_BASE}/badge/japan.png`,
  summerAxie: `${ICON_BASE}/badge/summer.png`,
  nightmareAxie: `${ICON_BASE}/icon-nightmare.png`,
  xmasAxie: `${ICON_BASE}/badge/xmas.png`,
  meoAxie: `${ICON_BASE}/badge/meo.png`,
  land: `${ICON_BASE}/land-tab-icon.png`,
  materials: `${ICON_BASE}/material-tab-icon.png`,
  consumables: 'https://cdn.axieinfinity.com/marketplace-website/consumables/consumables.png',
}

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
              <td>
                <span className="coll-cell">
                  {COLLECTION_ICONS[r.key] ? (
                    <img
                      className="coll-icon"
                      src={COLLECTION_ICONS[r.key]}
                      alt=""
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.style.visibility = 'hidden'
                      }}
                    />
                  ) : (
                    <span className="coll-icon coll-icon--none" />
                  )}
                  <span>{r.name}</span>
                </span>
              </td>
              <td className="num">{fmtEth(r.floorEth)}</td>
              <td className="num">{r.floorUsd ? usd4(r.floorUsd) : '—'}</td>
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
