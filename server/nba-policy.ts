import type { NbaPlayerTotalsResult } from './nba-player-totals.js'
import { pricedNbaSide, type NbaBook, type NbaMarket, type NbaPricedCandidate } from './nba-kalshi.js'

type NbaPolicyCandidate = { market: string; side: string; line: number | null; probability: number;
  price: number; feeEstimate: number; allInCost: number; estimatedNetEdge: number; rules: string; rulesSecondary: string }

// A forward research policy, not a retrospectively fitted profitable filter.
// Retain baseline output for comparison. Never backfill a total when a side is paused.
export const NBA_SELECTION_POLICY = 'nba-primary-v3-sides-paused' as const
export const NBA_PLAYER_SELECTION_POLICY = 'nba-primary-v4-player-totals-v2' as const
export const NBA_PLAYER_MARKETS_SELECTION_POLICY = 'nba-primary-v5-player-markets-v2' as const

function validPairedScores(simulation: NbaPlayerTotalsResult | null | undefined): simulation is NbaPlayerTotalsResult {
  return simulation?.version === 'nba-player-totals-v2' && simulation.status === 'estimated' &&
    simulation.eligibleForPrimary === true && simulation.simulations === 1000 &&
    Array.isArray(simulation.totals) && simulation.totals.length === 1000 &&
    Array.isArray(simulation.scores) && simulation.scores.length === 1000 &&
    Array.from(simulation.scores).every((s, i) => s && Number.isSafeInteger(s.home) && s.home >= 0 &&
      Number.isSafeInteger(s.away) && s.away >= 0 && s.home !== s.away &&
      Number.isInteger(s.overtimePeriods) && s.overtimePeriods >= 0 && s.overtimePeriods <= 6 &&
      simulation.totals[i] === s.home + s.away)
}

function validQuote(c: NbaPolicyCandidate & { ticker: string }, quantity: number) {
  return typeof c.ticker === 'string' && c.ticker.length > 0 && ['yes', 'no'].includes(c.side) &&
    Number.isFinite(c.price) && c.price > 0 && c.price < 1 && Number.isFinite(c.feeEstimate) && c.feeEstimate >= 0 &&
    Number.isFinite(c.allInCost) && c.allInCost > 0 && c.allInCost < 1 &&
    Math.abs(c.allInCost - c.price - c.feeEstimate / quantity) < 1e-8 &&
    Math.abs(c.feeEstimate - Math.ceil(.07 * quantity * c.price * (1 - c.price) * 10000 - 1e-9) / 10000) < 1e-8 &&
    typeof c.rules === 'string' && c.rules.trim().length > 0 && typeof c.rulesSecondary === 'string' && c.rulesSecondary.trim().length > 0
}

// Shared empirical scoring math. Neither this ranking nor a positive gap proves
// calibration or profitability; primary authorization is a separate policy.
function rankPairedMarketQuotes<Candidate extends NbaPolicyCandidate & { ticker: string }>(
  candidates: readonly Candidate[], markets: readonly Pick<NbaMarket, 'ticker' | 'kind' | 'rules_primary' | 'rules_secondary' | 'team' | 'line'>[],
  simulation: NbaPlayerTotalsResult | null | undefined, quantity = 10) {
  const valid = validPairedScores(simulation) && Number.isInteger(quantity) && quantity >= 1 && quantity <= 100
  const duplicateTickers = new Set<string>()
  const mapped = new Map<string, typeof markets[number]>()
  for (const market of markets) {
    if (mapped.has(market.ticker)) duplicateTickers.add(market.ticker)
    else mapped.set(market.ticker, market)
  }
  const rescored = (!valid ? [] : candidates).flatMap((c) => {
    const m = mapped.get(c.ticker)
    if (!m || duplicateTickers.has(c.ticker) || m.kind !== c.market || !validQuote(c, quantity) ||
      c.rules !== m.rules_primary || c.rulesSecondary !== m.rules_secondary ||
      !['moneyline', 'spread', 'total'].includes(m.kind)) return []
    if (m.kind === 'moneyline' ? c.line !== null || !['home', 'away'].includes(m.team ?? '') :
      c.line === null || !Number.isFinite(c.line) || c.line <= 0 || c.line % 1 !== .5 ||
      c.line !== m.line || (m.kind === 'total' && (c.line < 100 || c.line > 400)) ||
      (m.kind === 'spread' && (c.line >= 100 || !['home', 'away'].includes(m.team ?? '')))) return []
    const wins = simulation!.scores.filter((s) => m.kind === 'moneyline' ?
      (m.team === 'home' ? s.home > s.away : s.away > s.home) : m.kind === 'spread' ?
        (m.team === 'home' ? s.home - s.away > m.line! : s.away - s.home > m.line!) :
        s.home + s.away > m.line!).length
    const probability = c.side === 'yes' ? wins / 1000 : 1 - wins / 1000
    return [{ ...c, probability, estimatedNetEdge: probability - c.allInCost }]
  }).sort((a, b) => b.estimatedNetEdge - a.estimatedNetEdge ||
    (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : a.side === b.side ? 0 : a.side === 'yes' ? -1 : 1))
  return { pricedSides: rescored.length, inspected: { mappedQuotes: new Set(rescored.map((c) => c.ticker)).size },
    candidates: rescored, studySide: rescored.find((c) => c.estimatedNetEdge > 0) ?? null }
}

// Retain the earlier shadow-only API without relabeling its stored artifacts.
export function compareNbaPlayerMarkets<Candidate extends NbaPolicyCandidate & { ticker: string }>(
  candidates: readonly Candidate[], markets: readonly Pick<NbaMarket, 'ticker' | 'kind' | 'rules_primary' | 'rules_secondary' | 'team' | 'line'>[],
  simulation: NbaPlayerTotalsResult | null | undefined, quantity = 10) {
  return { status: 'SHADOW_ONLY' as const, eligibleForPrimary: false as const,
    reason: 'Moneyline/spread paired-score probabilities lack out-of-sample calibration; no automatic cross-market paper ticket.',
    ...rankPairedMarketQuotes(candidates, markets, simulation, quantity) }
}

// Forward-only expansion explicitly approved for experimental paper picks.
// Each market's outcome is evaluated on the same paired final scores, not a
// reused total probability or the old score-only forecast. This is uncalibrated.
export function applyNbaPlayerMarketsSelectionPolicy(markets: readonly NbaMarket[], books: Record<string, NbaBook>,
  simulation: NbaPlayerTotalsResult | null | undefined, quantity = 10) {
  const quoted: NbaPricedCandidate[] = markets.flatMap((market) => (['yes', 'no'] as const).flatMap((side) => {
    const quote = pricedNbaSide(books[market.ticker] ?? {}, side, quantity)
    return quote ? [{ ticker: market.ticker, market: market.kind, side, line: market.line ?? null,
      probability: 0, estimatedNetEdge: -quote.allInCost, price: quote.price, feeEstimate: quote.feeEstimate,
      allInCost: quote.allInCost, rules: market.rules_primary, rulesSecondary: market.rules_secondary }] : []
  }))
  const comparison = rankPairedMarketQuotes(quoted, markets, simulation, quantity)
  return { selectionPolicy: NBA_PLAYER_MARKETS_SELECTION_POLICY, candidates: comparison.candidates,
    studySide: comparison.studySide,
    abstentionReason: comparison.studySide ? null : 'No valid positive-gap player v2 moneyline, spread or total; no fallback selection.' }
}

// Legacy v4 totals-only experiment retained exactly for historical validation.
export function applyNbaPlayerSelectionPolicy<Candidate extends NbaPolicyCandidate & { ticker: string }>(
  baselineCandidates: readonly Candidate[], simulation: NbaPlayerTotalsResult | null | undefined, quantity = 10) {
  const validModel = validPairedScores(simulation)
  const validQuantity = Number.isInteger(quantity) && quantity >= 1 && quantity <= 100
  const candidates = (!validModel || !validQuantity ? [] : baselineCandidates).filter((c) =>
    c.market === 'total' &&
    ['yes', 'no'].includes(c.side) && c.line !== null && Number.isFinite(c.line) && c.line > 0 && c.line % 1 === .5 &&
    validQuote(c, quantity)
  ).map((c) => {
    const over = simulation!.totals.filter((n) => n > c.line!).length / 1000
    const probability = c.side === 'yes' ? over : 1 - over
    return { ...c, probability, estimatedNetEdge: probability - c.allInCost }
  // Predeclared ordering: net gap descending, ticker ASCII ascending, YES before NO.
  }).sort((a, b) => b.estimatedNetEdge - a.estimatedNetEdge ||
    (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : a.side === b.side ? 0 : a.side === 'yes' ? -1 : 1))
  const studySide = candidates.find((c) => c.estimatedNetEdge > 0) ?? null
  return { selectionPolicy: NBA_PLAYER_SELECTION_POLICY, candidates, studySide,
    abstentionReason: studySide ? null : 'No valid positive-gap player v2 total; no fallback selection.' }
}

export function applyNbaSelectionPolicy<Candidate extends NbaPolicyCandidate>(baselineStudySide: Candidate | null, quantity = 10) {
  const result = { selectionPolicy: NBA_SELECTION_POLICY, baselineStudySide }
  if (!baselineStudySide) return { ...result, studySide: null, abstentionReason: 'No priced baseline selection.' }
  if (baselineStudySide.market !== 'total') return { ...result, studySide: null,
    abstentionReason: 'Primary side-model picks paused pending independent forward validation; baseline retained for research only.' }
  const side = baselineStudySide
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100 ||
    !['yes', 'no'].includes(side.side) ||
    !Number.isFinite(side.price) || side.price <= 0 || side.price >= 1 ||
    !Number.isFinite(side.feeEstimate) || side.feeEstimate < 0 ||
    !Number.isFinite(side.probability) || side.probability < 0 || side.probability > 1 ||
    !Number.isFinite(side.allInCost) || side.allInCost <= 0 || side.allInCost >= 1 ||
    Math.abs(side.allInCost - (side.price + side.feeEstimate / quantity)) > 1e-8 ||
    !Number.isFinite(side.estimatedNetEdge) || side.estimatedNetEdge <= 0 ||
    Math.abs(side.estimatedNetEdge - (side.probability - side.allInCost)) > 1e-8 ||
    side.line === null || !Number.isFinite(side.line) || side.line <= 0 || side.line % 1 !== .5 ||
    !side.rules || !side.rulesSecondary) {
    return { ...result, studySide: null, abstentionReason: 'No valid positive-gap baseline total; no substitute selection.' }
  }
  return { ...result, studySide: baselineStudySide, abstentionReason: null }
}
