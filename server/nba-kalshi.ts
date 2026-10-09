import { nbaLineChance, type NbaForecast } from './nba-model.js'

const BASE = 'https://external-api.kalshi.com/trade-api/v2'
const SERIES = ['KXNBAGAME', 'KXNBASPREAD', 'KXNBATOTAL'] as const
export type NbaSeries = typeof SERIES[number]
export const OPENING_NBA_GAMES = [
  { gameId: '401909088', date: '2026-10-20', awayId: '2', homeId: '8', awayCode: 'BOS', homeCode: 'DET', awayCity: 'Boston', homeCity: 'Detroit', eventCode: 'BOSDET' },
  { gameId: '401909089', date: '2026-10-20', awayId: '20', homeId: '18', awayCode: 'PHI', homeCode: 'NYK', awayCity: 'Philadelphia', homeCity: 'New York', eventCode: 'PHINYK' },
  { gameId: '401909090', date: '2026-10-20', awayId: '25', homeId: '24', awayCode: 'OKC', homeCode: 'SAS', awayCity: 'Oklahoma City', homeCity: 'San Antonio', eventCode: 'OKCSAS' },
] as const
export type OpeningNbaGame = typeof OPENING_NBA_GAMES[number]
export type NbaMarket = { ticker: string; event_ticker: string; title: string; rules_primary: string; rules_secondary: string;
  gameId: string; series: NbaSeries; kind: 'moneyline' | 'spread' | 'total'; team?: 'home' | 'away'; line?: number;
  raw?: Record<string, unknown> }
export type NbaBook = { orderbook_fp?: { yes_dollars?: unknown; no_dollars?: unknown } }
const numeric = (v: unknown, max: number) => typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= max ? Number(v) : null

function classify(raw: Record<string, unknown>, series: NbaSeries, game: OpeningNbaGame): NbaMarket | null {
  const event = `${series}-26OCT20${game.eventCode}`
  if (raw.event_ticker !== event || typeof raw.ticker !== 'string' || !raw.ticker.startsWith(`${event}-`) ||
      typeof raw.rules_primary !== 'string' || typeof raw.rules_secondary !== 'string' || typeof raw.title !== 'string') return null
  const rules = raw.rules_primary
  const base = { ticker: raw.ticker, event_ticker: event, title: raw.title, rules_primary: rules,
    rules_secondary: raw.rules_secondary, gameId: game.gameId, series, raw }
  if (series === 'KXNBAGAME') {
    for (const [code, city, team] of [[game.homeCode, game.homeCity, 'home'], [game.awayCode, game.awayCity, 'away']] as const) {
      if (raw.ticker === `${event}-${code}` && rules.startsWith(`If ${city} wins `)) return { ...base, kind: 'moneyline', team }
    }
  }
  if (series === 'KXNBASPREAD') {
    for (const [city, team] of [[game.homeCity, 'home'], [game.awayCity, 'away']] as const) {
      const match = new RegExp(`^If ${city} wins by more than (\\d+\\.5) points `).exec(rules)
      if (match && Number(match[1]) < 100) return { ...base, kind: 'spread', team, line: Number(match[1]) }
    }
  }
  if (series === 'KXNBATOTAL') {
    const match = /^If over (\d+\.5) total points are scored /.exec(rules)
    if (match && Number(match[1]) >= 100 && Number(match[1]) <= 400) return { ...base, kind: 'total', line: Number(match[1]) }
  }
  return null
}

export async function collectOpeningNbaMarkets(date: string, fetcher: typeof fetch = fetch) {
  if (date !== '2026-10-20') throw new Error('Only opening slate is mapped')
  const markets: NbaMarket[] = []
  const series = [] as { series: NbaSeries; listed: number; matched: number }[]
  for (const ticker of SERIES) {
    let cursor = ''; const seen = new Set<string>(); let listed = 0; let matched = 0
    do {
      const query = new URLSearchParams({ series_ticker: ticker, status: 'open', limit: '1000' })
      if (cursor) query.set('cursor', cursor)
      const response = await fetcher(`${BASE}/markets?${query}`, { signal: AbortSignal.timeout(12000) })
      if (!response.ok) throw new Error(`Kalshi ${ticker} listing unavailable`)
      const data: unknown = await response.json()
      if (!data || typeof data !== 'object' || !Array.isArray((data as { markets?: unknown }).markets)) throw new Error('Malformed Kalshi listing')
      for (const raw of (data as { markets: unknown[] }).markets) {
        listed++
        if (!raw || typeof raw !== 'object') continue
        for (const game of OPENING_NBA_GAMES) {
          const item = classify(raw as Record<string, unknown>, ticker, game)
          if (item) { markets.push(item); matched++; break }
        }
      }
      const next = (data as { cursor?: unknown }).cursor
      cursor = typeof next === 'string' ? next : ''
      if (cursor) { if (seen.has(cursor) || seen.size >= 100) throw new Error('Incomplete Kalshi pagination'); seen.add(cursor) }
    } while (cursor)
    series.push({ series: ticker, listed, matched })
  }
  if (new Set(markets.map((m) => m.ticker)).size !== markets.length) throw new Error('Duplicate Kalshi market')
  return { observedAt: new Date().toISOString(), source: BASE, series, markets }
}

export function pricedNbaSide(book: NbaBook, side: 'yes' | 'no', quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) return null
  const levels = side === 'yes' ? book.orderbook_fp?.no_dollars : book.orderbook_fp?.yes_dollars
  if (!Array.isArray(levels)) return null
  const parsed = levels.map((level) => {
    if (!Array.isArray(level) || level.length !== 2) return null
    const bid = numeric(level[0], 1); const size = numeric(level[1], 1e9)
    return bid !== null && size !== null && size > 0 ? { bid, size } : null
  })
  if (parsed.some((v) => v === null)) return null
  let remaining = quantity; let cost = 0
  for (const level of (parsed as { bid: number; size: number }[]).sort((a, b) => b.bid - a.bid)) {
    const taken = Math.min(remaining, level.size)
    cost += taken * (1 - level.bid)
    remaining -= taken
    if (remaining <= 1e-8) break
  }
  if (remaining > 1e-8) return null
  const price = cost / quantity
  // General 2026 taker schedule, estimated on average price; multi-level execution may round differently.
  const feeEstimate = Math.ceil((0.07 * quantity * price * (1 - price)) * 10000 - 1e-9) / 10000
  return { price, feeEstimate, allInCost: (cost + feeEstimate) / quantity, quantity }
}

function probability(m: NbaMarket, forecast: NbaForecast): number | null {
  if (m.kind === 'moneyline') return m.team === 'home' ? forecast.homeWin : forecast.awayWin
  if (m.line === undefined) return null
  if (m.kind === 'total') return nbaLineChance(forecast, 'over', m.line)
  const homeCover = nbaLineChance(forecast, 'homeSpread', m.team === 'home' ? -m.line : m.line)
  return homeCover === null ? null : m.team === 'home' ? homeCover : 1 - homeCover
}

export function rankOpeningNbaGame(game: OpeningNbaGame, markets: NbaMarket[], books: Record<string, NbaBook>, forecast: NbaForecast | null, quantity: number) {
  const matching = markets.filter((m) => m.gameId === game.gameId)
  const coverage = { moneyline: matching.filter((m) => m.kind === 'moneyline').length,
    spread: matching.filter((m) => m.kind === 'spread').length, total: matching.filter((m) => m.kind === 'total').length }
  const candidates = [] as { ticker: string; market: NbaMarket['kind']; side: 'yes' | 'no'; line: number | null;
    probability: number; price: number; feeEstimate: number; allInCost: number; estimatedNetEdge: number;
    rules: string; rulesSecondary: string }[]
  if (forecast) for (const market of matching) {
    const p = probability(market, forecast)
    if (p === null) continue
    for (const side of ['yes', 'no'] as const) {
      const quote = pricedNbaSide(books[market.ticker] ?? {}, side, quantity)
      if (!quote) continue
      const prob = side === 'yes' ? p : 1 - p
      candidates.push({ ticker: market.ticker, market: market.kind, side, line: market.line ?? null,
        probability: prob, price: quote.price, feeEstimate: quote.feeEstimate, allInCost: quote.allInCost,
        estimatedNetEdge: prob - quote.allInCost, rules: market.rules_primary, rulesSecondary: market.rules_secondary })
    }
  }
  candidates.sort((a, b) => b.estimatedNetEdge - a.estimatedNetEdge)
  return { gameId: game.gameId, coverage, pricedSides: candidates.length, candidates, studySide: candidates[0] ?? null,
    qualifiedPaperPick: false as const,
    checklist: { mappedGame: true, modelScoreOnly: !!forecast, injuryLineupVerified: false, rulesVerified: false,
      feeVerified: false, executableDepthInspected: candidates.length > 0, settlementFairPriceRisk: true } }
}

export const NBA_KALSHI_BASE = BASE
