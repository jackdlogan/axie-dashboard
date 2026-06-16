import { usdPrecise } from '../format.js'

const TOKENS = [
  { key: 'eth', label: 'ETH' },
  { key: 'axs', label: 'AXS' },
  { key: 'slp', label: 'SLP' },
  { key: 'usdc', label: 'USDC' },
]

// Sub-cent tokens (e.g. SLP) round to $0.00 with 2 decimals — show enough
// decimals to surface the first significant digits instead.
const rateUsdFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumSignificantDigits: 4,
})

const formatRate = (n) => {
  const v = Number(n) || 0
  return v !== 0 && Math.abs(v) < 1 ? rateUsdFmt.format(v) : usdPrecise(v)
}

export default function RatesBar({ rates }) {
  if (!rates) return null
  return (
    <div className="rates-bar">
      <span className="rates-label">Exchange rates</span>
      {TOKENS.map((t) => (
        <span key={t.key} className="rate-chip">
          <strong>{t.label}</strong> {formatRate(rates[t.key]?.usd)}
        </span>
      ))}
    </div>
  )
}
