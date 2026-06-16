// `accent` is accepted for backward compatibility but no longer rendered —
// the dark editorial system keeps KPI cards monochrome.
//
// `delta` (a signed percent) and `deltaLabel` (e.g. "WoW") render an optional
// period-over-period badge. The headline `value` is Sky Mavis (source of truth);
// the delta is the on-chain trend from Dune, since only Dune carries the prior
// period needed to compute a change. They're paired because Dune's undercount
// ratio is roughly stable, so the trend direction holds even if the absolute
// differs — the tooltip makes the source explicit.
export default function KpiCard({ label, value, sub, delta, deltaLabel }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {delta != null && (
        <div
          className={delta >= 0 ? 'kpi-delta up' : 'kpi-delta down'}
          title={`${deltaLabel ? deltaLabel + ' — ' : ''}period-over-period, on-chain trend via Dune`}
        >
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
          {deltaLabel && <span className="kpi-delta-tag"> {deltaLabel}</span>}
        </div>
      )}
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  )
}
