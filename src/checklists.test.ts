import { describe, expect, it } from 'vitest'
import { evaluate, paperSize, type PaperCandidate } from './checklists'

const candidate: PaperCandidate = {
  matchup: 'Example vs Example', contract: 'GAME-WINNER', side: 'YES',
  observedAt: '2026-10-02T18:00:00.000Z',
  allInCost: 0.55, modelProbability: 0.64, consensusProbability: 0.62,
  consensusSource: 'Independent quote snapshot', crowdMoneyPercent: 40,
  crowdSource: 'Book sample, dollar split', rulesChecked: true, newsChecked: true,
  depthChecked: true,
}

const now = Date.parse('2026-10-02T18:10:00.000Z')

describe('paper checklist evaluations', () => {
  it('runs the same snapshot through all three independent strategies', () => {
    const results = evaluate(candidate, now)
    expect(results.map((result) => result.status)).toEqual(['PAPER', 'PAPER', 'PAPER'])
    expect(results[0].payoutMultiple).toBeCloseTo(1 / 0.55)
  })

  it('rejects shared failures including stale quotes and insufficient payout', () => {
    const results = evaluate({ ...candidate, allInCost: 0.60, observedAt: '2026-10-02T17:00:00.000Z' }, now)
    expect(results.every((result) => result.status === 'REJECT')).toBe(true)
    expect(results[0].reasons).toContain('Winning payout is below 1.7× all-in cost')
    expect(results[0].reasons).toContain('Snapshot is stale or in the future')
  })

  it('uses independent consensus only for the consensus strategy', () => {
    const results = evaluate({ ...candidate, consensusProbability: null, consensusSource: '' }, now)
    expect(results.map((result) => result.status)).toEqual(['PAPER', 'REJECT', 'PAPER'])
  })

  it('does not infer crowd money when missing and cautions rather than fading crowded sides', () => {
    const missing = evaluate({ ...candidate, crowdMoneyPercent: null, crowdSource: '' }, now)
    expect(missing.map((result) => result.status)).toEqual(['PAPER', 'PAPER', 'REJECT'])
    const crowded = evaluate({ ...candidate, crowdMoneyPercent: 75 }, now)
    expect(crowded.map((result) => result.status)).toEqual(['PAPER', 'PAPER', 'REJECT'])
  })

  it('rejects malformed probabilities and unchecked rules rather than passing NaN', () => {
    const results = evaluate({ ...candidate, modelProbability: Number.NaN, rulesChecked: false }, now)
    expect(results.every((result) => result.status === 'REJECT')).toBe(true)
  })

  it('separates a small model edge from a consensus-supported opportunity', () => {
    const results = evaluate({ ...candidate, modelProbability: 0.58, consensusProbability: 0.62 }, now)
    expect(results.map((result) => result.status)).toEqual(['REJECT', 'REJECT', 'REJECT'])
  })

  it('sizes whole contracts from a $25 unit without exceeding the intended stake', () => {
    expect(paperSize(0.5, 0.55)).toEqual({ contracts: 22, exposure: 12.1, target: 12.5 })
    expect(paperSize(2, 0.6)).toEqual({ contracts: 83, exposure: 49.8, target: 50 })
    expect(paperSize(0, 0.55)).toEqual({ contracts: 0, exposure: 0, target: 0 })
  })

  it('allows the 1.65× floor only at exactly 2 units with a documented conviction case', () => {
    const high = { ...candidate, units: 2, allInCost: 0.6, modelProbability: 0.68,
      consensusProbability: 0.68, highConfidence: true, confidenceRationale: 'Independent injury-adjusted estimate, source and timestamp' }
    expect(evaluate(high, now).map((r) => r.status)).toEqual(['PAPER', 'PAPER', 'PAPER'])
    expect(evaluate({ ...high, units: 1.99 }, now).every((r) => r.status === 'REJECT')).toBe(true)
    expect(evaluate({ ...high, highConfidence: false }, now)[0].reasons).toContain('2-unit play needs a documented high-confidence case')
    expect(evaluate({ ...high, confidenceRationale: '' }, now)[0].status).toBe('REJECT')
    expect(evaluate({ ...high, allInCost: 0.61 }, now)[0].status).toBe('REJECT')
  })

  it('rejects oversize, fractional-cent units, zero allocation and insufficient contract budget', () => {
    for (const units of [-0.01, 0, 2.01, 0.001]) {
      expect(evaluate({ ...candidate, units }, now).every((r) => r.status === 'REJECT')).toBe(true)
    }
    expect(evaluate({ ...candidate, units: 0.01 }, now)[0].reasons).toContain('Unit allocation cannot buy one whole contract')
  })
})
