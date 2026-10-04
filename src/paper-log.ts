import type { Assessment, PaperCandidate, StrategyId } from './checklists'

export type Outcome = 'pending' | 'win' | 'loss' | 'partial' | 'void'
export type LossReason = 'forecast' | 'data' | 'execution' | 'rules' | 'exposure' | 'variance' | 'unknown'
export const LOSS_REASONS: { id: LossReason; label: string }[] = [
  { id: 'unknown', label: 'Unclear · investigate' },
  { id: 'forecast', label: 'Probability/model miss' },
  { id: 'data', label: 'Stale/missing lineup or evidence' },
  { id: 'execution', label: 'Price, fee or fill assumption' },
  { id: 'rules', label: 'Wrong contract/settlement rule' },
  { id: 'exposure', label: 'Correlated exposure or sizing' },
  { id: 'variance', label: 'No identified process error · variance hypothesis' },
]
export type ReviewReason = LossReason | 'none'
export type Settlement = { source: string; observedAt: string; payout: number | null }
export type Review = { reason: ReviewReason; note: string; reviewedAt: string }
export type JournalEvent = { recordedAt: string; previousOutcome: Outcome; outcome: Outcome; settlement: Settlement; review: Review }
export type PaperEntry = { id: string; candidate: PaperCandidate; results: Assessment[]; outcome: Outcome; contracts?: number;
  createdAt?: string; settlement?: Settlement; review?: Review; history?: JournalEvent[] }
export type SettlementInput = { outcome: Exclude<Outcome, 'pending'>; source: string; payout?: number; reason: ReviewReason; note: string }

export function recordSettlement(entry: PaperEntry, input: SettlementInput, now = new Date().toISOString()): PaperEntry {
  const source = input.source.trim()
  const note = input.note.trim()
  if (!source) throw new Error('Settlement source or official result URL is required')
  if (!Number.isFinite(Date.parse(now)) || Date.parse(now) < Date.parse(entry.candidate.observedAt)) throw new Error('Settlement time must follow the snapshot')
  if (!['win', 'loss', 'partial', 'void'].includes(input.outcome)) throw new Error('Invalid outcome')
  const payout = input.outcome === 'void' ? null : input.outcome === 'win' ? 1 : input.outcome === 'loss' ? 0 : input.payout
  if (input.outcome === 'partial' && (payout == null || !Number.isFinite(payout) || payout <= 0 || payout >= 1)) throw new Error('Partial payout must be between $0 and $1')
  if (input.outcome === 'loss' && !LOSS_REASONS.some(({ id }) => id === input.reason)) throw new Error('Select a loss reason or unknown')
  if (input.outcome === 'loss' && !note) throw new Error('A loss explanation or investigation note is required')
  if (input.outcome !== 'loss' && input.reason !== 'none') throw new Error('Loss reasons belong on losses only')
  const settlement: Settlement = { source, observedAt: now, payout: payout ?? null }
  const review: Review = { reason: input.reason, note, reviewedAt: now }
  const event: JournalEvent = { recordedAt: now, previousOutcome: entry.outcome, outcome: input.outcome, settlement, review }
  return { ...entry, outcome: input.outcome, settlement, review, history: [...(entry.history ?? []), event] }
}

type Rollup = { wins: number; losses: number; partial: number; voids: number; settled: number; net: number; brier: number | null }
export type PaperSummary = Rollup & { reviewedLosses: number; reviewQueue: number; reasons: Partial<Record<LossReason, number>>;
  byStrategy: Record<StrategyId, Rollup>; byModel: Record<string, Rollup> }
const empty = (): Rollup => ({ wins: 0, losses: 0, partial: 0, voids: 0, settled: 0, net: 0, brier: null })
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
function apply(rollup: Rollup, entry: PaperEntry, brier: { sum: number; count: number }) {
  if (entry.outcome === 'pending') return
  rollup.settled++
  if (entry.outcome === 'win') rollup.wins++
  if (entry.outcome === 'loss') rollup.losses++
  if (entry.outcome === 'partial') rollup.partial++
  if (entry.outcome === 'void') rollup.voids++
  const quantity = entry.contracts ?? (entry.candidate.units === undefined ? 10 : 0)
  const cost = entry.candidate.allInCost
  if (entry.outcome !== 'void' && quantity > 0 && Number.isFinite(cost)) {
    rollup.net = round(rollup.net + quantity * ((entry.settlement?.payout ?? (entry.outcome === 'win' ? 1 : entry.outcome === 'loss' ? 0 : 0)) - cost))
  }
  const probability = entry.candidate.modelProbability
  if ((entry.outcome === 'win' || entry.outcome === 'loss') && Number.isFinite(probability) && probability > 0 && probability < 1) {
    brier.sum += (probability - (entry.outcome === 'win' ? 1 : 0)) ** 2
    brier.count++
    rollup.brier = brier.sum / brier.count
  }
}
export function summarizePaper(entries: PaperEntry[]): PaperSummary {
  const overall = empty()
  const byStrategy = { value: empty(), consensus: empty(), crowd: empty() }
  const byModel: Record<string, Rollup> = Object.create(null) as Record<string, Rollup>
  const counts = new Map<Rollup, { sum: number; count: number }>()
  const score = (rollup: Rollup, entry: PaperEntry) => {
    if (!counts.has(rollup)) counts.set(rollup, { sum: 0, count: 0 })
    apply(rollup, entry, counts.get(rollup)!)
  }
  const reasons: Partial<Record<LossReason, number>> = {}
  let reviewedLosses = 0
  let reviewQueue = 0
  for (const entry of entries) {
    const eligible = entry.results.filter((result) => result.status === 'PAPER')
    if (!eligible.length) continue
    score(overall, entry)
    for (const result of eligible) if (result.id in byStrategy) score(byStrategy[result.id], entry)
    if (entry.outcome !== 'pending') {
      const version = entry.candidate.modelSource?.trim() || 'Legacy / unspecified'
      byModel[version] ??= empty()
      score(byModel[version], entry)
    }
    if (entry.outcome === 'loss') {
      if (entry.review?.reason && entry.review.reason !== 'none') {
        reviewedLosses++
        const reason = entry.review.reason
        reasons[reason] = (reasons[reason] ?? 0) + 1
      } else reviewQueue++
    }
  }
  return { ...overall, reviewedLosses, reviewQueue, reasons, byStrategy, byModel }
}

export function exportPaperLog(entries: PaperEntry[]): string {
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), storage: 'browser-local', entries }, null, 2)
}
