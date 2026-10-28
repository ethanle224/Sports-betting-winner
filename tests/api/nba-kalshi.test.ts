import { describe, expect, it, vi } from 'vitest'
import { collectOpeningNbaMarkets, pricedNbaSide, rankOpeningNbaGame, chooseNbaShadowSide, OPENING_NBA_GAMES } from '../../server/nba-kalshi'
import type { NbaForecast } from '../../server/nba-model'
import { nbaLineChance } from '../../server/nba-model'

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

  it('keeps the value-ranked baseline but shadows a higher-chance affordable spread', () => {
    const game = OPENING_NBA_GAMES[0]
    const dog = { ...snapshot[0], kind: 'moneyline' as const, team: 'away' as const, gameId: game.gameId, series: 'KXNBAGAME' as const }
    const spread = { ...snapshot[0], ticker: 'KXNBASPREAD-26OCT20BOSDET-DET5', kind: 'spread' as const,
      team: 'home' as const, line: 4.5, gameId: game.gameId, series: 'KXNBASPREAD' as const }
    const books = { [dog.ticker]: { orderbook_fp: { no_dollars: [['0.78', '20']], yes_dollars: [] } },
      [spread.ticker]: { orderbook_fp: { no_dollars: [], yes_dollars: [['0.50', '20']] } } }
    const result = rankOpeningNbaGame(game, [dog, spread], books,
      { ...forecast, expectedMargin: 2, homeWin: .65, awayWin: .35 }, 10,
      { homeSpread: -4.5, awaySpread: 4.5, total: 222.5, rawDetails: 'DET -4.5', provider: 'Draft Kings',
        source: 'https://example.org/line', observedAt: '2026-10-19T20:00:00Z' })
    expect(result.studySide).toMatchObject({ ticker: dog.ticker, side: 'yes' })
    expect(result.shadowSide).toMatchObject({ ticker: spread.ticker, side: 'no', market: 'spread' })
    expect(result.shadowSide!.probability).toBeGreaterThan(result.studySide!.probability)
  })
  it('does not shadow an expensive high-chance choice with no credible post-fee value', () => {
    const game = OPENING_NBA_GAMES[0]
    const dog = { ...snapshot[0], kind: 'moneyline' as const, team: 'away' as const, gameId: game.gameId, series: 'KXNBAGAME' as const }
    const ranked = rankOpeningNbaGame(game, [dog], { [dog.ticker]: { orderbook_fp: { no_dollars: [['0.21', '20']], yes_dollars: [] } } }, forecast, 10)
    expect(ranked.shadowSide).toBeNull()
  })

  it('uses an extra near-market spread only for the shadow, never re-ranking a total baseline', () => {
    const game = OPENING_NBA_GAMES[0]
    const total = { ...snapshot[0], ticker: 'KXNBATOTAL-26OCT20BOSDET-224',
      kind: 'total' as const, line: 223.5, gameId: game.gameId, series: 'KXNBATOTAL' as const }
    const spread = { ...snapshot[0], ticker: 'KXNBASPREAD-26OCT20BOSDET-DET5', kind: 'spread' as const,
      team: 'home' as const, line: 4.5, gameId: game.gameId, series: 'KXNBASPREAD' as const }
    const books = { [total.ticker]: { orderbook_fp: { no_dollars: [['0.80', '20']], yes_dollars: [] } },
      [spread.ticker]: { orderbook_fp: { no_dollars: [], yes_dollars: [['0.50', '20']] } } }
    const reference = { homeSpread: -4.5, awaySpread: 4.5, total: 223.5, rawDetails: 'DET -4.5', provider: 'Draft Kings',
      source: 'https://example.org/line', observedAt: '2026-10-19T20:00:00Z' }
    const baseline = rankOpeningNbaGame(game, [total, spread], { [total.ticker]: books[total.ticker] }, forecast, 10, reference)
    const expanded = rankOpeningNbaGame(game, [total, spread], books, forecast, 10, reference)
    const challenger = chooseNbaShadowSide(expanded.candidates, baseline.studySide, [total, spread], reference)
    expect(baseline.studySide?.ticker).toBe(total.ticker)
    expect(challenger).toMatchObject({ ticker: spread.ticker, side: 'no' })
    expect(baseline.studySide?.ticker).toBe(total.ticker)
  })

  it('does not fabricate a valid bet when all quotes are unfavorable or missing', () => {
    const game = OPENING_NBA_GAMES[0]
    const books = Object.fromEntries(snapshot.map((m) => [m.ticker, { orderbook_fp: { no_dollars: [['0.10', '20']], yes_dollars: [] } }]))
    const ranked = rankOpeningNbaGame(game, snapshot.map((m) => ({ ...m, kind: 'moneyline' as const, gameId: game.gameId, series: 'KXNBAGAME' as const })), books, forecast, 10)
    expect(ranked.studySide?.estimatedNetEdge).toBeLessThan(0)
    expect(ranked.qualifiedPaperPick).toBe(false)
    expect(rankOpeningNbaGame(game, [], {}, forecast, 10).studySide).toBeNull()
  })
  it('prefers a nearby priced total only if its post-fee model gap is competitive', () => {
    const game = OPENING_NBA_GAMES[0]
    const mk = (line: number) => ({ ...snapshot[0], ticker: `KXNBATOTAL-26OCT20BOSDET-${line}`,
      kind: 'total' as const, line, gameId: game.gameId, series: 'KXNBATOTAL' as const })
    const far = mk(205.5); const near = mk(221.5)
    const books = Object.fromEntries([far, near].map((m) => {
      const chance = nbaLineChance(forecast, 'over', m.line)!
      const price = chance - (m === far ? .09 : .065)
      return [m.ticker, { orderbook_fp: { no_dollars: [[String(1 - price), '20']], yes_dollars: [] } }]
    }))
    const reference = { homeSpread: 2.5, awaySpread: -2.5, total: 222.5, rawDetails: 'DET -2.5',
      provider: 'Draft Kings', observedAt: '2026-10-19T20:00:00Z', source: 'https://example.org/source' }
    const result = rankOpeningNbaGame(game, [far, near], books, forecast, 10, reference)
    expect(result.candidates[0].ticker).toBe(far.ticker)
    expect(result.studySide?.ticker).toBe(near.ticker)
    expect(result.totalBenchmark.selectedDistance).toBe(1)
    expect(rankOpeningNbaGame(game, [far, near], { [far.ticker]: books[far.ticker] }, forecast, 10, reference).studySide?.ticker).toBe(far.ticker)
    expect(rankOpeningNbaGame(game, [far, near], books, forecast, 10).studySide?.ticker).toBe(far.ticker)
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
