import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { compactUsd, compactNum, usd, num } from '../format.js'

function VolumeTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{label}</div>
      <div>Volume: {usd(payload[0].payload.volumeUsd)}</div>
      <div>Sales: {num(payload[0].payload.count)}</div>
      <div>Axies sold: {num(payload[0].payload.axieCount)}</div>
    </div>
  )
}

export default function ActivityChart({ data }) {
  return (
    <div className="panel">
      <h2>Sales Volume by Period (USD)</h2>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 10, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#20222b" vertical={false} />
          <XAxis dataKey="period" stroke="#6b7180" tickLine={false} />
          <YAxis
            stroke="#6b7180"
            tickLine={false}
            tickFormatter={(v) => compactUsd(v)}
            width={64}
          />
          <Tooltip content={<VolumeTooltip />} cursor={{ fill: '#ffffff10' }} />
          <Bar dataKey="volumeUsd" fill="#4e6bff" radius={[6, 6, 0, 0]} maxBarSize={90} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
