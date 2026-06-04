// Prices like settlePrice are in wei (1e18 = 1 token).
export function weiToToken(wei) {
  if (wei == null) return 0
  try {
    return Number(BigInt(wei)) / 1e18
  } catch {
    return Number(wei) / 1e18
  }
}

const usdFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const usdFmtPrecise = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

const compactFmt = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
})

export const usd = (n) => usdFmt.format(Number(n) || 0)
export const usdPrecise = (n) => usdFmtPrecise.format(Number(n) || 0)
export const compactUsd = (n) =>
  '$' + compactFmt.format(Number(n) || 0)
export const compactNum = (n) => compactFmt.format(Number(n) || 0)
export const num = (n) => new Intl.NumberFormat('en-US').format(Number(n) || 0)

export function timeAgo(ts) {
  const seconds = Math.floor(Date.now() / 1000 - Number(ts))
  if (seconds < 60) return `${seconds}s ago`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}
