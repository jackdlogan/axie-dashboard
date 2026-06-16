import { useEffect, useState } from 'react'
import { fetchDashboard } from './api.js'
import { compactUsd, usd, num, compactNum } from './format.js'
import KpiCard from './components/KpiCard.jsx'
import ActivityChart from './components/ActivityChart.jsx'
import TxChart from './components/TxChart.jsx'
import CollectionsTable from './components/CollectionsTable.jsx'
import CollectibleCollections from './components/CollectibleCollections.jsx'
import CollectiblePriceTrends from './components/CollectiblePriceTrends.jsx'
import CollectibleHolderTrends from './components/CollectibleHolderTrends.jsx'
import DuneTrends from './components/DuneTrends.jsx'
import DuneTopSales from './components/DuneTopSales.jsx'
import TopBuyers from './components/TopBuyers.jsx'
import RatesBar from './components/RatesBar.jsx'

// Period-over-period volume trend from the Dune daily series: sum the last `n`
// days vs the `n` days before, return the signed percent change. Sky Mavis is
// the source of truth for the absolute figures, but it only exposes rolling
// buckets (no prior period), so the *trend* badge has to come from Dune.
// NB: never name a binding `window` here (shadows the global Fast Refresh needs).
function windowDelta(rows, n, key = 'volume_usd') {
  if (!rows || rows.length < n * 2) return null
  const sum = (arr) => arr.reduce((a, r) => a + (Number(r[key]) || 0), 0)
  const cur = sum(rows.slice(-n))
  const prev = sum(rows.slice(-n * 2, -n))
  if (!prev) return null
  return ((cur - prev) / prev) * 100
}

export default function App() {
  const [data, setData] = useState(null)
  const [duneDays, setDuneDays] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshedAt, setRefreshedAt] = useState(null)

  function load() {
    setLoading(true)
    setError(null)
    fetchDashboard()
      .then((d) => {
        setData(d)
        setRefreshedAt(new Date())
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // Dune daily series — used only for the period-over-period trend badges.
    // A miss simply means no badges; the headline numbers don't depend on it.
    fetch('/dune-daily.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setDuneDays(d?.days ?? null))
      .catch(() => setDuneDays(null))
  }, [])

  if (loading && !data) {
    return (
      <div className="app">
        <div className="loading-screen">Loading marketplace activity…</div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="app">
        <div className="error-screen">
          <h2>Couldn’t load marketplace data</h2>
          <p className="error-inline">{error}</p>
          <p className="muted">
            Make sure <code>.env</code> exists with a valid <code>SKYMAVIS_API_KEY</code> and
            restart the dev server.
          </p>
          <button className="btn" onClick={load}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  const overall = data.overallMarketStats
  const ms = data.marketStats

  // Per-period rows for the charts, ordered shortest → longest window.
  const periodData = [
    { period: '24h', ...ms.last24Hours },
    { period: '7d', ...ms.last7Days },
    { period: '30d', ...ms.last30Days },
  ]

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Axie Pulse</h1>
          <p className="subtitle">
            Purchase &amp; sale summary · app.axieinfinity.com
          </p>
        </div>
        <div className="header-actions">
          {refreshedAt && (
            <span className="muted small">
              Updated {refreshedAt.toLocaleTimeString()}
            </span>
          )}
          <button className="btn" onClick={load} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      <RatesBar rates={data.exchangeRate} />

      <section className="kpi-grid">
        <KpiCard
          label="Volume · 24h"
          value={compactUsd(ms.last24Hours.volumeUsd)}
          sub={`${num(ms.last24Hours.count)} sales`}
          delta={windowDelta(duneDays, 1)}
          deltaLabel="DoD"
        />
        <KpiCard
          label="Volume · 7d"
          value={compactUsd(ms.last7Days.volumeUsd)}
          sub={`${num(ms.last7Days.count)} sales`}
          delta={windowDelta(duneDays, 7)}
          deltaLabel="WoW"
        />
        <KpiCard
          label="Volume · 30d"
          value={compactUsd(ms.last30Days.volumeUsd)}
          sub={`${num(ms.last30Days.count)} sales`}
          delta={windowDelta(duneDays, 30)}
          deltaLabel="MoM"
        />
        <KpiCard
          label="All-time volume"
          value={compactUsd(overall.mkpVolumeInUsdAllTime)}
          sub={`${compactNum(overall.mkpTxs.allTime)} all-time txs`}
          accent="#2dd4a7"
        />
        <KpiCard
          label="New Axies · 24h"
          value={num(overall.newAxies.last24H)}
          sub={`${compactNum(overall.newAxies.allTime)} all-time`}
          accent="#ffb800"
        />
        <KpiCard
          label="Ascended · 7d"
          value={num(overall.ascendedAxiesLast7D)}
          sub="last 7 days"
          accent="#b06bff"
        />
      </section>

      <p className="muted small kpi-note">
        Headline figures via Sky Mavis marketplace API. ▲/▼ badges show the
        period-over-period trend (on-chain via Dune).
      </p>

      <section className="chart-grid">
        <ActivityChart data={periodData} />
        <TxChart data={periodData} />
      </section>

      <DuneTrends />

      <CollectionsTable
        tokensStats={data.tokensStats}
        ethUsd={Number(data.exchangeRate?.eth?.usd) || 0}
      />

      <CollectibleCollections
        tokensStats={data.tokensStats}
        ethUsd={Number(data.exchangeRate?.eth?.usd) || 0}
      />

      <CollectiblePriceTrends />

      <CollectibleHolderTrends tokensStats={data.tokensStats} />

      <DuneTopSales />

      <TopBuyers />

      <footer className="app-footer">
        Data via Sky Mavis GraphQL API · prices in wei converted to ETH/USD ·
        This dashboard is read-only.
      </footer>
    </div>
  )
}
