import { describe, expect, it } from 'vitest'
import { recordSettlement, summarizePaper, exportPaperLog, type PaperEntry } from './paper-log'

const candidate = { matchup: 'Blue @ Red', contract: 'GAME-RED', side: 'YES', observedAt: '2026-10-02T12:00:00Z',
  allInCost: 0.55, modelProbability: 0.64, modelSource: 'score-v2', modelObservedAt: '2026-10-02T11:00:00Z',
  consensusProbability: null, consensusSource: '', crowdMoneyPercent: null, crowdSource: '',
  rulesChecked: true, newsChecked: true, depthChecked: true }
const entry = (id = '1'): PaperEntry => ({ id, candidate, contracts: 20, outcome: 'pending', results: [
  { id: 'value', name: 'Value', status: 'PAPER', reasons: [], payoutMultiple: 1 / 0.55 },
  { id: 'consensus', name: 'Consensus', status: 'REJECT', reasons: ['No quote'], payoutMultiple: 1 / 0.55 },
  { id: 'crowd', name: 'Crowd', status: 'PAPER', reasons: [], payoutMultiple: 1 / 0.55 },
] })

describe('paper outcome log', () => {
  it('requires a settlement source and a documented loss review without changing the frozen candidate', () => {
    const original = entry()
    expect(() => recordSettlement(original, { outcome: 'loss', source: '', reason: 'forecast', note: 'Bad lineup' }, '2026-10-05T12:00:00Z')).toThrow(/source/i)
    expect(() => recordSettlement(original, { outcome: 'loss', source: 'Official market', reason: 'forecast', note: '' }, '2026-10-05T12:00:00Z')).toThrow(/explanation/i)
    const settled = recordSettlement(original, { outcome: 'loss', source: 'Official market URL', reason: 'unknown', note: 'Needs investigation' }, '2026-10-05T12:00:00Z')
    expect(settled.candidate).toEqual(original.candidate)
    expect(settled.results).toEqual(original.results)
    expect(settled.settlement).toMatchObject({ source: 'Official market URL', payout: 0, observedAt: '2026-10-05T12:00:00Z' })
    expect(settled.review).toMatchObject({ reason: 'unknown', note: 'Needs investigation', reviewedAt: '2026-10-05T12:00:00Z' })
    expect(settled.history).toHaveLength(1)
    expect(original.outcome).toBe('pending')
  })

  it('journals corrections without erasing prior evidence and clears the previous review', () => {
    const lost = recordSettlement(entry(), { outcome: 'loss', source: 'Result A', reason: 'variance', note: 'No identified process error' }, '2026-10-05T12:00:00Z')
    const corrected = recordSettlement(lost, { outcome: 'win', source: 'Corrected official result', reason: 'none', note: 'Correction to market result' }, '2026-10-06T12:00:00Z')
    expect(corrected.outcome).toBe('win')
    expect(corrected.history).toHaveLength(2)
    expect(corrected.history?.[0].settlement.source).toBe('Result A')
    expect(corrected.history?.[1].previousOutcome).toBe('loss')
    expect(corrected.review?.reason).toBe('none')
  })

  it('handles partial payouts and voids without calling either a binary win or loss', () => {
    const partial = recordSettlement(entry(), { outcome: 'partial', payout: 0.5, source: 'Tie rule', reason: 'none', note: '' }, '2026-10-05T12:00:00Z')
    expect(summarizePaper([partial]).net).toBe(-1)
    expect(summarizePaper([partial]).brier).toBeNull()
    const voided = recordSettlement(entry(), { outcome: 'void', source: 'Voided market', reason: 'none', note: '' }, '2026-10-05T12:00:00Z')
    expect(summarizePaper([voided]).net).toBe(0)
    expect(() => recordSettlement(entry(), { outcome: 'partial', payout: 1.2, source: 'X', reason: 'none', note: '' }, '2026-10-05T12:00:00Z')).toThrow(/payout/i)
  })

  it('counts candidates once across correlated strategies, excludes rejects and reports loss causes as hypotheses', () => {
    const loss = recordSettlement(entry(), { outcome: 'loss', source: 'Official', reason: 'data', note: 'Lineup feed was stale' }, '2026-10-05T12:00:00Z')
    const win = recordSettlement(entry('2'), { outcome: 'win', source: 'Official', reason: 'none', note: '' }, '2026-10-05T12:00:00Z')
    const rejected = { ...entry('3'), results: entry().results.map((r) => ({ ...r, status: 'REJECT' as const })), outcome: 'loss' as const }
    const stats = summarizePaper([loss, win, rejected])
    expect(stats).toMatchObject({ wins: 1, losses: 1, net: -2, reviewedLosses: 1, reviewQueue: 0, reasons: { data: 1 } })
    expect(stats.brier).toBeCloseTo((0.64 ** 2 + 0.36 ** 2) / 2)
    expect(stats.byStrategy.value.net).toBe(-2)
    expect(stats.byStrategy.consensus.settled).toBe(0)
    expect(stats.byModel['score-v2'].losses).toBe(1)
  })

  it('exports frozen decisions and revision history without appending synthetic results', () => {
    const loss = recordSettlement(entry(), { outcome: 'loss', source: 'Market result', reason: 'unknown', note: 'Investigate' }, '2026-10-05T12:00:00Z')
    const exported = JSON.parse(exportPaperLog([loss]))
    expect(exported.version).toBe(1)
    expect(exported.entries[0].candidate.modelProbability).toBe(0.64)
    expect(exported.entries[0].history[0].review.reason).toBe('unknown')
  })
})
