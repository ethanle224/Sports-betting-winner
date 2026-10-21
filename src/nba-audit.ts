import { appendNbaReview, readNbaFreezes, readNbaReviews, type NbaFreeze } from './nba-paper'

export const NBA_AUDIT_KEY = 'edgeboard-nba-audits-v1'
export type NbaAuditResponse = { state: 'finalized' | 'pending' | 'needs_review'; reason?: string;
  date?: string; gameId?: string; ticker?: string; observedAt?: string; result?: 'YES' | 'NO' | 'FAIR_PRICE';
  payoutYes?: number; scores?: { home: number; away: number } | null; rulesPrimary?: string; rulesSecondary?: string;
  marketSource?: string; scheduleSource?: string }
export type NbaAuditReport = { id: string; scanId: string; gameId: string; ticker: string; date: string; observedAt: string;
  result: 'YES' | 'NO' | 'FAIR_PRICE'; outcome: 'WIN' | 'LOSS' | 'FAIR_PRICE'; payout: number;
  classification: 'CAUSE_UNDETERMINED'; explanation: string; marketSource: string; scheduleSource: string;
  actual: { home: number; away: number; total: number; homeMargin: number } | null;
  model: { name: string; selectedProbability: number; snapshotPrice: number; brier: number | null;
    priceBrier: number | null; expectedMargin: number | null; expectedTotal: number | null;
    marginResidual: number | null; totalResidual: number | null };
  gaps: string[]; recommendations: string[] }
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

export function readNbaAudits(storage: Storage): NbaAuditReport[] {
  const text = storage.getItem(NBA_AUDIT_KEY)
  if (!text) return []
  try {
    const value: unknown = JSON.parse(text)
    if (!Array.isArray(value) || value.some((item) => !item || typeof item.id !== 'string' ||
      item.classification !== 'CAUSE_UNDETERMINED' || !Array.isArray(item.recommendations))) throw new Error('Malformed audit')
    return value as NbaAuditReport[]
  } catch { throw new Error('NBA audit ledger is corrupt; export/recover it before writing') }
}

export function auditTrackedPick(storage: Storage, frozen: NbaFreeze, gameId: string, fetched: NbaAuditResponse,
  nowIso = new Date().toISOString()): NbaAuditReport {
  const saved = readNbaFreezes(storage).find((record) => record.id === frozen.id)
  if (!saved || JSON.stringify(saved) !== JSON.stringify(frozen)) throw new Error('Frozen paper decision changed or missing')
  const existingAudits = readNbaAudits(storage)
  const id = `${frozen.id}:${gameId}`
  if (existingAudits.some((item) => item.id === id)) throw new Error('Paper pick already audited')
  const decision = frozen.decisions.find((item) => item.gameId === gameId && item.selected && item.evidence?.requestedPaper)
  const game = frozen.scan.games.find((item) => item.gameId === gameId)
  const side = decision?.selected
  if (!decision || !game || !side) throw new Error('No tracked paper pick to audit')
  const when = Date.parse(fetched.observedAt ?? '')
  const now = Date.parse(nowIso)
  const marketSource = `https://external-api.kalshi.com/trade-api/v2/markets/${side.ticker}`
  const scheduleSource = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${frozen.scan.date.replaceAll('-', '')}`
  if (fetched.state !== 'finalized' || !['YES', 'NO', 'FAIR_PRICE'].includes(fetched.result ?? '') ||
    fetched.ticker !== side.ticker || fetched.gameId !== gameId || fetched.date !== frozen.scan.date ||
    fetched.rulesPrimary !== side.rules || fetched.rulesSecondary !== side.rulesSecondary ||
    fetched.marketSource !== marketSource || fetched.scheduleSource !== scheduleSource ||
    !Number.isFinite(now) || !Number.isFinite(when) || when > now || when <= Date.parse(game.startsAt) ||
    !Number.isFinite(fetched.payoutYes) || fetched.payoutYes! < 0 || fetched.payoutYes! > 1 ||
    (fetched.result === 'YES' && fetched.payoutYes !== 1) || (fetched.result === 'NO' && fetched.payoutYes !== 0) ||
    (fetched.result === 'FAIR_PRICE' && (fetched.payoutYes! <= 0 || fetched.payoutYes! >= 1))) {
    throw new Error('Exact finalized contract and official source evidence required')
  }
  const scores = fetched.scores
  if (fetched.result !== 'FAIR_PRICE' && (!scores || !Number.isInteger(scores.home) || !Number.isInteger(scores.away) ||
    scores.home < 0 || scores.away < 0 || scores.home > 300 || scores.away > 300 || scores.home === scores.away)) {
    throw new Error('Official final score required for binary settlement audit')
  }
  const payout = side.side === 'yes' ? fetched.payoutYes! : 1 - fetched.payoutYes!
  const outcome = fetched.result === 'FAIR_PRICE' ? 'FAIR_PRICE' : payout === 1 ? 'WIN' : 'LOSS'
  const priorReview = readNbaReviews(storage).find((item) => item.id === id)
  if (priorReview && (priorReview.outcome !== fetched.result || Math.abs(priorReview.payout - payout) > .00001)) {
    throw new Error('Public settlement conflicts with an earlier manual review; inspect before proceeding')
  }
  const actual = scores && fetched.result !== 'FAIR_PRICE' ? { home: scores.home, away: scores.away,
    total: scores.home + scores.away, homeMargin: scores.home - scores.away } : null
  const forecast = game.forecast
  const expectedMargin = typeof forecast?.expectedMargin === 'number' && Number.isFinite(forecast.expectedMargin) ? forecast.expectedMargin : null
  const expectedTotal = typeof forecast?.expectedTotal === 'number' && Number.isFinite(forecast.expectedTotal) ? forecast.expectedTotal : null
  const gaps = Object.entries(game.factors ?? {}).filter(([, factor]) => factor?.status === 'unknown' || factor?.status === 'estimated')
    .map(([name]) => name)
  const recommendations = ['Keep the frozen decision unchanged; compare model Brier score and net units against the market across a walk-forward sample before adjusting weights.']
  if (['starters', 'injuries', 'rosterMatchup'].some((name) => gaps.includes(name))) {
    recommendations.push('Collect timestamped verified lineup, injury and current-roster evidence before tip; test any roster-adjusted feature on later games, not this outcome.')
  }
  if (['fees', 'depth', 'fillability'].some((name) => gaps.includes(name))) {
    recommendations.push('Check series-specific fees and available depth closer to tip; no real order or guaranteed fill was observed.')
  }
  if (actual && ((expectedMargin !== null && Math.abs(actual.homeMargin - expectedMargin) >= 10) ||
    (expectedTotal !== null && Math.abs(actual.total - expectedTotal) >= 15))) {
    recommendations.push('Study the score residual against the frozen projection and comparable games; a large residual is a diagnostic, not proof of its cause.')
  }
  if (outcome === 'FAIR_PRICE') recommendations.push('Review the postponement and fair-price clause separately from basketball prediction quality.')
  const report: NbaAuditReport = { id, scanId: frozen.id, gameId, ticker: side.ticker, date: frozen.scan.date, observedAt: fetched.observedAt!,
    result: fetched.result!, outcome, payout, classification: 'CAUSE_UNDETERMINED',
    explanation: outcome === 'FAIR_PRICE' ? 'Contract paid a nonbinary fair price; basketball model accuracy is not scored for this resolution. Cause of the contract exception requires separate review.' :
      'The contract outcome and final score are verified. One game cannot establish whether the result was caused by a model error, normal outcome variance or an unmeasured roster/event change.',
    marketSource, scheduleSource, actual,
    model: { name: forecast?.model ?? 'unknown', selectedProbability: side.probability, snapshotPrice: side.price,
      brier: actual ? (side.probability - payout) ** 2 : null, priceBrier: actual ? (side.price - payout) ** 2 : null,
      expectedMargin, expectedTotal, marginResidual: actual && expectedMargin !== null ? actual.homeMargin - expectedMargin : null,
      totalResidual: actual && expectedTotal !== null ? actual.total - expectedTotal : null },
    gaps, recommendations }
  if (!priorReview) {
    appendNbaReview(storage, { scanId: frozen.id, gameId, observedAt: fetched.observedAt!, source: marketSource,
      outcome: fetched.result!, payout,
      note: 'Read-only finalized Kalshi payout checked against the exact frozen contract and ESPN final score or nonbinary fair-price resolution.' }, nowIso)
  }
  // Separate append-only report: a failed write can be retried without rewriting an existing review.
  storage.setItem(NBA_AUDIT_KEY, JSON.stringify([...existingAudits, report]))
  return report
}

export function auditSummary(reports: NbaAuditReport[]) {
  const binary = reports.filter((report) => report.actual && report.model.brier !== null && report.model.priceBrier !== null)
  const average = (key: 'brier' | 'priceBrier') => binary.length ? binary.reduce((sum, report) => sum + report.model[key]!, 0) / binary.length : null
  return { count: reports.length, binaryCount: binary.length, modelBrier: average('brier'), snapshotPriceBrier: average('priceBrier') }
}
