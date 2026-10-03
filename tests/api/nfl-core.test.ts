import { expect, it, vi } from 'vitest'
import { collectDailyMarkets, quoteForSize } from '../../server/nfl-core'

const market = (series: string, event = `${series}-26OCT04INDWAS`, ticker = `${event}-IND`) => ({
  event_ticker: event, ticker, title: 'Indianapolis wins', rules_primary: 'If Indianapolis wins, resolves Yes',
  rules_secondary: 'Tie pays $0.50', expected_expiration_time: '2026-10-05T02:00:00Z',
  yes_ask_dollars: '0.5500', yes_ask_size_fp: '20.00', status: 'active',
})

it('collects all nine series with cursor pagination and matches the original game date, not expiration date', async () => {
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input))
    const series = url.searchParams.get('series_ticker')!
    const cursor = url.searchParams.get('cursor')
    return { ok: true, json: async () => ({ markets: series === 'KXNFLGAME' && !cursor
      ? [market(series), market(series, `${series}-26OCT05ATLNO`)]
      : series === 'KXNFLGAME' ? [market(series, `${series}-26OCT04JACCIN`, `${series}-26OCT04JACCIN-JAC`)] : [market(series)],
      cursor: series === 'KXNFLGAME' && !cursor ? 'next-page' : '' }) } as Response
  })
  const result = await collectDailyMarkets('2026-10-04', fetcher)
  expect(result.series.length).toBe(9)
  expect(result.markets.filter((item) => item.series === 'KXNFLGAME')).toHaveLength(2)
  expect(result.markets.every((item) => item.gameDate === '2026-10-04')).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(10)
  expect(result.coverage.complete).toBe(true)
})

it('refuses incomplete series rather than calling partial coverage complete', async () => {
  const fetcher = vi.fn(async () => ({ ok: false, status: 429 } as Response))
  await expect(collectDailyMarkets('2026-10-04', fetcher)).rejects.toThrow(/KXNFLGAME.*429/)
})

it('quotes ten YES contracts from complementary NO bids and refuses insufficient depth', () => {
  const book = { orderbook_fp: { no_dollars: [['0.40', '4.00'], ['0.45', '6.00']], yes_dollars: [['0.30', '20.00']] } }
  expect(quoteForSize(book, 'yes', 10)?.price).toBeCloseTo(0.57)
  expect(quoteForSize(book, 'yes', 11)).toBeNull()
  expect(quoteForSize(book, 'no', 10)?.price).toBeCloseTo(0.7)
  expect(quoteForSize({ orderbook_fp: { no_dollars: [], yes_dollars: [] } }, 'yes', 10)).toBeNull()
})
