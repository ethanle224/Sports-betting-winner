import type { NbaFactor, NbaFactors } from '../server/nba-factors'

export const NBA_FREEZE_KEY = 'edgeboard-nba-freezes-v1'
export const NBA_REVIEW_KEY = 'edgeboard-nba-reviews-v1'

export type NbaEvidence = { requestedPaper: boolean; availabilitySource: string; availabilityObservedAt: string;
  availabilityNotes: string; rulesSource: string; feeSource: string; uncertaintyAccepted: boolean; rationale: string }
export type NbaStudySide = { ticker: string; market: string; side: string; line: number | null; probability: number; price: number;
  feeEstimate: number; allInCost: number; estimatedNetEdge: number; rules: string; rulesSecondary: string }
export type NbaScanGame = { gameId: string; home: string; away: string; startsAt: string;
  coverage: { moneyline: number; spread: number; total: number }; qualifiedPaperPick: false;
  studySide: NbaStudySide | null; candidates?: NbaStudySide[]; pricedSides?: number; forecast: { model: string; [key: string]: unknown } | null;
  inspected: { ticker: string; source: string; observedAt: string; book: unknown }[];
  factors?: Partial<NbaFactors & { venueH2H: NbaFactor; contractRules: NbaFactor; fairPrice: NbaFactor;
    fees: NbaFactor; depth: NbaFactor; fillability: NbaFactor }>;
  checklist?: { mappedGame: boolean; modelScoreOnly?: boolean; injuryLineupVerified?: boolean; rulesVerified?: boolean;
    feeVerified?: boolean; executableDepthInspected?: boolean; settlementFairPriceRisk?: boolean } }
export type NbaScan = { date: string; observedAt: string; marketObservedAt: string; quantity: number; historyObservedAt: string;
  status: string; games: NbaScanGame[]; sources: Record<string, string>; series: unknown[];
  marketInventory: unknown[]; [key: string]: unknown }
export type NbaDecision = { gameId: string; status: 'STUDY' | 'PAPER_EXPERIMENT'; selected: NbaStudySide | null;
  evidence: NbaEvidence | null; reasons: string[] }
export type NbaFreeze = { id: string; frozenAt: string; scan: NbaScan; decisions: NbaDecision[] }
export type NbaReviewInput = { scanId: string; gameId: string; observedAt: string; source: string;
  outcome: 'YES' | 'NO' | 'FAIR_PRICE'; payout: number; note: string }
export type NbaReview = NbaReviewInput & { id: string; simulatedNetUnits: number; unitDollars?: 25;
  stakeUnits?: 1; unitBasis?: 'ENTRY_STAKE'; entryCostPerContract: number; quantity: number; label: 'SIMULATED_NO_FILL' }

export function nbaSideLabel(side: NbaStudySide, game: NbaScanGame): string {
  if (side.market === 'total' && side.line !== null) return `${side.side === 'no' ? 'Under' : 'Over'} ${side.line}`
  const win = /^If (.+?) wins by more than ([\d.]+) points\b/.exec(side.rules)
  if (side.market === 'spread' && win && side.line !== null) {
    const team = side.side === 'yes' ? win[1] : win[1] === game.home ? game.away : game.home
    return `${team} ${side.side === 'yes' ? '-' : '+'}${side.line}`
  }
  const winner = /^If (.+?) wins\b/.exec(side.rules)
  if (side.market === 'moneyline' && winner) return `${side.side === 'yes' ? winner[1] : winner[1] === game.home ? game.away : game.home} winner`
  return `${side.side.toUpperCase()} · ${side.ticker}`
}
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

const validUrl = (text: string) => {
  try { return new URL(text).protocol === 'https:' } catch { return false }
}

export function freezeNbaStudy(input: NbaScan, evidence: Record<string, NbaEvidence>, nowIso: string): NbaFreeze {
  const now = Date.parse(nowIso); const observed = Date.parse(input.observedAt)
  if (!/^20\d\d-\d\d-\d\d$/.test(input.date) || input.date < '2026-10-20' || input.date > '2027-04-11' ||
    input.status !== 'STUDY_ONLY_NO_QUALIFIED_PICKS' || input.quantity !== 10 ||
    !Array.isArray(input.games) || input.games.length < 1 || input.games.length > 15 ||
    new Set(input.games.map((g) => g.gameId)).size !== input.games.length || input.games.some((g) => !g.gameId ||
      !Number.isFinite(Date.parse(g.startsAt)) || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(g.startsAt)) !== input.date) ||
    !Array.isArray(input.marketInventory) || !Array.isArray(input.series) || !input.sources?.markets || !input.historyObservedAt) {
    throw new Error('Incomplete selected-date NBA scan')
  }
  if (!Number.isFinite(now) || !Number.isFinite(observed) || observed > now || now - observed > 30 * 60_000) {
    throw new Error('NBA scan is stale or from the future')
  }
  const listedAt = Date.parse(input.marketObservedAt)
  if (!Number.isFinite(listedAt) || listedAt > observed || now - listedAt > 30 * 60_000) {
    throw new Error('NBA market listing is stale or from the future')
  }
  if (input.games.some((g) => !Number.isFinite(Date.parse(g.startsAt)) || Date.parse(g.startsAt) <= now || g.qualifiedPaperPick !== false)) {
    throw new Error('Opening-game tip has passed or scan is malformed')
  }
  const decisions: NbaDecision[] = input.games.map((game) => {
    const submitted = evidence[game.gameId] ?? null
    const reasons: string[] = []
    const side = game.studySide
    if (!side) reasons.push('No priced study side')
    else {
      if (!game.forecast || game.forecast.model !== 'nba-scores-v1') reasons.push('Independent score forecast missing')
      if (!game.inspected?.some((book) => book.ticker === side.ticker && book.book &&
        Number.isFinite(Date.parse(book.observedAt)) && Date.parse(book.observedAt) >= listedAt &&
        Date.parse(book.observedAt) <= observed && now - Date.parse(book.observedAt) <= 30 * 60_000)) {
        reasons.push('Raw sized orderbook missing or stale')
      }
      if (!Number.isFinite(side.probability) || side.probability < 0 || side.probability > 1 ||
        !Number.isFinite(side.allInCost) || side.allInCost <= 0 || side.allInCost >= 1 ||
        !Number.isFinite(side.estimatedNetEdge) || side.estimatedNetEdge <= 0) reasons.push('No positive post-estimated-cost model gap')
      if (!side.rules || !side.rulesSecondary) reasons.push('Contract rule text missing')
    }
    if (!submitted?.requestedPaper) reasons.push('Paper experiment not requested')
    const evidenceTime = Date.parse(submitted?.availabilityObservedAt ?? '')
    if (!submitted || !validUrl(submitted.availabilitySource) || !Number.isFinite(evidenceTime) ||
      evidenceTime > now || now - evidenceTime > 24 * 60 * 60_000 || submitted.availabilityNotes.trim().length < 20) {
      reasons.push('Availability and lineup evidence incomplete')
    }
    if (!submitted || !validUrl(submitted.rulesSource) || !validUrl(submitted.feeSource)) reasons.push('Rules and fee sources incomplete')
    if (!submitted?.uncertaintyAccepted || submitted.rationale.trim().length < 20) reasons.push('Pregame rationale and score-only uncertainty incomplete')
    return { gameId: game.gameId, status: reasons.length === 0 ? 'PAPER_EXPERIMENT' : 'STUDY',
      selected: side, evidence: submitted, reasons }
  })
  // Serialize at the boundary so callers cannot mutate the frozen nested book/model after saving.
  return JSON.parse(JSON.stringify({ id: input.observedAt, frozenAt: nowIso, scan: input, decisions })) as NbaFreeze
}

export function readNbaFreezes(storage: Storage): NbaFreeze[] {
  const text = storage.getItem(NBA_FREEZE_KEY)
  if (!text) return []
  try {
    const value: unknown = JSON.parse(text)
    if (!Array.isArray(value) || value.some((v) => !v || typeof v.id !== 'string' || !Array.isArray(v.decisions) ||
      v.decisions.length < 1 || v.decisions.length > 15 || v.decisions.length !== v.scan?.games?.length)) throw new Error('Malformed ledger')
    return value as NbaFreeze[]
  } catch { throw new Error('NBA local ledger is corrupt; export/recover it before writing') }
}

export function appendNbaFreeze(storage: Storage, record: NbaFreeze): NbaFreeze[] {
  const prior = readNbaFreezes(storage)
  if (prior.some((item) => item.id === record.id)) throw new Error('Duplicate NBA scan; rescan for a new observation before freezing')
  const updated = [...prior, record]
  storage.setItem(NBA_FREEZE_KEY, JSON.stringify(updated))
  return updated
}

export function trackNbaPick(storage: Storage, scan: NbaScan, gameId: string, nowIso: string): NbaFreeze {
  const game = scan.games.find((item) => item.gameId === gameId)
  if (!game?.studySide) throw new Error('No priced paper pick for this game')
  const evidence: NbaEvidence = { requestedPaper: true, availabilitySource: '', availabilityObservedAt: '',
    availabilityNotes: '', rulesSource: '', feeSource: '', uncertaintyAccepted: false, rationale: '' }
  // Validate scan freshness, all selected-date games and the pre-tip boundary even
  // for the one-click path. Other games are retained for audit but not requested.
  const snapshot = freezeNbaStudy(scan, { [gameId]: evidence }, nowIso)
  const chosen = snapshot.decisions.find((decision) => decision.gameId === gameId)
  if (!chosen?.selected || chosen.reasons.some((reason) =>
    ['Independent score forecast missing', 'Raw sized orderbook missing or stale',
      'No positive post-estimated-cost model gap', 'Contract rule text missing'].includes(reason))) {
    throw new Error('No valid priced book, forecast, cost or contract rule for this paper pick')
  }
  if (readNbaFreezes(storage).some((record) => record.decisions.some((decision) =>
    decision.gameId === gameId && decision.selected && decision.evidence?.requestedPaper))) {
    throw new Error('Already tracking a paper pick for this game')
  }
  const record = { ...snapshot, id: `${snapshot.id}:${gameId}` }
  appendNbaFreeze(storage, record)
  return record
}

export function readNbaReviews(storage: Storage): NbaReview[] {
  const text = storage.getItem(NBA_REVIEW_KEY)
  if (!text) return []
  try {
    const value: unknown = JSON.parse(text)
    if (!Array.isArray(value) || value.some((v) => !v || typeof v.id !== 'string' || v.label !== 'SIMULATED_NO_FILL')) throw new Error('Malformed review')
    return value as NbaReview[]
  } catch { throw new Error('NBA review ledger is corrupt; export/recover it before writing') }
}

export function summarizeNbaHistory(freezes: NbaFreeze[], reviews: NbaReview[]) {
  const entries = freezes.flatMap((freeze) => freeze.decisions.filter((decision) => decision.selected && decision.evidence?.requestedPaper)
    .map((decision) => ({ freeze, decision, review: reviews.find((item) => item.id === `${freeze.id}:${decision.gameId}`) ?? null })))
  return { entries, pending: entries.filter((entry) => !entry.review).length,
    wins: entries.filter((entry) => entry.review?.outcome !== 'FAIR_PRICE' && entry.review?.payout === 1).length,
    losses: entries.filter((entry) => entry.review?.outcome !== 'FAIR_PRICE' && entry.review?.payout === 0).length,
    fairPrice: entries.filter((entry) => entry.review?.outcome === 'FAIR_PRICE').length,
    simulatedNetUnits: entries.reduce((sum, entry) => sum + (entry.review ? nbaReturnUnits(entry.review) : 0), 0) }
}

// A paper position stakes one unit equal to the all-in cost of its 10-contract
// snapshot. Normalize legacy $25/unit reviews for display without rewriting them.
export function nbaReturnUnits(review: NbaReview): number {
  return (review.payout - review.entryCostPerContract) / review.entryCostPerContract
}

export function appendNbaReview(storage: Storage, input: NbaReviewInput, nowIso = new Date().toISOString()): NbaReview {
  const frozen = readNbaFreezes(storage).find((item) => item.id === input.scanId)
  if (!frozen) throw new Error('No frozen NBA scan for review')
  const decision = frozen.decisions.find((item) => item.gameId === input.gameId)
  const game = frozen.scan.games.find((item) => item.gameId === input.gameId)
  if (!decision?.evidence?.requestedPaper || !decision.selected || !game) throw new Error('No requested frozen paper experiment for this game')
  const observed = Date.parse(input.observedAt)
  if (!Number.isFinite(observed) || observed <= Date.parse(game.startsAt)) throw new Error('Cannot settle before game tip')
  if (!Number.isFinite(Date.parse(nowIso)) || observed > Date.parse(nowIso)) throw new Error('Review observation cannot be in the future')
  const source = new URL(input.source)
  if (source.protocol !== 'https:' || source.hostname !== 'external-api.kalshi.com' ||
    !source.pathname.includes(decision.selected.ticker)) throw new Error('Exact Kalshi settlement source required')
  if (!['YES', 'NO', 'FAIR_PRICE'].includes(input.outcome) || !Number.isFinite(input.payout) ||
    input.payout < 0 || input.payout > 1 ||
    (input.outcome === 'YES' && input.payout !== (decision.selected.side === 'yes' ? 1 : 0)) ||
    (input.outcome === 'NO' && input.payout !== (decision.selected.side === 'no' ? 1 : 0)) ||
    (input.outcome === 'FAIR_PRICE' && (input.payout === 0 || input.payout === 1)) || input.note.trim().length < 15) {
    throw new Error('Complete settlement outcome, payout and notes required')
  }
  const prior = readNbaReviews(storage)
  const id = `${input.scanId}:${input.gameId}`
  if (prior.some((review) => review.id === id)) throw new Error('Duplicate NBA settlement review; original decision is immutable')
  const review: NbaReview = { ...input, id, simulatedNetUnits: (input.payout - decision.selected.allInCost) / decision.selected.allInCost,
    stakeUnits: 1, unitBasis: 'ENTRY_STAKE', entryCostPerContract: decision.selected.allInCost,
    quantity: frozen.scan.quantity, label: 'SIMULATED_NO_FILL' }
  storage.setItem(NBA_REVIEW_KEY, JSON.stringify([...prior, review]))
  return review
}
