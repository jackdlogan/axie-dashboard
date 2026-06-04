import { usdPrecise } from '../format.js'

const TOKENS = [
  { key: 'eth', label: 'ETH' },
  { key: 'ron', label: 'RON' },
  { key: 'axs', label: 'AXS' },
  { key: 'slp', label: 'SLP' },
  { key: 'usdc', label: 'USDC' },
]

export default function RatesBar({ rates }) {
  if (!rates) return null
  return (
    <div className="rates-bar">
      <span className="rates-label">Exchange rates</span>
      {TOKENS.map((t) => (
        <span key={t.key} className="rate-chip">
          <strong>{t.label}</strong> {usdPrecise(rates[t.key]?.usd)}
        </span>
      ))}
    </div>
  )
}
