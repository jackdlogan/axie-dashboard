import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { usd, compactUsd, num, compactNum } from '../format.js'
import { fetchCollectibleFloors } from '../api.js'

// The special "collectible" collections only — excludes the base Axie pool and
// non-Axie collections (land, items, runes, …). Each gets a stable accent color
// reused across the chart and table. `liveKey` ties a collection to the live
// order-book floor when the search API can address it (see fetchCollectibleFloors);
// the rest fall back to the cached tokensStats floor.
const COLLECTIBLES = [
  ['originAxie', 'Origin', '#5b8cff', 'origin'],
  ['mysticAxie', 'Mystic', '#b06bff', 'mystic'],
  ['shinyAxie', 'Shiny', '#2dd4a7', 'shiny'],
  ['japanAxie', 'Japanese', '#ff6b6b', 'japan'],
  ['summerAxie', 'Summer', '#ffb800', 'summer'],
  ['nightmareAxie', 'Nightmare', '#8a90a6', 'nightmare'],
  ['xmasAxie', 'Christmas', '#6abe30', 'xmas'],
  ['meoAxie', 'MEO', '#ff8fc7', 'meo'],
]

const CHART_METRICS = [
  { id: 'marketCapUsd', label: 'Market cap' },
  { id: 'floorUsd', label: 'Floor' },
  { id: 'volUsd', label: '24h Vol' },
  { id: 'holders', label: 'Holders' },
  { id: 'supply', label: 'Supply' },
]

// Columns for the derived-metrics table. `derived` marks the analytics that the
// existing Collection Analytics table doesn't already show.
const COLUMNS = [
  { key: 'label', label: 'Collection', align: 'left' },
  { key: 'floorUsd', label: 'Floor (USD)', align: 'right' },
  { key: 'marketCapUsd', label: 'Market cap', align: 'right', derived: true },
  { key: 'supply', label: 'Supply', align: 'right' },
  { key: 'holders', label: 'Holders', align: 'right' },
  { key: 'avgHolding', label: 'Avg / holder', align: 'right', derived: true },
  { key: 'volUsd', label: '24h Vol', align: 'right' },
  { key: 'turnoverPct', label: 'Turnover', align: 'right', derived: true },
]

const isUsd = (k) => k === 'floorUsd' || k === 'marketCapUsd' || k === 'volUsd'

function fmtCell(key, v) {
  if (v == null || (typeof v === 'number' && !Number.isFinite(v))) return '—'
  if (key === 'turnoverPct') return v ? v.toFixed(2) + '%' : '—'
  if (key === 'avgHolding') return v ? v.toFixed(1) : '—'
  if (isUsd(key)) return v ? usd(v) : '—'
  if (key === 'label') return v
  return v ? num(v) : '—'
}

function chartFmt(metric, v) {
  return isUsd(metric) ? compactUsd(v) : compactNum(v)
}

export default function CollectibleCollections({ tokensStats, ethUsd }) {
  const [metric, setMetric] = useState('marketCapUsd')
  const [sort, setSort] = useState({ key: 'marketCapUsd', dir: 'desc' })
  // Live order-book floors for the addressable collections; null until loaded,
  // and a failed fetch simply leaves every collection on its cached floor.
  const [liveFloors, setLiveFloors] = useState(null)

  useEffect(() => {
    let alive = true
    fetchCollectibleFloors()
      .then((f) => alive && setLiveFloors(f))
      .catch(() => alive && setLiveFloors({})) // fall back to cached floors
    return () => {
      alive = false
    }
  }, [])

  const rows = useMemo(() => {
    if (!tokensStats) return []
    return COLLECTIBLES.map(([key, label, color, liveKey]) => {
      const s = tokensStats[key] || {}
      const cachedFloorEth = parseFloat(s.floorPrice) || 0
      const live = liveKey ? liveFloors?.[liveKey] : null
      const floorLive = live != null && live > 0
      const floorEth = floorLive ? live : cachedFloorEth
      const volEth = parseFloat(s.last24HVolume) || 0
      const supply = Number(s.totalSupply) || 0
      const holders = Number(s.holders) || 0
      const floorUsd = floorEth * ethUsd
      const volUsd = volEth * ethUsd
      const marketCapUsd = floorUsd * supply
      return {
        key,
        label,
        color,
        floorEth,
        floorUsd,
        floorLive,
        addressable: !!liveKey,
        volUsd,
        supply,
        holders,
        marketCapUsd,
        avgHolding: holders ? supply / holders : null,
        turnoverPct: marketCapUsd ? (volUsd / marketCapUsd) * 100 : null,
      }
    })
  }, [tokensStats, ethUsd, liveFloors])

  const hasData = rows.some((r) => r.marketCapUsd > 0)

  const totals = useMemo(
    () => ({
      marketCap: rows.reduce((a, r) => a + (r.marketCapUsd || 0), 0),
      vol: rows.reduce((a, r) => a + (r.volUsd || 0), 0),
      count: rows.filter((r) => r.marketCapUsd > 0).length,
    }),
    [rows]
  )

  const chartData = useMemo(
    () => [...rows].sort((a, b) => (b[metric] || 0) - (a[metric] || 0)),
    [rows, metric]
  )

  const tableRows = useMemo(() => {
    const r = [...rows]
    r.sort((a, b) => {
      const av = a[sort.key]
      const bv = b[sort.key]
      if (typeof av === 'string') return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      const cmp = (av ?? -Infinity) - (bv ?? -Infinity)
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return r
  }, [rows, sort])

  function toggleSort(key) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'label' ? 'asc' : 'desc' }
    )
  }

  if (!hasData) {
    return (
      <div className="panel">
        <h2>Collectible Axies — Deep Dive</h2>
        <p className="muted small">No collectible stats available right now.</p>
      </div>
    )
  }

  const metricLabel = CHART_METRICS.find((m) => m.id === metric)?.label

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Collectible Axies — Deep Dive</h2>
        <div className="seg">
          {CHART_METRICS.map((m) => (
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
          <strong>{compactUsd(totals.marketCap)}</strong> floor-implied market cap
        </span>
        <span>
          <strong>{compactUsd(totals.vol)}</strong> 24h volume
        </span>
        <span className="muted small">
          {totals.count} special collections · floor × supply · live via Sky Mavis
        </span>
      </div>

      <ResponsiveContainer width="100%" height={Math.max(220, chartData.length * 34)}>
        <BarChart
          layout="vertical"
          data={chartData}
          margin={{ top: 4, right: 24, left: 8, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#20222b" horizontal={false} />
          <XAxis
            type="number"
            stroke="#6b7180"
            tickLine={false}
            tickFormatter={(v) => chartFmt(metric, v)}
          />
          <YAxis
            type="category"
            dataKey="label"
            stroke="#6b7180"
            tickLine={false}
            width={84}
          />
          <Tooltip
            cursor={{ fill: '#ffffff08' }}
            contentStyle={{
              background: '#161922',
              border: '1px solid #20222b',
              borderRadius: 8,
            }}
            labelStyle={{ color: '#f4f5f7', fontWeight: 600 }}
            itemStyle={{ color: '#9aa0ae' }}
            formatter={(v) => [chartFmt(metric, v), metricLabel]}
          />
          <Bar dataKey={metric} radius={[0, 4, 4, 0]}>
            {chartData.map((r) => (
              <Cell key={r.key} fill={r.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <table className="sales-table" style={{ marginTop: 14 }}>
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                className={
                  (c.align === 'right' ? 'num sortable' : 'sortable') + (c.derived ? ' derived-col' : '')
                }
                onClick={() => toggleSort(c.key)}
                title={c.derived ? 'Derived analytic' : undefined}
              >
                {c.label}
                {c.derived ? ' *' : ''}
                {sort.key === c.key && (sort.dir === 'asc' ? ' ▲' : ' ▼')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tableRows.map((r) => (
            <tr key={r.key}>
              <td>
                <span className="class-badge" style={{ background: r.color + '22', color: r.color }}>
                  {r.label}
                </span>
              </td>
              <td className="num">
                {fmtCell('floorUsd', r.floorUsd)}
                {r.floorLive ? (
                  <span className="floor-live" title="Live order-book floor (cheapest active listing)">
                    {' '}live
                  </span>
                ) : (
                  <span className="muted floor-cached" title="Cached snapshot floor (tokensStats); may lag the live order book">
                    {' '}~
                  </span>
                )}
              </td>
              <td className="num strong">{fmtCell('marketCapUsd', r.marketCapUsd)}</td>
              <td className="num">{fmtCell('supply', r.supply)}</td>
              <td className="num">{fmtCell('holders', r.holders)}</td>
              <td className="num">{fmtCell('avgHolding', r.avgHolding)}</td>
              <td className="num">{fmtCell('volUsd', r.volUsd)}</td>
              <td className="num">{fmtCell('turnoverPct', r.turnoverPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        Floor: <span className="floor-live">live</span> = cheapest active listing (all collections,
        via the search API); <span className="floor-cached">~</span> = cached tokensStats fallback,
        used only if a live floor is unavailable.
        <br />
        <strong>*</strong> derived: market cap = floor × supply · avg/holder = supply ÷ holders ·
        turnover = 24h volume ÷ market cap.
      </p>
    </div>
  )
}
