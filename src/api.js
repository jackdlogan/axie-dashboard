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

// WETH on Ronin. Axie listings settle in WETH, so a listing priced in this
// token can be read as ETH directly. Anything else we treat as "not a clean
// ETH floor" and skip (so we never mis-value a RON/USDC-priced listing as ETH).
const WETH_RONIN = '0xc99a6a985ed2cac1ef41640596c5a5f9f4e19ef5'

// Live order-book floor (cheapest active Sale listing) for every collectible
// collection. Six are addressable by per-collection count criteria
// (numMystic/numNightmare/numJapan/numXmas/numSummer/numShiny — only numMystic
// is documented, the rest were found by probing); Origin and MEO have no num*
// filter and are matched by `title` instead. This replaces the cached
// tokensStats floor, which is reliable for most collections but was badly stale
// for Nightmare (~6× too low).
const ALL_SIX = '[1, 2, 3, 4, 5, 6]'
const COLLECTIBLE_FLOORS_QUERY = /* GraphQL */ `
  query CollectibleFloors {
    mystic:    axies(auctionType: Sale, criteria: { numMystic: ${ALL_SIX} },    sort: PriceAsc, size: 1) { results { order { currentPrice paymentToken } } }
    nightmare: axies(auctionType: Sale, criteria: { numNightmare: ${ALL_SIX} }, sort: PriceAsc, size: 1) { results { order { currentPrice paymentToken } } }
    japan:     axies(auctionType: Sale, criteria: { numJapan: ${ALL_SIX} },     sort: PriceAsc, size: 1) { results { order { currentPrice paymentToken } } }
    xmas:      axies(auctionType: Sale, criteria: { numXmas: ${ALL_SIX} },      sort: PriceAsc, size: 1) { results { order { currentPrice paymentToken } } }
    summer:    axies(auctionType: Sale, criteria: { numSummer: ${ALL_SIX} },    sort: PriceAsc, size: 1) { results { order { currentPrice paymentToken } } }
    shiny:     axies(auctionType: Sale, criteria: { numShiny: ${ALL_SIX} },     sort: PriceAsc, size: 1) { results { order { currentPrice paymentToken } } }
    origin:    axies(auctionType: Sale, criteria: { title: ["Origin"] },                  sort: PriceAsc, size: 1) { results { order { currentPrice paymentToken } } }
    meo:       axies(auctionType: Sale, criteria: { title: ["MEO Corp", "MEO Corp II"] }, sort: PriceAsc, size: 1) { results { order { currentPrice paymentToken } } }
  }
`

const FLOOR_KEYS = ['mystic', 'nightmare', 'japan', 'xmas', 'summer', 'shiny', 'origin', 'meo']

// Returns a floor in ETH per key, or null when nothing is listed / the cheapest
// listing isn't WETH-priced (so a RON/USDC listing never gets mis-valued).
export function fetchCollectibleFloors() {
  return gql(COLLECTIBLE_FLOORS_QUERY).then((d) => {
    const out = {}
    for (const key of FLOOR_KEYS) {
      const order = d?.[key]?.results?.[0]?.order
      out[key] =
        order && order.paymentToken?.toLowerCase() === WETH_RONIN
          ? Number(BigInt(order.currentPrice)) / 1e18
          : null
    }
    return out
  })
}
