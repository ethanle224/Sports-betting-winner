import { nbaLineChance, type NbaForecast } from './nba-model.js'
import type { NbaPregameLine } from './nba-factors.js'

const BASE = 'https://external-api.kalshi.com/trade-api/v2'
const SERIES = ['KXNBAGAME', 'KXNBASPREAD', 'KXNBATOTAL'] as const
export type NbaSeries = typeof SERIES[number]
export const OPENING_NBA_GAMES = [
  { gameId: '401909088', date: '2026-10-20', awayId: '2', homeId: '8', awayCode: 'BOS', homeCode: 'DET', awayCity: 'Boston', homeCity: 'Detroit', eventCode: 'BOSDET' },
  { gameId: '401909089', date: '2026-10-20', awayId: '20', homeId: '18', awayCode: 'PHI', homeCode: 'NYK', awayCity: 'Philadelphia', homeCity: 'New York', eventCode: 'PHINYK' },
  { gameId: '401909090', date: '2026-10-20', awayId: '25', homeId: '24', awayCode: 'OKC', homeCode: 'SAS', awayCity: 'Oklahoma City', homeCity: 'San Antonio', eventCode: 'OKCSAS' },
] as const
export type OpeningNbaGame = { gameId: string; date: string; awayId: string; homeId: string; awayCode: string; homeCode: string;
  awayCity: string; homeCity: string; eventCode: string }
type ScheduledEvent = { id?: string; date?: string; season?: { type?: number }; competitions?: { neutralSite?: boolean;
  competitors?: { homeAway?: string; team?: { id?: string; location?: string; name?: string; abbreviation?: string } }[] }[] }
const codes: Record<string, string> = { WSH: 'WAS', UTAH: 'UTA', NO: 'NOP', GS: 'GSW', NY: 'NYK', SA: 'SAS', PHO: 'PHX', BKN: 'BKN', LAL: 'LAL', LAC: 'LAC' }
function identity(team: { id?: string; location?: string; name?: string; abbreviation?: string } | undefined) {
  if (!team?.id || !team.location || !team.abbreviation || !team.name || !/^[A-Z]{2,4}$/.test(team.abbreviation)) throw new Error('Incomplete NBA team identity')
  const city = team.abbreviation === 'LAL' ? 'Los Angeles L' : team.abbreviation === 'LAC' ? 'Los Angeles C' : team.location === 'LA' ? 'Los Angeles C' : team.location
  if (!/^[A-Za-z .]+$/.test(city)) throw new Error('Unrecognized NBA team location')
  return { id: team.id, city, code: codes[team.abbreviation] ?? team.abbreviation }
}
export function mapNbaSchedule(date: string, events: ScheduledEvent[]): OpeningNbaGame[] {
  const ids = new Set<string>(); const pairs = new Set<string>()
  return events.filter((event) => event.season?.type === 2).map((event) => {
    const competitors = event.competitions?.[0]?.competitors ?? []
    if (!event.id || ids.has(event.id) || competitors.length !== 2 || !event.date || !Number.isFinite(Date.parse(event.date)) ||
      new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(event.date)) !== date ||
      typeof event.competitions?.[0]?.neutralSite !== 'boolean') throw new Error('Selected NBA schedule mapping incomplete')
    const away = identity(competitors.find((c) => c.homeAway === 'away')?.team)
    const home = identity(competitors.find((c) => c.homeAway === 'home')?.team)
    const eventCode = `${away.code}${home.code}`
    if (away.id === home.id || pairs.has(eventCode)) throw new Error('Ambiguous NBA matchup')
    ids.add(event.id); pairs.add(eventCode)
    return { gameId: event.id, date, awayId: away.id, homeId: home.id, awayCode: away.code, homeCode: home.code,
      awayCity: away.city, homeCity: home.city, eventCode }
  })
}
export type NbaMarket = { ticker: string; event_ticker: string; title: string; rules_primary: string; rules_secondary: string;
  gameId: string; series: NbaSeries; kind: 'moneyline' | 'spread' | 'total'; team?: 'home' | 'away'; line?: number;
  raw?: Record<string, unknown> }
export type NbaBook = { orderbook_fp?: { yes_dollars?: unknown; no_dollars?: unknown } }
const numeric = (v: unknown, max: number) => typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= max ? Number(v) : null

function classify(raw: Record<string, unknown>, series: NbaSeries, game: OpeningNbaGame): NbaMarket | null {
  const [year, month, day] = game.date.split('-').map(Number)
  const event = `${series}-${String(year).slice(2)}${new Date(Date.UTC(year, month - 1, day)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase()}${String(day).padStart(2, '0')}${game.eventCode}`
  if (raw.event_ticker !== event || typeof raw.ticker !== 'string' || !raw.ticker.startsWith(`${event}-`) ||
      typeof raw.rules_primary !== 'string' || typeof raw.rules_secondary !== 'string' || typeof raw.title !== 'string') return null
  const rules = raw.rules_primary
  const dateLabel = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  if (!rules.includes(`the ${game.awayCity} vs ${game.homeCity} Pro Basketball game originally scheduled for ${dateLabel},`)) return null
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

export async function collectOpeningNbaMarkets(date: string, games: OpeningNbaGame[], fetcher: typeof fetch = fetch) {
  if (games.some((game) => game.date !== date)) throw new Error('Selected date and mapped games disagree')
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
        for (const game of games) {
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

export type NbaPricedCandidate = { ticker: string; market: NbaMarket['kind']; side: 'yes' | 'no'; line: number | null;
  probability: number; price: number; feeEstimate: number; allInCost: number; estimatedNetEdge: number;
  rules: string; rulesSecondary: string }

// Same-quote descriptive comparison. Active selection MUST additionally pass
// applyNbaPlayerSelectionPolicy; this callback alone is not primary evidence.
export function compareNbaPlayerTotals(candidates: NbaPricedCandidate[],
  chance: (kind: 'over' | 'under', line: number) => number | null, mode: 'shadow' | 'main' = 'shadow') {
  const sort = (a: NbaPricedCandidate, b: NbaPricedCandidate) =>
    b.estimatedNetEdge - a.estimatedNetEdge || b.probability - a.probability ||
    a.ticker.localeCompare(b.ticker) || a.side.localeCompare(b.side)
  const baselineCandidates = candidates.filter((side) => side.market === 'total').map((side) => ({ ...side })).sort(sort)
  const rescored = baselineCandidates.flatMap((side) => {
    if (side.line === null) return []
    const probability = chance(side.side === 'yes' ? 'over' : 'under', side.line)
    return probability === null || !Number.isFinite(probability) || probability < 0 || probability > 1 ? [] :
      [{ ...side, probability, estimatedNetEdge: probability - side.allInCost }]
  }).sort(sort)
  return { status: mode === 'main' ? 'PAPER_ONLY_EXPERIMENT' as const : 'SHADOW_ONLY' as const,
    promotionGate: mode === 'main' ? 'USER_APPROVED_PAPER_ONLY' as const : 'UNVALIDATED_FORWARD_ONLY' as const,
    rankingRule: 'estimatedNetEdge descending, probability descending, ticker/side ascending' as const,
    baselineCandidates: mode === 'main' ? candidates.map((side) => ({ ...side })) : baselineCandidates,
    baselineStudySide: baselineCandidates.find((side) => side.estimatedNetEdge > 0) ?? null,
    candidates: rescored, studySide: rescored.find((side) => side.estimatedNetEdge > 0) ?? null }
}

export function chooseNbaShadowSide(candidates: NbaPricedCandidate[], studySide: NbaPricedCandidate | null,
  markets: NbaMarket[], reference: NbaPregameLine | null): NbaPricedCandidate | null {
  return [...candidates].filter((candidate) =>
    (candidate.market === 'moneyline' || candidate.market === 'spread') &&
    candidate.probability >= 0.55 && candidate.probability > (studySide?.probability ?? 0) &&
    candidate.allInCost <= 1 / 1.7 && candidate.estimatedNetEdge >= 0.03 &&
    (candidate.market !== 'spread' || (reference && candidate.line !== null &&
      Math.abs((markets.find((m) => m.ticker === candidate.ticker)?.team === 'home' ? -1 : 1) * candidate.line - reference.homeSpread) <= 3)))
    .sort((a, b) => b.probability - a.probability || b.estimatedNetEdge - a.estimatedNetEdge)[0] ?? null
}

export function rankOpeningNbaGame(game: OpeningNbaGame, markets: NbaMarket[], books: Record<string, NbaBook>, forecast: NbaForecast | null, quantity: number,
  reference: NbaPregameLine | null = null) {
  const matching = markets.filter((m) => m.gameId === game.gameId)
  const coverage = { moneyline: matching.filter((m) => m.kind === 'moneyline').length,
    spread: matching.filter((m) => m.kind === 'spread').length, total: matching.filter((m) => m.kind === 'total').length }
  const candidates: NbaPricedCandidate[] = []
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
  const best = candidates[0] ?? null
  const refTotal = reference?.total ?? null
  const nearTotal = refTotal === null ? null : candidates.find((candidate) => candidate.market === 'total' &&
    candidate.line !== null && Math.abs(candidate.line - refTotal) <= 3 && candidate.estimatedNetEdge > 0) ?? null
  // Closer-to-consensus is only a tiebreak among plausible priced contracts.
  // A worse quote is NOT automatically safer; refuse to sacrifice >5pp of
  // estimated net gap based on an uncalibrated forecast.
  const preferNear = best?.market === 'total' && best.line !== null && refTotal !== null &&
    Math.abs(best.line - refTotal) > 6 && nearTotal && nearTotal.estimatedNetEdge >= best.estimatedNetEdge - 0.05
  const studySide = preferNear ? nearTotal : best
  // Shadow-only challenger: a more likely outcome must also be a reasonably
  // priced, positive-gap contract. This does not change the live study ranking.
  // 1.7x gross return is a research floor, not a profitability guarantee.
  const shadowSide = chooseNbaShadowSide(candidates, studySide, matching, reference)
  const totalBenchmark = { reference: refTotal, provider: reference?.provider ?? null,
    selectedDistance: studySide?.market === 'total' && studySide.line !== null && refTotal !== null ?
      Math.abs(studySide.line - refTotal) : null,
    reason: refTotal === null ? 'Independent pregame total unavailable; no consensus-line safety inference.' :
      preferNear ? 'Selected priced total nearer independent sportsbook total with positive estimated net gap; not a guaranteed safer outcome.' :
        best?.market === 'total' && best.line !== null && Math.abs(best.line - refTotal) > 6 ?
          'Selected total differs materially from sportsbook total; nearer positive-value alternative unavailable or costs too much.' :
          'Sportbook total is context; Kalshi quote, exact contract and costs still decide.' }
  return { gameId: game.gameId, coverage, pricedSides: candidates.length, candidates, studySide, shadowSide,
    totalBenchmark,
    qualifiedPaperPick: false as const,
    checklist: { mappedGame: true, modelScoreOnly: !!forecast, injuryLineupVerified: false, rulesVerified: false,
      feeVerified: false, executableDepthInspected: candidates.length > 0, settlementFairPriceRisk: true } }
}

export const NBA_KALSHI_BASE = BASE
