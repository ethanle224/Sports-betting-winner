export const NFL_SERIES = [
  ['KXNFLGAME', 'Game winner', 'pregame'], ['KXNFLSPREAD', 'Game spread', 'pregame'],
  ['KXNFLTOTAL', 'Game total', 'pregame'], ['KXNFL1H', 'First-half winner', 'pregame'],
  ['KXNFL1HSPREAD', 'First-half spread', 'pregame'], ['KXNFL1HTOTAL', 'First-half total', 'pregame'],
  ['KXNFL2H', 'Second-half winner', 'halftime'], ['KXNFL2HSPREAD', 'Second-half spread', 'halftime'],
  ['KXNFL2HTOTAL', 'Second-half total', 'halftime'],
] as const

const BASE = 'https://external-api.kalshi.com/trade-api/v2'
type RawMarket = Record<string, unknown>
export type ScannedMarket = {
  series: string; phase: string; kind: string; gameDate: string; eventTicker: string; ticker: string
  title: string; rules: string; indicativeAsk: number | null; indicativeSize: number | null
}

function numberInRange(value: unknown, max = 1): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null
}

function dateFromTicker(eventTicker: string, series: string): string | null {
  const match = new RegExp(`^${series}-(\\d{2})([A-Z]{3})(\\d{2})[A-Z0-9]+$`).exec(eventTicker)
  if (!match) return null
  const months: Record<string, number> = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 }
  const month = months[match[2]]
  const day = Number(match[3])
  const year = 2000 + Number(match[1])
  if (!month || new Date(Date.UTC(year, month - 1, day)).getUTCDate() !== day) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export async function collectDailyMarkets(date: string, fetcher: typeof fetch = fetch) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new Error('Invalid game date')
  const markets: ScannedMarket[] = []
  const series = NFL_SERIES.map(([ticker, kind, phase]) => ({ ticker, kind, phase, count: 0 }))
  for (const item of series) {
    let cursor = ''
    const seen = new Set<string>()
    do {
      const query = new URLSearchParams({ series_ticker: item.ticker, status: 'open', limit: '1000' })
      if (cursor) query.set('cursor', cursor)
      const response = await fetcher(`${BASE}/markets?${query}`, { signal: AbortSignal.timeout(12000) })
      if (!response.ok) throw new Error(`Kalshi ${item.ticker} HTTP ${response.status}; scan incomplete`)
      const data: unknown = await response.json()
      if (!data || typeof data !== 'object' || !Array.isArray((data as { markets?: unknown }).markets)) throw new Error(`Kalshi ${item.ticker} malformed response; scan incomplete`)
      for (const raw of (data as { markets: RawMarket[] }).markets) {
        if (!raw || typeof raw !== 'object' || typeof raw.event_ticker !== 'string' || typeof raw.ticker !== 'string') continue
        const gameDate = dateFromTicker(raw.event_ticker, item.ticker)
        if (gameDate !== date || !raw.ticker.startsWith(`${raw.event_ticker}-`)) continue
        markets.push({ series: item.ticker, kind: item.kind, phase: item.phase, gameDate,
          eventTicker: raw.event_ticker, ticker: raw.ticker, title: String(raw.title || ''),
          rules: [raw.rules_primary, raw.rules_secondary].filter((v) => typeof v === 'string').join('\n'),
          indicativeAsk: numberInRange(raw.yes_ask_dollars), indicativeSize: numberInRange(raw.yes_ask_size_fp, 1e9) })
        item.count++
      }
      const next = (data as { cursor?: unknown }).cursor
      cursor = typeof next === 'string' ? next : ''
      if (cursor) {
        if (seen.has(cursor) || seen.size >= 100) throw new Error(`Kalshi ${item.ticker} pagination incomplete`)
        seen.add(cursor)
      }
    } while (cursor)
  }
  return { date, collectedAt: new Date().toISOString(), series, markets, coverage: { complete: true, count: markets.length } }
}

type Book = { orderbook_fp?: { yes_dollars?: unknown; no_dollars?: unknown } }
export function quoteForSize(book: Book, side: 'yes' | 'no', quantity: number) {
  if (!Number.isInteger(quantity) || quantity <= 0) return null
  const levels = side === 'yes' ? book.orderbook_fp?.no_dollars : book.orderbook_fp?.yes_dollars
  if (!Array.isArray(levels)) return null
  const parsed = levels.map((level) => {
    if (!Array.isArray(level) || level.length !== 2) return null
    const bid = numberInRange(level[0]); const size = numberInRange(level[1], 1e9)
    return bid !== null && size !== null && size > 0 ? { bid, size } : null
  })
  if (parsed.some((level) => level === null)) return null
  let remaining = quantity; let cost = 0
  for (const level of (parsed as { bid: number; size: number }[]).sort((a, b) => b.bid - a.bid)) {
    const fill = Math.min(remaining, level.size)
    cost += fill * (1 - level.bid)
    remaining -= fill
    if (remaining <= 1e-8) break
  }
  if (remaining > 1e-8) return null
  const price = cost / quantity
  // General taker schedule estimate; series exceptions must be independently checked.
  const estimatedFee = Math.ceil((0.07 * quantity * price * (1 - price)) * 10000) / 10000
  return { price, quantity, estimatedFee, estimatedAllIn: (cost + estimatedFee) / quantity,
    feeAssumption: 'General taker fee estimate (multiplier 1); verify series-specific schedule' }
}
