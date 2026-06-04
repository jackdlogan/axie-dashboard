// `accent` is accepted for backward compatibility but no longer rendered —
// the dark editorial system keeps KPI cards monochrome.
export default function KpiCard({ label, value, sub }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  )
}
