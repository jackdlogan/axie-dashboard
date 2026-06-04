// All GraphQL access goes through the Vite proxy at /api/graphql, which injects
// the X-API-Key header server-side. See vite.config.js.
const ENDPOINT = '/api/graphql'

async function gql(query, variables) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })

  // HTTP 200 does not guarantee success with this API — always inspect errors.
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`)
  }
  const json = await res.json()
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join('; '))
  }
  return json.data
}

const DASHBOARD_QUERY = /* GraphQL */ `
  query Dashboard {
    overallMarketStats {
      newAxies { last24H last7D last30D allTime }
      mkpTxs { last24H last7D last30D allTime }
      mkpVolumeInUsdAllTime
      ascendedAxiesLast7D
    }
    marketStats {
      last24Hours { count axieCount volume volumeUsd }
      last7Days { count axieCount volume volumeUsd }
      last30Days { count axieCount volume volumeUsd }
    }
    exchangeRate {
      eth { usd }
      axs { usd }
      slp { usd }
      ron { usd }
      usdc { usd }
    }
    tokensStats {
      ...CollectionStats
    }
  }

  fragment CollectionStats on TokensStats {
    axie { ...Stat }
    originAxie { ...Stat }
    mysticAxie { ...Stat }
    shinyAxie { ...Stat }
    japanAxie { ...Stat }
    summerAxie { ...Stat }
    nightmareAxie { ...Stat }
    xmasAxie { ...Stat }
    meoAxie { ...Stat }
    land { ...Stat }
    landItems { ...Stat }
    accessories { ...Stat }
    runes { ...Stat }
    charms { ...Stat }
    materials { ...Stat }
    consumables { ...Stat }
  }

  # Values are already in ETH (token units), NOT wei — no 1e18 conversion needed.
  fragment Stat on TokenStats {
    holders
    floorPrice
    last24HVolume
    totalSupply
  }
`

// Axie ERC-721 contract on Ronin. topSales filters by token *address* now
// (the old `tokenType: Axie` argument was removed from the schema).
const AXIE_CONTRACT = '0x32950db2a7164ae833121501c797d79e7b79d74c'

const TOP_SALES_QUERY = /* GraphQL */ `
  query TopSales($period: PeriodType!, $tokenAddress: String) {
    topSales(tokenAddress: $tokenAddress, periodType: $period, size: 20) {
      results {
        orderId
        settlePrice
        settlePriceUsd
        timestamp
        asset {
          token {
            ... on Axie { id name class image }
          }
        }
      }
    }
  }
`

export function fetchDashboard() {
  return gql(DASHBOARD_QUERY)
}

export function fetchTopSales(period) {
  return gql(TOP_SALES_QUERY, { period, tokenAddress: AXIE_CONTRACT }).then(
    (d) => d.topSales?.results ?? []
  )
}
