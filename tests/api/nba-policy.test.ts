import { describe, expect, it } from 'vitest'
import { applyNbaSelectionPolicy, applyNbaPlayerSelectionPolicy, compareNbaPlayerMarkets, NBA_SELECTION_POLICY, NBA_PLAYER_SELECTION_POLICY } from '../../server/nba-policy'
import type { NbaPlayerTotalsResult } from '../../server/nba-player-totals'

const simulation = (): NbaPlayerTotalsResult => ({ version: 'nba-player-totals-v2', status: 'estimated', eligibleForPrimary: true,
  simulations: 1000, totals: Array(1000).fill(230), scores: Array.from({ length: 1000 }, () => ({ home: 120, away: 110, overtimePeriods: 0 })),
  observedAt: '2026-10-19T19:55:00Z', asOfCutoff: null, seed: 'test', sources: [], assumptions: [], unknowns: [], reason: null,
  reasons: [], expectedTotal: 230, totalSd: 0, inputs: null })

it('v2 chooses the highest positive simulated gap on the same quotes, not the old winner', () => {
  const baseline = [{ ...side, ticker: 'T1', market: 'total' as const, line: 229.5 },
    { ...side, ticker: 'T2', market: 'total' as const, line: 231.5 }]
  const before = JSON.stringify(baseline)
  const result = applyNbaPlayerSelectionPolicy(baseline, simulation(), 10)
  expect(result.selectionPolicy).toBe(NBA_PLAYER_SELECTION_POLICY)
  expect(result.studySide).toMatchObject({ ticker: 'T1', probability: 1, estimatedNetEdge: 1 - .5175 })
  expect(result.candidates.find((c) => c.ticker === 'T2')?.probability).toBe(0)
  expect(JSON.stringify(baseline)).toBe(before)
})
it.each([
  { status: 'unknown' }, { version: 'nba-player-totals-shadow-v2' }, { eligibleForPrimary: false },
  { simulations: 999 }, { totals: [] }, { scores: [] },
  { scores: Array(1000).fill({ home: 120, away: 109, overtimePeriods: 0 }) },
  { scores: Array(1000).fill({ home: 115, away: 115, overtimePeriods: 0 }) },
  { scores: Array(1000).fill({ home: 120, away: 110, overtimePeriods: 7 }) },
])('v2 fails closed on invalid paired model evidence %j', (changed) => {
  expect(applyNbaPlayerSelectionPolicy([{ ...side, ticker: 'T', market: 'total', line: 229.5 }],
    { ...simulation(), ...changed } as NbaPlayerTotalsResult).studySide).toBeNull()
})
it('v2 rejects sparse paired draws even when NO would otherwise win', () => {
  expect(applyNbaPlayerSelectionPolicy([{ ...side, ticker: 'T', market: 'total', line: 229.5, side: 'no' }],
    { ...simulation(), scores: Array(1000), totals: Array(1000) }).studySide).toBeNull()
})
it.each([0, 101, 1.5, NaN])('v2 rejects invalid quantity %s', (quantity) => {
  expect(applyNbaPlayerSelectionPolicy([{ ...side, market: 'total', line: 229.5 }], simulation(), quantity).studySide).toBeNull()
})
it.each([{ feeEstimate: -1 }, { price: 0 }, { allInCost: .1 }, { rulesSecondary: '' }, { side: 'maybe' }, { line: 229 },
  { price: NaN }, { feeEstimate: NaN }, { rules: '' }, { feeEstimate: 0, allInCost: .5 }])('v2 rejects invalid executable candidate %j', (changed) => {
  expect(applyNbaPlayerSelectionPolicy([{ ...side, market: 'total', line: 229.5, ...changed }], simulation()).studySide).toBeNull()
})
it('v2 uses ticker then YES-before-NO as stable gap-tie order and never forces a nonpositive pick', () => {
  const a = { ...side, ticker: 'A', market: 'total', line: 229.5 }
  const b = { ...a, ticker: 'B' }
  expect(applyNbaPlayerSelectionPolicy([b, a], simulation()).studySide?.ticker).toBe('A')
  expect(applyNbaPlayerSelectionPolicy([{ ...a, line: 230.5 }], simulation()).studySide).toBeNull()
})
it('shadow-compares supported ML, spread, and total on the same executable quote with paired scores', () => {
  const markets = [
    { ticker: 'ML', kind: 'moneyline', team: 'home', rules_primary: 'Exact contract rules', rules_secondary: 'Resolution rules' },
    { ticker: 'SP', kind: 'spread', team: 'away', line: 3.5, rules_primary: 'Exact contract rules', rules_secondary: 'Resolution rules' },
    { ticker: 'TOT', kind: 'total', line: 229.5, rules_primary: 'Exact contract rules', rules_secondary: 'Resolution rules' },
  ] as const
  const candidates = markets.flatMap((m) => ['yes', 'no'].map((contractSide) => ({
    ...side, ticker: m.ticker, market: m.kind, side: contractSide, line: 'line' in m ? m.line : null,
  })))
  const before = JSON.stringify(candidates)
  const result = compareNbaPlayerMarkets(candidates, markets, simulation())
  expect(result).toMatchObject({ status: 'SHADOW_ONLY', eligibleForPrimary: false, pricedSides: 6 })
  expect(result.candidates.map((c) => [c.ticker, c.side, c.probability])).toEqual([
    ['ML', 'yes', 1], ['SP', 'no', 1], ['TOT', 'yes', 1],
    ['ML', 'no', 0], ['SP', 'yes', 0], ['TOT', 'no', 0],
  ])
  expect(JSON.stringify(candidates)).toBe(before)
})
it('shadow fails closed on missing mapping, invalid books/rules, ties, malformed draws and unavailable simulation', () => {
  const markets = [{ ticker: 'ML', kind: 'moneyline' as const, team: 'home' as const,
    rules_primary: 'Exact contract rules', rules_secondary: 'Resolution rules' }]
  const candidate = { ...side, ticker: 'ML', market: 'moneyline' as const, line: null }
  expect(compareNbaPlayerMarkets([candidate], markets, simulation()).candidates).toHaveLength(1)
  for (const bad of [{ ...candidate, ticker: 'UNKNOWN' }, { ...candidate, allInCost: .1 },
    { ...candidate, rules: '' }, { ...candidate, side: 'maybe' }, { ...candidate, line: 3.5 }]) {
    expect(compareNbaPlayerMarkets([bad], markets, simulation()).candidates).toEqual([])
  }
  expect(compareNbaPlayerMarkets([candidate], [{ ...markets[0], team: undefined }], simulation()).candidates).toEqual([])
  expect(compareNbaPlayerMarkets([candidate], markets, { ...simulation(), scores: Array(1000).fill({ home: 110, away: 110, overtimePeriods: 0 }) }).candidates).toEqual([])
  expect(compareNbaPlayerMarkets([candidate], markets, null).candidates).toEqual([])
})
import { pricedNbaSide, type NbaPricedCandidate } from '../../server/nba-kalshi'

const side: NbaPricedCandidate = { ticker: 'TEST', market: 'spread', side: 'yes', line: 3.5,
  probability: .7, price: .5, feeEstimate: .175, allInCost: .5175, estimatedNetEdge: .1825,
  rules: 'Exact contract rules', rulesSecondary: 'Resolution rules' }

describe('versioned NBA forward-paper selection policy', () => {
  it('quarantines spread and moneyline primaries without erasing the baseline comparison', () => {
    for (const market of ['spread', 'moneyline'] as const) {
      const baseline = { ...side, market }
      const result = applyNbaSelectionPolicy(baseline)
      expect(result).toMatchObject({ studySide: null, baselineStudySide: baseline,
        selectionPolicy: NBA_SELECTION_POLICY, abstentionReason: expect.stringContaining('side-model') })
      expect(result.baselineStudySide).toBe(baseline)
      expect(baseline).toEqual({ ...side, market })
    }
  })
  it('preserves an already selected positive-gap total exactly; it does not promote a fallback total', () => {
    const total = { ...side, market: 'total' as const, line: 229.5 }
    expect(applyNbaSelectionPolicy(total)).toMatchObject({ studySide: total, baselineStudySide: total, abstentionReason: null })
    expect(applyNbaSelectionPolicy(null).studySide).toBeNull()
  })
  it('rejects a total whose recorded zero fee disagrees with its all-in cost', () => {
    const baseline = { ...side, market: 'total' as const, line: 229.5, feeEstimate: 0 }
    const result = applyNbaSelectionPolicy(baseline)
    expect(result.studySide).toBeNull()
    expect(result.baselineStudySide).toBe(baseline)
  })
  it.each([0, -1, .5, 101, NaN, Infinity, -Infinity, null, '10'])('rejects invalid quote quantity %s', (quantity) => {
    const baseline = { ...side, market: 'total' as const, line: 229.5,
      feeEstimate: 0, allInCost: .5, estimatedNetEdge: .2 }
    const result = applyNbaSelectionPolicy(baseline, quantity as number)
    expect(result.studySide).toBeNull()
    expect(result.baselineStudySide).toBe(baseline)
  })
  it.each([
    { label: 'higher recorded fee', changed: { feeEstimate: 2 } },
    { label: 'higher recorded price', changed: { price: .9 } },
    { label: 'lower recorded price', changed: { price: .4 } },
    { label: 'higher all-in cost with a matching edge', changed: { allInCost: .6175, estimatedNetEdge: .0825 } },
  ])('rejects an unreconciled $label without changing the baseline', ({ changed }) => {
    const baseline = { ...side, market: 'total' as const, line: 229.5, ...changed }
    const before = { ...baseline }
    const result = applyNbaSelectionPolicy(baseline)
    expect(result.studySide).toBeNull()
    expect(result.baselineStudySide).toBe(baseline)
    expect(baseline).toEqual(before)
    expect(result.abstentionReason).toContain('no substitute')
  })
  it.each(['price', 'feeEstimate', 'allInCost'].flatMap((component) =>
    [NaN, Infinity, -Infinity, undefined, null, '0.5'].map((value) => ({ component, value }))))(
    'rejects JSON round-tripped malformed $component=$value', ({ component, value }) => {
      const baseline: NbaPricedCandidate = JSON.parse(JSON.stringify({ ...side, market: 'total', line: 229.5, [component]: value }))
      const result = applyNbaSelectionPolicy(baseline)
      expect(result.studySide).toBeNull()
      expect(result.baselineStudySide).toBe(baseline)
    })
  it.each([1, 10, 100])('retains real sized quotes at quantity %s, including multi-level books', (quantity) => {
    const book = { orderbook_fp: { no_dollars: [['0.53', '2'], ['0.49', '100']],
      yes_dollars: [['0.51', '3'], ['0.48', '100']] } }
    for (const contractSide of ['yes', 'no'] as const) {
      const quote = pricedNbaSide(book, contractSide, quantity)!
      expect(quote).not.toBeNull()
      if (quantity > 3) expect(quote.price).toBeGreaterThan(contractSide === 'yes' ? 1 - .53 : 1 - .51)
      const baseline = { ...side, market: 'total' as const, side: contractSide, line: 229.5,
        price: quote.price, feeEstimate: quote.feeEstimate, allInCost: quote.allInCost,
        estimatedNetEdge: side.probability - quote.allInCost }
      const before = { ...baseline }
      const result = applyNbaSelectionPolicy(baseline, quantity)
      expect(result.studySide).toBe(baseline)
      expect(result.baselineStudySide).toBe(baseline)
      expect(baseline).toEqual(before)
      if (quantity !== 10) expect(applyNbaSelectionPolicy(baseline).studySide).toBeNull()
    }
  })
  it('reconciles the recorded fee without re-estimating it from a fee model', () => {
    const baseline = { ...side, market: 'total' as const, line: 229.5,
      feeEstimate: .5, allInCost: .55, estimatedNetEdge: .15 }
    expect(applyNbaSelectionPolicy(baseline).studySide).toBe(baseline)
  })
  it.each([-1e-9, 1e-9, -1e-7, 1e-7])('uses a floating tolerance for recorded quote/cost difference %s', (difference) => {
    const allInCost = side.allInCost + difference
    const baseline = { ...side, market: 'total' as const, line: 229.5,
      allInCost, estimatedNetEdge: side.probability - allInCost }
    const result = applyNbaSelectionPolicy(baseline)
    if (Math.abs(difference) < 1e-8) expect(result.studySide).toBe(baseline)
    else expect(result.studySide).toBeNull()
  })
  it('does not turn a negative, zero or invalid estimated gap into a primary paper pick', () => {
    for (const gap of [-.1, 0, NaN, Infinity]) {
      expect(applyNbaSelectionPolicy({ ...side, market: 'total', estimatedNetEdge: gap }).studySide).toBeNull()
    }
    for (const cost of [0, 1, NaN]) {
      expect(applyNbaSelectionPolicy({ ...side, market: 'total', allInCost: cost }).studySide).toBeNull()
    }
  })
  it.each([
    { label: 'unknown contract side', changed: { side: 'maybe' } },
    { label: 'empty contract side', changed: { side: '' } },
    { label: 'noncanonical contract side', changed: { side: 'YES' } },
    { label: 'negative price', changed: { price: -.1 } },
    { label: 'zero price', changed: { price: 0 } },
    { label: 'unit price', changed: { price: 1 } },
    { label: 'NaN price', changed: { price: NaN } },
    { label: 'infinite price', changed: { price: Infinity } },
    { label: 'negative fee', changed: { feeEstimate: -.01 } },
    { label: 'NaN fee', changed: { feeEstimate: NaN } },
    { label: 'infinite fee', changed: { feeEstimate: Infinity } },
  ])('refuses a positive-gap total with $label', ({ changed }) => {
    const baseline = { ...side, market: 'total', line: 229.5, ...changed }
    expect(applyNbaSelectionPolicy(baseline)).toMatchObject({ studySide: null, baselineStudySide: baseline })
  })
  it.each(['yes', 'no'])('retains a valid %s total with a finite zero fee', (contractSide) => {
    const baseline = { ...side, market: 'total', side: contractSide, line: 229.5,
      feeEstimate: 0, allInCost: .5, estimatedNetEdge: .2 }
    expect(applyNbaSelectionPolicy(baseline).studySide).toBe(baseline)
  })
  it('fails closed on inconsistent probability/cost, missing rule text or malformed total lines', () => {
    for (const changed of [{ probability: 2 }, { probability: NaN }, { line: null }, { line: NaN },
      { rules: '' }, { rulesSecondary: '' }, { estimatedNetEdge: .5 }]) {
      expect(applyNbaSelectionPolicy({ ...side, market: 'total', ...changed }).studySide).toBeNull()
    }
  })
})
