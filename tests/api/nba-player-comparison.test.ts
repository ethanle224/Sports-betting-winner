import { describe, expect, it } from 'vitest'
import { compareNbaPlayerTotals, type NbaPricedCandidate } from '../../server/nba-kalshi'

const candidate = (ticker: string, side: 'yes' | 'no', probability: number, allInCost: number): NbaPricedCandidate => ({
  ticker, market: 'total', side, line: 228.5, probability, price: allInCost - .0175,
  feeEstimate: .175, allInCost, estimatedNetEdge: probability - allInCost, rules: 'Exact total rule', rulesSecondary: 'Fair-price clause',
})

it('marks active comparison as unvalidated paper-only and retains the complete score-only baseline', () => {
  const total = candidate('T', 'yes', .6, .5)
  const result = compareNbaPlayerTotals([total, { ...total, ticker: 'ML', market: 'moneyline' }], () => .8, 'main')
  expect(result).toMatchObject({ status: 'PAPER_ONLY_EXPERIMENT', promotionGate: 'USER_APPROVED_PAPER_ONLY' })
  expect(result.baselineCandidates).toHaveLength(2)
})

describe('same-quote player totals shadow comparison', () => {
  it.each([NaN, Infinity, -0.1, 1.1])('abstains on invalid simulated probability %s', (probability) => {
    expect(compareNbaPlayerTotals([candidate('T1', 'yes', .6, .5)], () => probability).studySide).toBeNull()
  })
  it('returns no shadow when inputs are unknown or every estimated cost gap is nonpositive', () => {
    const baseline = [candidate('T1', 'yes', .6, .5)]
    expect(compareNbaPlayerTotals(baseline, () => null).candidates).toEqual([])
    expect(compareNbaPlayerTotals(baseline, () => .4).studySide).toBeNull()
    expect(compareNbaPlayerTotals(baseline, () => .5).studySide).toBeNull()
  })
  it('rescores only observed totals, preserves baseline inputs, and selects at most one positive-gap shadow', () => {
    const baseline = [candidate('T1', 'yes', .6, .5), candidate('T1', 'no', .4, .48),
      { ...candidate('ML', 'yes', .9, .5), market: 'moneyline' as const, line: null }]
    const before = JSON.stringify(baseline)
    const result = compareNbaPlayerTotals(baseline, (kind) => kind === 'over' ? .3 : .7)
    expect(result.status).toBe('SHADOW_ONLY')
    expect(result.studySide).toMatchObject({ ticker: 'T1', side: 'no', probability: .7, allInCost: .48, estimatedNetEdge: .7 - .48 })
    expect(result.baselineStudySide).toEqual(baseline[0])
    expect(result.candidates).toHaveLength(2)
    expect(result.baselineCandidates).toEqual(baseline.slice(0, 2))
    expect(JSON.stringify(baseline)).toBe(before)
    expect(result.candidates[0].price).toBe(baseline[1].price)
  })
})
