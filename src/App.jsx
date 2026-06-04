import { useEffect, useState } from 'react'
import { fetchDashboard } from './api.js'
import { compactUsd, usd, num, compactNum } from './format.js'
import KpiCard from './components/KpiCard.jsx'
import ActivityChart from './components/ActivityChart.jsx'
import TxChart from './components/TxChart.jsx'
import CollectionsTable from './components/CollectionsTable.jsx'
import DuneTrends from './components/DuneTrends.jsx'
import DuneTopSales from './components/DuneTopSales.jsx'
import RatesBar from './components/RatesBar.jsx'

export default function App() {
  const [data, setData] = useState(null)
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
          <h1>Axie Marketplace Activity</h1>
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
          accent="#5b8cff"
        />
        <KpiCard
          label="Volume · 7d"
          value={compactUsd(ms.last7Days.volumeUsd)}
          sub={`${num(ms.last7Days.count)} sales`}
          accent="#5b8cff"
        />
        <KpiCard
          label="Volume · 30d"
          value={compactUsd(ms.last30Days.volumeUsd)}
          sub={`${num(ms.last30Days.count)} sales`}
          accent="#5b8cff"
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

      <section className="chart-grid">
        <ActivityChart data={periodData} />
        <TxChart data={periodData} />
      </section>

      <DuneTrends />

      <CollectionsTable
        tokensStats={data.tokensStats}
        ethUsd={Number(data.exchangeRate?.eth?.usd) || 0}
      />

      <DuneTopSales />

      <footer className="app-footer">
        Data via Sky Mavis GraphQL API · prices in wei converted to ETH/USD ·
        This dashboard is read-only.
      </footer>
    </div>
  )
}
