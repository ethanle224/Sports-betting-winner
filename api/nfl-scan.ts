import { verifySessionToken } from './auth-core.js'
import { collectDailyMarkets, NFL_SERIES, quoteForSize } from './nfl-core.js'

type Request = { method?: string; headers?: { cookie?: string }; query?: { date?: string | string[]; ticker?: string | string[] } }
type Response = { setHeader: (name: string, value: string) => void; status: (code: number) => { json: (body: unknown) => void } }
const base = 'https://external-api.kalshi.com/trade-api/v2'

export default async function handler(request: Request, response: Response): Promise<void> {
  response.setHeader('Cache-Control', 'private, no-store')
  if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); response.status(405).json({ error: 'Method not allowed' }); return }
  const secret = process.env.EDGEBOARD_SESSION_SECRET
  const cookie = request.headers?.cookie?.split(';').map((s) => s.trim()).find((s) => s.startsWith('edgeboard_session='))?.slice(18)
  if (!secret || !verifySessionToken(cookie, secret)) { response.status(401).json({ error: 'Unauthorized' }); return }
  const ticker = request.query?.ticker
  if (ticker !== undefined) {
    if (typeof ticker !== 'string' || !NFL_SERIES.some(([series]) => ticker.startsWith(`${series}-`)) || !/^KXNFL[A-Z0-9]+-[A-Z0-9-]{12,80}$/.test(ticker)) {
      response.status(400).json({ error: 'Invalid NFL ticker' }); return
    }
    try {
      const upstream = await fetch(`${base}/markets/${ticker}/orderbook`, { signal: AbortSignal.timeout(10000) })
      if (!upstream.ok) throw new Error('Orderbook unavailable')
      const raw: unknown = await upstream.json()
      const book = raw as Parameters<typeof quoteForSize>[0]
      response.status(200).json({ ticker, observedAt: new Date().toISOString(), source: `${base}/markets/${ticker}/orderbook`, raw,
        yes: quoteForSize(book, 'yes', 10), no: quoteForSize(book, 'no', 10) })
    } catch { response.status(502).json({ error: 'Kalshi orderbook unavailable; no quote recorded' }) }
    return
  }
  const date = request.query?.date
  if (typeof date !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    response.status(400).json({ error: 'Use a YYYY-MM-DD game date' }); return
  }
  try { response.status(200).json(await collectDailyMarkets(date)) }
  catch { response.status(502).json({ error: 'Kalshi daily scan incomplete; no partial slate returned' }) }
}
