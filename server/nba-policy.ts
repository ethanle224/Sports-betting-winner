import type { NbaPlayerTotalsResult } from './nba-player-totals.js'

type NbaPolicyCandidate = { market: string; side: string; line: number | null; probability: number;
  price: number; feeEstimate: number; allInCost: number; estimatedNetEdge: number; rules: string; rulesSecondary: string }

// A forward research policy, not a retrospectively fitted profitable filter.
// Retain baseline output for comparison. Never backfill a total when a side is paused.
export const NBA_SELECTION_POLICY = 'nba-primary-v3-sides-paused' as const
export const NBA_PLAYER_SELECTION_POLICY = 'nba-primary-v4-player-totals-v2' as const

// User-approved unvalidated PAPER experiment, never qualified or live-order eligible.
export function applyNbaPlayerSelectionPolicy<Candidate extends NbaPolicyCandidate & { ticker: string }>(
  baselineCandidates: readonly Candidate[], simulation: NbaPlayerTotalsResult | null | undefined, quantity = 10) {
  const validModel = simulation?.version === 'nba-player-totals-v2' && simulation.status === 'estimated' &&
    simulation.eligibleForPrimary === true && simulation.simulations === 1000 &&
    Array.isArray(simulation.totals) && simulation.totals.length === 1000 &&
    Array.isArray(simulation.scores) && simulation.scores.length === 1000 &&
    Array.from(simulation.scores).every((s, i) => s && Number.isSafeInteger(s.home) && s.home >= 0 &&
      Number.isSafeInteger(s.away) && s.away >= 0 && s.home !== s.away &&
      Number.isInteger(s.overtimePeriods) && s.overtimePeriods >= 0 && s.overtimePeriods <= 6 &&
      simulation.totals[i] === s.home + s.away)
  const validQuantity = Number.isInteger(quantity) && quantity >= 1 && quantity <= 100
  const candidates = (!validModel || !validQuantity ? [] : baselineCandidates).filter((c) =>
    c.market === 'total' && typeof c.ticker === 'string' && c.ticker.length > 0 &&
    ['yes', 'no'].includes(c.side) && c.line !== null && Number.isFinite(c.line) && c.line > 0 && c.line % 1 === .5 &&
    Number.isFinite(c.price) && c.price > 0 && c.price < 1 && Number.isFinite(c.feeEstimate) && c.feeEstimate >= 0 &&
    Number.isFinite(c.allInCost) && c.allInCost > 0 && c.allInCost < 1 &&
    Math.abs(c.allInCost - c.price - c.feeEstimate / quantity) < 1e-8 &&
    Math.abs(c.feeEstimate - Math.ceil(.07 * quantity * c.price * (1 - c.price) * 10000 - 1e-9) / 10000) < 1e-8 &&
    typeof c.rules === 'string' && c.rules.trim().length > 0 && typeof c.rulesSecondary === 'string' && c.rulesSecondary.trim().length > 0
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
