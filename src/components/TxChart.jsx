import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { compactNum, num } from '../format.js'

function TxTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{label}</div>
      <div>Sales: {num(payload[0].payload.count)}</div>
      <div>Axies sold: {num(payload[0].payload.axieCount)}</div>
    </div>
  )
}

export default function TxChart({ data }) {
  return (
    <div className="panel">
      <h2>Number of Sales by Period</h2>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 10, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#20222b" vertical={false} />
          <XAxis dataKey="period" stroke="#6b7180" tickLine={false} />
          <YAxis
            stroke="#6b7180"
            tickLine={false}
            tickFormatter={(v) => compactNum(v)}
            width={48}
          />
          <Tooltip content={<TxTooltip />} cursor={{ fill: '#ffffff10' }} />
          <Bar dataKey="count" fill="#8aa0ff" radius={[6, 6, 0, 0]} maxBarSize={90} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
