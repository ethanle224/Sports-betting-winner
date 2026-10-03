import { verifySessionToken } from './auth-core.js'
import { collectDailyMarkets, NFL_SERIES, quoteForSize } from './nfl-core.js'
import { forecastMarkets, gameCode } from './nfl-forecast.js'
import { parseEspnOdds } from './nfl-bookmaker.js'
import { parseGamesCsv, parseScheduleCsv } from './nfl-model.js'
import { matchupContext, type EfficiencySnapshot } from './nfl-efficiency.js'
import { refreshEfficiency } from './nfl-live-efficiency.js'
import { fetchPreseason, weightedTeamForm } from './nfl-preseason.js'
import efficiencySnapshot from './data/nfl-efficiency.json' with { type: 'json' }

type Request = { method?: string; headers?: { cookie?: string }; query?: { date?: string | string[]; ticker?: string | string[]; quantity?: string | string[]; forecast?: string | string[] } }
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
    const quantityText = request.query?.quantity ?? '10'
    if (typeof quantityText !== 'string' || !/^[1-9]\d{0,3}$/.test(quantityText) || Number(quantityText) > 1000) {
      response.status(400).json({ error: 'Quantity must be 1–1000 whole contracts' }); return
    }
    const quantity = Number(quantityText)
    try {
      const upstream = await fetch(`${base}/markets/${ticker}/orderbook`, { signal: AbortSignal.timeout(10000) })
      if (!upstream.ok) throw new Error('Orderbook unavailable')
      const raw: unknown = await upstream.json()
      const book = raw as Parameters<typeof quoteForSize>[0]
      response.status(200).json({ ticker, quantity, observedAt: new Date().toISOString(), source: `${base}/markets/${ticker}/orderbook`, raw,
        yes: quoteForSize(book, 'yes', quantity), no: quoteForSize(book, 'no', quantity) })
    } catch { response.status(502).json({ error: 'Kalshi orderbook unavailable; no quote recorded' }) }
    return
  }
  const date = request.query?.date
  if (typeof date !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    response.status(400).json({ error: 'Use a YYYY-MM-DD game date' }); return
  }
  if (request.query?.forecast !== undefined && request.query.forecast !== '1') { response.status(400).json({ error: 'Invalid forecast mode' }); return }
  try {
    const scan = await collectDailyMarkets(date)
    if (request.query?.forecast !== '1') { response.status(200).json(scan); return }
    const source = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'
    const upstream = await fetch(source, { signal: AbortSignal.timeout(12000) })
    if (!upstream.ok) throw new Error('Historical game data unavailable')
    const csv = await upstream.text()
    if (csv.length > 8_000_000) throw new Error('Historical game data too large')
    const completed = parseGamesCsv(csv).filter((game) => game.date < date)
    const latestCompleted = completed.reduce((latest, game) => game.date > latest ? game.date : latest, '')
    const efficiencyTask = refreshEfficiency(efficiencySnapshot as EfficiencySnapshot, completed, date)
    const preseasonTask = fetchPreseason(date)
    const oddsSource = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${date.replaceAll('-', '')}`
    let bookmakerLines: ReturnType<typeof parseEspnOdds> = []
    let bookmakerStatus = 'unavailable'
    try {
      const oddsResponse = await fetch(oddsSource, { signal: AbortSignal.timeout(10000) })
      if (oddsResponse.ok) {
        bookmakerLines = parseEspnOdds(await oddsResponse.json(), date, new Date().toISOString())
        bookmakerStatus = bookmakerLines.length ? 'observed' : 'no valid pregame odds'
      }
    } catch { /* No sportsbook probability is inferred from Kalshi when external odds fail. */ }
    const [efficiency, preseason] = await Promise.all([efficiencyTask, preseasonTask])
    const contexts = parseScheduleCsv(csv, date).map((game) => ({ event: gameCode(date, game.away, game.home), home: game.home, away: game.away,
      context: efficiency.snapshot ? matchupContext(efficiency.snapshot, game.home, game.away, date, latestCompleted) : null,
      homeForm: weightedTeamForm(completed, preseason.games, game.home, date),
      awayForm: weightedTeamForm(completed, preseason.games, game.away, date) }))
    response.status(200).json({ ...scan, forecasts: forecastMarkets(scan.markets, csv, date, bookmakerLines),
      modelSource: source, modelFetchedAt: new Date().toISOString(), bookmakerLines, bookmakerSource: oddsSource,
      bookmakerStatus, contexts, efficiencyStatus: efficiency.status,
      efficiencySnapshotThrough: efficiency.snapshot?.lastGameDate ?? null,
      efficiencySources: efficiency.snapshot?.sources ?? [], preseasonStatus: preseason.status,
      preseasonObservedAt: preseason.observedAt, preseasonSources: preseason.sources, preseasonGames: preseason.games })
  }
  catch { response.status(502).json({ error: 'Kalshi daily scan incomplete; no partial slate returned' }) }
}
