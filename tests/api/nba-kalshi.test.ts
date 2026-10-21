import { describe, expect, it, vi } from 'vitest'
import { collectOpeningNbaMarkets, pricedNbaSide, rankOpeningNbaGame, OPENING_NBA_GAMES } from '../../server/nba-kalshi'
import type { NbaForecast } from '../../server/nba-model'

const market = (event: string, suffix: string, side: string) => ({ ticker: `${event}-${suffix}`, event_ticker: event,
  title: `${side} wins`, rules_primary: `If ${side} wins the Boston vs Detroit Pro Basketball game originally scheduled for Oct 20, 2026, then the market resolves to Yes.`,
  rules_secondary: 'If the game is postponed but begins within 48 hours, resolves from the final; otherwise fair price.' })
const snapshot = [market('KXNBAGAME-26OCT20BOSDET', 'BOS', 'Boston'), market('KXNBAGAME-26OCT20BOSDET', 'DET', 'Detroit')]
const forecast: NbaForecast = { model: 'nba-scores-v1', expectedMargin: -2, expectedTotal: 222,
  homeWin: .45, awayWin: .55, marginSd: 14, totalSd: 19, homeAdvantage: 2, headToHeadCount: 4 }

describe('Opening NBA Kalshi research', () => {
  it('paginates the three public series and matches exact Oct 20 event identities, not fuzzy titles', async () => {
    const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => ({ markets: url.includes('KXNBAGAME') ? [
      ...snapshot, market('KXNBAGAME-26OCT21BOSDET', 'BOS', 'Boston')] : [], cursor: '' }) })) as unknown as typeof fetch
    const result = await collectOpeningNbaMarkets('2026-10-20', [OPENING_NBA_GAMES[0]], fetcher)
    expect(result.markets).toHaveLength(2)
    expect(result.series.map((s) => s.series)).toEqual(['KXNBAGAME', 'KXNBASPREAD', 'KXNBATOTAL'])
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(result.markets[0].gameId).toBe('401909088')
    expect(result.markets[0].kind).toBe('moneyline')
  })

  it('converts opposite-side bid depth to sized YES cost and estimates the current general taker fee', () => {
    const book = { orderbook_fp: { no_dollars: [['0.40', '2.00'], ['0.38', '2.00']], yes_dollars: [] } }
    const q = pricedNbaSide(book, 'yes', 3)
    expect(q?.price).toBeCloseTo((2 * .60 + .62) / 3)
    expect(q?.feeEstimate).toBeGreaterThan(0)
    expect(q?.allInCost).toBeGreaterThan(q!.price)
    expect(pricedNbaSide(book, 'yes', 5)).toBeNull()
    expect(pricedNbaSide({ orderbook_fp: { yes_dollars: [['1.20', '3']], no_dollars: [] } }, 'no', 3)).toBeNull()
  })

  it('ranks a study side from exact contract YES books, but never labels it a qualified paper bet', () => {
    const game = OPENING_NBA_GAMES[0]
    const books = { [snapshot[0].ticker]: { orderbook_fp: { no_dollars: [['0.60', '20']], yes_dollars: [] } },
      [snapshot[1].ticker]: { orderbook_fp: { no_dollars: [['0.40', '20']], yes_dollars: [] } } }
    const ranked = rankOpeningNbaGame(game, snapshot.map((m) => ({ ...m, kind: 'moneyline' as const, gameId: game.gameId, series: 'KXNBAGAME' as const })), books, forecast, 10)
    expect(ranked.studySide).toMatchObject({ ticker: snapshot[0].ticker, side: 'yes', market: 'moneyline' })
    expect(ranked.candidates).toHaveLength(2)
    expect(ranked.candidates[0]).toEqual(ranked.studySide)
    expect(ranked.candidates[1].ticker).toBe(snapshot[1].ticker)
    expect(ranked.coverage).toMatchObject({ moneyline: 2, spread: 0, total: 0 })
    expect(ranked.qualifiedPaperPick).toBe(false)
    expect(ranked.checklist).toMatchObject({ injuryLineupVerified: false, rulesVerified: false, feeVerified: false })
  })

  it('does not fabricate a valid bet when all quotes are unfavorable or missing', () => {
    const game = OPENING_NBA_GAMES[0]
    const books = Object.fromEntries(snapshot.map((m) => [m.ticker, { orderbook_fp: { no_dollars: [['0.10', '20']], yes_dollars: [] } }]))
    const ranked = rankOpeningNbaGame(game, snapshot.map((m) => ({ ...m, kind: 'moneyline' as const, gameId: game.gameId, series: 'KXNBAGAME' as const })), books, forecast, 10)
    expect(ranked.studySide?.estimatedNetEdge).toBeLessThan(0)
    expect(ranked.qualifiedPaperPick).toBe(false)
    expect(rankOpeningNbaGame(game, [], {}, forecast, 10).studySide).toBeNull()
  })
  it('recognizes future full-game half-point spread and total rules without admitting integer pushes', async () => {
    const raw = [
      { ...market('KXNBASPREAD-26OCT20BOSDET', 'DET3', 'Detroit'), title: 'Detroit wins by over 2.5 points',
        rules_primary: 'If Detroit wins by more than 2.5 points in the Boston vs Detroit Pro Basketball game originally scheduled for Oct 20, 2026, then the market resolves to Yes.' },
      { ...market('KXNBATOTAL-26OCT20BOSDET', '223', 'Over'), title: 'Full Game: Over 222.5 points scored',
        rules_primary: 'If over 222.5 total points are scored in the Boston vs Detroit Pro Basketball game originally scheduled for Oct 20, 2026, then the market resolves to Yes.' },
      { ...market('KXNBATOTAL-26OCT20BOSDET', '224', 'Over'), title: 'Full Game: Over 223 points scored',
        rules_primary: 'If over 223 total points are scored in the Pro Basketball game, then the market resolves to Yes.' },
    ]
    const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => ({ markets: raw.filter((m) => m.event_ticker.startsWith(new URL(url).searchParams.get('series_ticker') ?? '')), cursor: '' }) })) as unknown as typeof fetch
    const listed = await collectOpeningNbaMarkets('2026-10-20', [OPENING_NBA_GAMES[0]], fetcher)
    expect(listed.markets.map((m) => [m.kind, m.line])).toEqual([['spread', 2.5], ['total', 222.5]])
    const game = OPENING_NBA_GAMES[0]
    const books = Object.fromEntries(listed.markets.map((m) => [m.ticker, { orderbook_fp: { no_dollars: [['0.50', '20']], yes_dollars: [] } }]))
    const ranked = rankOpeningNbaGame(game, listed.markets, books, forecast, 10)
    expect(ranked.coverage).toMatchObject({ spread: 1, total: 1 })
    expect(ranked.pricedSides).toBe(2)
    expect(ranked.qualifiedPaperPick).toBe(false)
  })
})
