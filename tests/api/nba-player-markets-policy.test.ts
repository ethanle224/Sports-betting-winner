import { describe, expect, it } from 'vitest'
import { applyNbaPlayerMarketsSelectionPolicy, NBA_PLAYER_MARKETS_SELECTION_POLICY, applyNbaPlayerSelectionPolicy } from '../../server/nba-policy'
import { pricedNbaSide, isNbaBook, validateNbaMarketForGame, type NbaBook, type NbaMarket } from '../../server/nba-kalshi'
import type { NbaPlayerTotalsResult } from '../../server/nba-player-totals'

const simulation = (): NbaPlayerTotalsResult => ({ version: 'nba-player-totals-v2', status: 'estimated', eligibleForPrimary: true,
  simulations: 1000, totals: Array(1000).fill(230), scores: Array.from({ length: 1000 }, (_, i) => ({ home: i < 700 ? 120 : 110, away: i < 700 ? 110 : 120, overtimePeriods: 0 })),
  observedAt: '2026-10-29T19:55:00Z', asOfCutoff: null, seed: 'test', sources: [], assumptions: [], unknowns: [], reason: null,
  reasons: [], expectedTotal: 230, totalSd: 0, inputs: null })
const market = (ticker: string, kind: NbaMarket['kind'], team?: 'home' | 'away', line?: number): NbaMarket => ({
  ticker, kind, team, line, gameId: 'g', event_ticker: 'event', title: ticker,
  series: kind === 'moneyline' ? 'KXNBAGAME' : kind === 'spread' ? 'KXNBASPREAD' : 'KXNBATOTAL',
  rules_primary: 'Exact supported contract rules', rules_secondary: 'Fair-price resolution rules',
})
const book: NbaBook = { orderbook_fp: { yes_dollars: [['0.5', '100']], no_dollars: [['0.5', '100']] } }

describe('v5 experimental cross-market paper primary', () => {
  it('distinguishes a valid empty all-market book from missing or malformed evidence', () => {
    expect(isNbaBook({ orderbook_fp: { yes_dollars: [], no_dollars: [] } })).toBe(true)
    for (const value of [{}, null, [], { orderbook_fp: {} }, { orderbook_fp: { yes_dollars: [], no_dollars: [['NaN', '1']] } }]) {
      expect(isNbaBook(value)).toBe(false)
    }
  })
  it.each([1, 10, 100])('uses sized raw-book prices and fee estimates for quantity %s', (quantity) => {
    const sizedBook = { orderbook_fp: { no_dollars: [['0.55', '1'], ['0.5', '99']], yes_dollars: [['0.5', '100']] } }
    const result = applyNbaPlayerMarketsSelectionPolicy([market('ML', 'moneyline', 'home')], { ML: sizedBook }, simulation(), quantity)
    const { price, feeEstimate, allInCost } = pricedNbaSide(sizedBook, 'yes', quantity)!
    expect(result.studySide).toMatchObject({ side: 'yes', price, feeEstimate, allInCost })
    expect(result.studySide!.estimatedNetEdge).toBeCloseTo(.7 - result.studySide!.allInCost)
  })
  it('abstains on nonpositive gaps, illiquid books, invalid quantity and invalid paired evidence', () => {
    const m = market('ML', 'moneyline', 'home')
    const neutral = simulation(); neutral.scores = neutral.scores.map((_, i) => ({ home: i < 500 ? 120 : 110, away: i < 500 ? 110 : 120, overtimePeriods: 0 }))
    expect(applyNbaPlayerMarketsSelectionPolicy([m], { ML: book }, neutral).studySide).toBeNull()
    expect(applyNbaPlayerMarketsSelectionPolicy([m], { ML: {} }, simulation()).studySide).toBeNull()
    expect(applyNbaPlayerMarketsSelectionPolicy([m], { ML: book }, simulation(), 0).candidates).toEqual([])
    for (const model of [null, { ...simulation(), status: 'unknown' as const }, { ...simulation(), scores: Array(1000) },
      { ...simulation(), totals: Array(1000).fill(231) }, { ...simulation(), eligibleForPrimary: false }]) {
      expect(applyNbaPlayerMarketsSelectionPolicy([m], { ML: book }, model).studySide).toBeNull()
    }
    expect(applyNbaPlayerMarketsSelectionPolicy([m, m], { ML: book }, simulation()).candidates).toEqual([])
  })
  it('preserves v4 totals-only historical policy and deterministic v5 ties', () => {
    const ml = market('ML', 'moneyline', 'home'); const a = market('A', 'spread', 'home', 9.5)
    const current = applyNbaPlayerMarketsSelectionPolicy([ml, a], { ML: book, A: book }, simulation())
    expect(current.studySide?.ticker).toBe('A')
    expect(applyNbaPlayerSelectionPolicy(current.candidates, simulation()).studySide).toBeNull()
  })
  it.each([
    ['moneyline', 'home', undefined, .7], ['moneyline', 'away', undefined, .3],
    ['spread', 'home', 9.5, .7], ['spread', 'home', 10.5, 0], ['spread', 'away', 9.5, .3],
    ['total', undefined, 229.5, 1], ['total', undefined, 230.5, 0],
  ] as const)('prices %s %s %s from paired outcome frequencies, including complementary NO', (kind, team, line, yes) => {
    const result = applyNbaPlayerMarketsSelectionPolicy([market('T', kind, team, line)], { T: book }, simulation())
    expect(result.candidates.find((c) => c.side === 'yes')?.probability).toBeCloseTo(yes)
    expect(result.candidates.find((c) => c.side === 'no')?.probability).toBeCloseTo(1 - yes)
    expect(result.studySide?.side).toBe(yes > .5 ? 'yes' : 'no')
  })
  it('rejects unsupported mapped lines instead of estimating a primary', () => {
    for (const m of [market('T', 'total', undefined, 10.5), market('T', 'total', undefined, 400.5),
      market('T', 'spread', 'home', 100.5), market('T', 'spread', 'home', 0), market('T', 'moneyline')]) {
      expect(applyNbaPlayerMarketsSelectionPolicy([m], { T: book }, simulation()).studySide).toBeNull()
    }
  })
  it('binds parsed contract team, line and raw evidence to the selected game', () => {
    const m = { ...market('KXNBASPREAD-26OCT29BOSDET-BOS4', 'spread', 'away', 3.5),
      event_ticker: 'KXNBASPREAD-26OCT29BOSDET',
      rules_primary: 'If Boston wins by more than 3.5 points in the Boston vs Detroit Pro Basketball game originally scheduled for Oct 29, 2026, then the market resolves to Yes.' }
    m.raw = { ticker: m.ticker, event_ticker: m.event_ticker, title: m.title, rules_primary: m.rules_primary, rules_secondary: m.rules_secondary }
    const game = { gameId: 'g', home: 'Detroit', away: 'Boston', date: '2026-10-29' }
    expect(validateNbaMarketForGame(m, game)).toBe(true)
    expect(validateNbaMarketForGame({ ...m, team: 'home' }, game)).toBe(false)
    expect(validateNbaMarketForGame({ ...m, line: 4.5 }, game)).toBe(false)
    expect(validateNbaMarketForGame({ ...m, raw: { ...m.raw, rules_primary: 'forged' } }, game)).toBe(false)
  })
  it('can select ML instead of totals from empirical paired winners without an old-model forecast', () => {
    const markets = [market('ML', 'moneyline', 'home'), market('SP', 'spread', 'home', 12.5), market('TOT', 'total', undefined, 230.5)]
    const books = { ML: book, SP: { orderbook_fp: { yes_dollars: [['0.03', '100']], no_dollars: [['0.03', '100']] } },
      TOT: { orderbook_fp: { yes_dollars: [['0.01', '100']], no_dollars: [['0.01', '100']] } } }
    const before = JSON.stringify({ markets, books })
    const result = applyNbaPlayerMarketsSelectionPolicy(markets, books, simulation(), 10)
    expect(result.selectionPolicy).toBe(NBA_PLAYER_MARKETS_SELECTION_POLICY)
    expect(result.studySide).toMatchObject({ ticker: 'ML', side: 'yes', probability: .7 })
    expect(result.candidates).toHaveLength(6)
    expect(JSON.stringify({ markets, books })).toBe(before)
  })
})
