import { describe, expect, it } from 'vitest'
import { freezeNbaStudy, readNbaFreezes, trackNbaPick, type NbaEvidence, type NbaScan } from './nba-paper'
import { compareNbaPlayerTotals, pricedNbaSide, type NbaBook, type NbaMarket, type NbaPricedCandidate } from '../server/nba-kalshi'
import type { NbaPlayerTotalsResult } from '../server/nba-player-totals'
import { applyNbaPlayerMarketsSelectionPolicy } from '../server/nba-policy'

const policy = 'nba-primary-v5-player-markets-v2'
const rankingRule = 'net gap descending; ticker ASCII ascending; YES before NO'
const now = '2026-10-19T20:00:00Z'
const evidence: NbaEvidence = { requestedPaper: true, availabilitySource: 'https://nba.com/injuries',
  availabilityObservedAt: '2026-10-19T19:50:00Z', availabilityNotes: 'Verified pregame availability and lineup reports.',
  rulesSource: 'https://kalshi.com/rules', feeSource: 'https://kalshi.com/fees', uncertaintyAccepted: true,
  rationale: 'Uncalibrated all-market paper research only; uncertainty accepted.' }

function market(kind: NbaMarket['kind'], suffix: string, line?: number): NbaMarket {
  const series = kind === 'moneyline' ? 'KXNBAGAME' : kind === 'spread' ? 'KXNBASPREAD' : 'KXNBATOTAL'
  const event_ticker = `${series}-26OCT20BOSDET`
  const rules_primary = `${kind === 'moneyline' ? 'If Detroit wins' : kind === 'spread' ? `If Detroit wins by more than ${line} points` : `If over ${line} total points are scored`} in the Boston vs Detroit Pro Basketball game originally scheduled for Oct 20, 2026, then the market resolves to Yes.`
  const raw = { ticker: `${event_ticker}-${suffix}`, event_ticker, title: 'Boston vs Detroit', rules_primary,
    rules_secondary: 'If postponed, this contract may resolve at fair price.' }
  return { ...raw, gameId: 'g1', series, kind, ...(kind === 'total' ? {} : { team: 'home' as const }),
    ...(line === undefined ? {} : { line }), raw }
}

function allMarketScan(): NbaScan {
  const markets = [market('moneyline', 'DET'), market('spread', 'DET4', 4.5), market('total', 'T228', 228.5), market('total', 'T300', 300.5)]
  const books: NbaBook[] = [
    { orderbook_fp: { yes_dollars: [['0.50', '100']], no_dollars: [['0.80', '100']] } },
    { orderbook_fp: { yes_dollars: [['0.50', '100']], no_dollars: [['0.60', '100']] } },
    { orderbook_fp: { yes_dollars: [['0.50', '100']], no_dollars: [['0.50', '100']] } },
    { orderbook_fp: { yes_dollars: [['0.50', '1']], no_dollars: [] } },
  ]
  const simulation: NbaPlayerTotalsResult = { version: 'nba-player-totals-v2', status: 'estimated', eligibleForPrimary: true,
    simulations: 1000, totals: Array(1000).fill(220), scores: Array.from({ length: 1000 }, () => ({ home: 120, away: 100, overtimePeriods: 0 })),
    observedAt: '2026-10-19T19:55:00Z', asOfCutoff: null, seed: 'v5-freeze-test', sources: [], assumptions: [], unknowns: [], reason: null,
    reasons: [], expectedTotal: 220, totalSd: 0, inputs: null }
  const candidates = markets.flatMap((m, i) => (['yes', 'no'] as const).flatMap((side): NbaPricedCandidate[] => {
    const quote = pricedNbaSide(books[i], side, 10)
    if (!quote) return []
    const yes = m.kind === 'total' ? 0 : 1
    const probability = side === 'yes' ? yes : 1 - yes
    return [{ ticker: m.ticker, market: m.kind, side, line: m.line ?? null, probability,
      price: quote.price, feeEstimate: quote.feeEstimate, allInCost: quote.allInCost,
      estimatedNetEdge: probability - quote.allInCost, rules: m.rules_primary, rulesSecondary: m.rules_secondary }]
  })).sort((a, b) => b.estimatedNetEdge - a.estimatedNetEdge || (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : a.side === b.side ? 0 : a.side === 'yes' ? -1 : 1))
  const studySide = candidates[0]
  return { date: '2026-10-20', observedAt: '2026-10-19T19:55:00Z', marketObservedAt: '2026-10-19T19:54:00Z',
    quantity: 10, historyObservedAt: '2026-10-19T19:53:00Z', status: 'STUDY_ONLY_NO_QUALIFIED_PICKS',
    sources: { markets: 'https://external-api.kalshi.com/trade-api/v2' }, marketInventory: markets, series: [],
    games: [{ gameId: 'g1', home: 'Detroit', away: 'Boston', startsAt: '2026-10-20T23:00:00Z',
      selectionPolicy: policy, abstentionReason: null, studySide, candidates, qualifiedPaperPick: false,
      coverage: { moneyline: 1, spread: 1, total: 2 }, forecast: null,
      marketInspection: { mode: 'ALL_SUPPORTED_OPEN_MARKETS', listed: markets.length, inspected: markets.length, complete: true },
      playerTotals: { simulation, comparison: compareNbaPlayerTotals([], () => null, 'main'),
        marketComparison: { selectionPolicy: policy, candidates, studySide, abstentionReason: null,
          status: 'PAPER_ONLY_EXPERIMENT', promotionGate: 'USER_APPROVED_PAPER_ONLY', rankingRule } },
      inspected: markets.map((m, i) => ({ ticker: m.ticker, book: books[i],
        source: `https://external-api.kalshi.com/trade-api/v2/markets/${m.ticker}/orderbook`, observedAt: '2026-10-19T19:54:30Z' })) }] }
}

function memoryStorage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}

function rescore(scan: NbaScan) {
  const game = scan.games[0]
  const result = applyNbaPlayerMarketsSelectionPolicy((scan.marketInventory as NbaMarket[]).filter((m) => m.gameId === game.gameId),
    Object.fromEntries(game.inspected.map((item) => [item.ticker, item.book as NbaBook])), game.playerTotals?.simulation, scan.quantity)
  Object.assign(game, result)
  game.playerTotals!.marketComparison = { ...result, status: 'PAPER_ONLY_EXPERIMENT', promotionGate: 'USER_APPROVED_PAPER_ONLY', rankingRule }
}

describe('v5 all-market paper freeze boundary', () => {
  it('freezes an independently priced ML primary with all markets and no old forecast or total candidates', () => {
    const input = allMarketScan()
    const frozen = freezeNbaStudy(input, { g1: evidence }, now)
    expect(frozen.decisions).toHaveLength(1)
    expect(frozen.decisions[0]).toMatchObject({ status: 'PAPER_EXPERIMENT', selected: { market: 'moneyline', probability: 1 }, shadow: null })
    expect(frozen.scan.games[0].candidates).toHaveLength(6)
    expect(frozen.scan.games[0].playerTotals!.comparison.candidates).toEqual([])
    input.games[0].playerTotals!.simulation.scores[0].home = 999
    expect(frozen.scan.games[0].playerTotals!.simulation.scores[0].home).toBe(120)
  })

  it.each(['spread', 'total'] as const)('freezes a recomputed %s primary without a legacy fallback', (kind) => {
    const input = allMarketScan()
    const item = input.games[0].inspected[kind === 'spread' ? 1 : 2]
    item.book = { orderbook_fp: { yes_dollars: [[kind === 'total' ? '0.90' : '0.50', '100']],
      no_dollars: [[kind === 'spread' ? '0.90' : '0.50', '100']] } }
    rescore(input)
    const frozen = freezeNbaStudy(input, { g1: evidence }, now)
    expect(frozen.decisions[0]).toMatchObject({ status: 'PAPER_EXPERIMENT', selected: { market: kind, side: kind === 'total' ? 'no' : 'yes' }, shadow: null })
  })

  it('freezes an abstention with full evidence rather than falling back to an old total', () => {
    const input = allMarketScan()
    const oldPick = input.games[0].studySide
    input.games[0].inspected.forEach((item) => { item.book = { orderbook_fp: { yes_dollars: [], no_dollars: [] } } })
    rescore(input)
    input.games[0].baselineStudySide = oldPick
    input.games[0].shadowSide = oldPick
    const frozen = freezeNbaStudy(input, { g1: evidence }, now)
    expect(frozen.decisions[0]).toMatchObject({ status: 'STUDY', selected: null, shadow: null })
    expect(frozen.scan.games[0].candidates).toEqual([])
    expect(frozen.scan.games[0].abstentionReason).toMatch(/no fallback/i)
  })

  it.each(['price', 'feeEstimate', 'allInCost', 'probability', 'estimatedNetEdge', 'line', 'rules', 'rulesSecondary'] as const)(
    'rejects coordinated forged %s in primary and both candidate lists', (field) => {
      const input = allMarketScan()
      const side = input.games[0].studySide!
      Object.assign(side, { [field]: typeof side[field] === 'string' ? `${side[field]} forged` : Number(side[field]) + .01 })
      // Fixture references are intentionally shared, so primary/comparison/candidates all agree on the forgery.
      expect(input.games[0].playerTotals!.marketComparison!.studySide).toEqual(side)
      expect(() => freezeNbaStudy(input, { g1: evidence }, now)).toThrow(/NBA.*selection policy/i)
    })

  it.each<[string, (scan: NbaScan) => void]>([
    ['omitted primary', (s) => { s.games[0].studySide = null }],
    ['omitted game candidates', (s) => { s.games[0].candidates = [] }],
    ['omitted comparison candidates', (s) => { s.games[0].playerTotals!.marketComparison!.candidates = [] }],
    ['omitted comparison primary', (s) => { s.games[0].playerTotals!.marketComparison!.studySide = null }],
    ['missing comparison', (s) => { delete s.games[0].playerTotals!.marketComparison }],
    ['wrong comparison policy', (s) => { Object.assign(s.games[0].playerTotals!.marketComparison!, { selectionPolicy: 'nba-primary-v4-player-totals-v2' }) }],
    ['wrong comparison status', (s) => { Object.assign(s.games[0].playerTotals!.marketComparison!, { status: 'SHADOW_ONLY' }) }],
    ['wrong promotion gate', (s) => { Object.assign(s.games[0].playerTotals!.marketComparison!, { promotionGate: 'CALIBRATED' }) }],
    ['wrong ranking rule', (s) => { s.games[0].playerTotals!.marketComparison!.rankingRule = 'probability descending' }],
    ['wrong game abstention reason', (s) => { s.games[0].abstentionReason = 'forged' }],
    ['wrong comparison abstention reason', (s) => { s.games[0].playerTotals!.marketComparison!.abstentionReason = 'forged' }],
    ['reordered candidates', (s) => { s.games[0].candidates!.reverse() }],
    ['omitted higher-gap candidate', (s) => {
      const g = s.games[0]; g.candidates!.shift(); g.studySide = g.candidates![0]
      g.playerTotals!.marketComparison!.studySide = g.studySide as NbaPricedCandidate
    }],
    ['changed sized book quote', (s) => { s.games[0].inspected[0].book = { orderbook_fp: { yes_dollars: [['0.50', '100']], no_dollars: [['0.70', '100']] } } }],
    ['insufficient sized book depth', (s) => { s.games[0].inspected[0].book = { orderbook_fp: { yes_dollars: [['0.50', '1']], no_dollars: [['0.80', '1']] } } }],
    ['mismatched paired totals', (s) => { s.games[0].playerTotals!.simulation.totals[0]++ }],
    ['missing paired score', (s) => { s.games[0].playerTotals!.simulation.scores.pop() }],
    ['tied final score', (s) => { s.games[0].playerTotals!.simulation.scores[0] = { home: 110, away: 110, overtimePeriods: 0 } }],
  ])('recomputes policy rather than trusting submitted evidence: %s', (_, mutate) => {
    const input = allMarketScan()
    mutate(input)
    expect(() => freezeNbaStudy(input, { g1: evidence }, now)).toThrow(/NBA.*selection policy/i)
  })

  it('tracks one paper ticket while retaining illiquid inventory for complete repeat validation', () => {
    const input = allMarketScan()
    const storage = memoryStorage()
    input.games[0].shadowSide = input.games[0].candidates!.find((candidate) => candidate.market === 'spread')
    const tracked = trackNbaPick(storage, input, 'g1', now)
    expect(tracked.scan.marketInventory).toEqual(input.marketInventory)
    expect(tracked.scan.games[0].inspected).toEqual(input.games[0].inspected)
    expect(tracked.decisions).toHaveLength(1)
    expect(tracked.decisions[0].shadow).toBeNull()
    expect(tracked.decisions[0].selected).toEqual(input.games[0].studySide)
    expect(readNbaFreezes(storage)).toEqual([tracked])
    expect(() => freezeNbaStudy(tracked.scan, { g1: evidence }, now)).not.toThrow()
    expect(() => trackNbaPick(storage, input, 'g1', now)).toThrow(/Already tracking/)
    expect(readNbaFreezes(storage)).toEqual([tracked])
  })

  it.each<unknown>([{}, [], null, { orderbook_fp: {} }, { orderbook_fp: { yes_dollars: [] } },
    { orderbook_fp: { yes_dollars: [], no_dollars: [['0.50', 'bad']] } },
    { orderbook_fp: { yes_dollars: [['1.01', '100']], no_dollars: [] } },
    { orderbook_fp: { yes_dollars: [], no_dollars: [['0.50', '0']] } }])(
    'rejects malformed raw book evidence even if rescoring gives an abstention: %j', (book) => {
      const input = allMarketScan()
      input.games[0].inspected.forEach((item) => { item.book = book })
      rescore(input)
      expect(() => freezeNbaStudy(input, { g1: evidence }, now)).toThrow(/NBA.*(inspection|book|evidence)/i)
    })

  it('accepts fresh known-empty books and an unknown model as an abstention', () => {
    const input = allMarketScan()
    input.games[0].inspected.forEach((item) => { item.book = { orderbook_fp: { yes_dollars: [], no_dollars: [] } } })
    Object.assign(input.games[0].playerTotals!.simulation, { status: 'unknown', eligibleForPrimary: false, scores: [], totals: [], simulations: 0 })
    rescore(input)
    const frozen = freezeNbaStudy(input, { g1: evidence }, now)
    expect(frozen.decisions[0]).toMatchObject({ selected: null, shadow: null, status: 'STUDY' })
  })

  it.each([false, true])('requires fresh complete timestamps even when abstaining=%s', (abstaining) => {
    for (const stamp of ['', 'not-a-date', '2026-10-19T19:53:00Z', '2026-10-19T19:56:00Z', '2026-10-20T23:01:00Z']) {
      const input = allMarketScan()
      if (abstaining) { input.games[0].inspected.forEach((item) => { item.book = { orderbook_fp: { yes_dollars: [], no_dollars: [] } } }); rescore(input) }
      // The last market is illiquid, not present among the priced candidates.
      input.games[0].inspected[3].observedAt = stamp
      expect(() => freezeNbaStudy(input, { g1: evidence }, now)).toThrow(/NBA.*(inspection|book|observation)/i)
    }
  })

  it.each([false, true])('requires a fresh model observation even when abstaining=%s', (abstaining) => {
    for (const stamp of ['', 'not-a-date', '2026-10-19T19:00:00Z', '2026-10-19T19:56:00Z', '2026-10-20T23:01:00Z']) {
      const input = allMarketScan()
      if (abstaining) { input.games[0].inspected.forEach((item) => { item.book = { orderbook_fp: { yes_dollars: [], no_dollars: [] } } }); rescore(input) }
      input.games[0].playerTotals!.simulation.observedAt = stamp
      expect(() => freezeNbaStudy(input, { g1: evidence }, now)).toThrow(/NBA.*model.*observation/i)
    }
  })

  it.each<[string, (scan: NbaScan) => void]>([
    ['forged team', (s) => { (s.marketInventory[0] as NbaMarket).team = 'away' }],
    ['forged spread line', (s) => { (s.marketInventory[1] as NbaMarket).line = 9.5 }],
    ['forged rules', (s) => { (s.marketInventory[2] as NbaMarket).rules_primary += ' altered' }],
    ['forged secondary rules', (s) => { (s.marketInventory[2] as NbaMarket).rules_secondary += ' altered' }],
    ['missing raw metadata', (s) => { delete (s.marketInventory[3] as NbaMarket).raw }],
    ['forged raw rules', (s) => { (s.marketInventory[3] as NbaMarket).raw!.rules_primary = 'wrong game' }],
    ['forged title', (s) => { (s.marketInventory[3] as NbaMarket).title = 'wrong game' }],
    ['forged event mapping', (s) => { (s.marketInventory[3] as NbaMarket).event_ticker = 'KXNBATOTAL-26OCT20PHINYK' }],
    ['forged matchup', (s) => { s.games[0].home = 'New York' }],
  ])('reclassifies raw inventory before trusting self-consistent candidates: %s', (_, mutate) => {
    const input = allMarketScan()
    mutate(input)
    rescore(input)
    expect(() => freezeNbaStudy(input, { g1: evidence }, now)).toThrow(/NBA.*(inventory|mapping|rules)/i)
  })

  it.each<[string, (scan: NbaScan) => void]>([
    ['missing illiquid inspection', (s) => { s.games[0].inspected.pop() }],
    ['duplicate inspection', (s) => { s.games[0].inspected.push(s.games[0].inspected[0]) }],
    ['foreign inspection', (s) => { s.games[0].inspected.push({ ...s.games[0].inspected[0], ticker: 'foreign' }) }],
    ['missing raw book', (s) => { s.games[0].inspected[3].book = null }],
    ['nonobject raw book', (s) => { s.games[0].inspected[3].book = [] }],
    ['duplicate inventory ticker', (s) => { s.marketInventory.push(s.marketInventory[0]) }],
    ['foreign game mapping', (s) => { (s.marketInventory[3] as NbaMarket).gameId = 'other' }],
    ['missing inspection summary', (s) => { delete s.games[0].marketInspection }],
    ['wrong listed count', (s) => { s.games[0].marketInspection!.listed-- }],
    ['wrong inspected count', (s) => { s.games[0].marketInspection!.inspected-- }],
    ['wrong coverage count', (s) => { s.games[0].coverage.total-- }],
    ['omitted illiquid market and book', (s) => { s.marketInventory.pop(); s.games[0].inspected.pop(); s.games[0].marketInspection!.listed--; s.games[0].marketInspection!.inspected-- }],
    ['duplicate game mapping', (s) => { s.games.push({ ...s.games[0], gameId: 'g2' }) }],
  ])('rejects incomplete all-market evidence: %s', (_, mutate) => {
    const input = allMarketScan()
    mutate(input)
    expect(() => freezeNbaStudy(input, { g1: evidence }, now)).toThrow(/NBA.*(inventory|inspection|coverage|mapping|book)/i)
  })
})
