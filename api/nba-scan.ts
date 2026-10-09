import { verifySessionToken } from '../server/auth-core.js'
import { collectOpeningNbaMarkets, OPENING_NBA_GAMES, NBA_KALSHI_BASE, rankOpeningNbaGame, type NbaBook, type NbaMarket } from '../server/nba-kalshi.js'
import { fitNbaCalibration, forecastNbaGame, type NbaGame } from '../server/nba-model.js'
import snapshot from '../server/data/nba-games.json' with { type: 'json' }

type Request = { method?: string; headers?: { cookie?: string }; query?: { date?: string | string[]; quantity?: string | string[] } }
type Response = { setHeader: (name: string, value: string) => void; status: (code: number) => { json: (body: unknown) => void } }
type ScheduledEvent = { id?: string; date?: string; season?: { type?: number }; status?: { type?: { state?: string } };
  competitions?: { neutralSite?: boolean; competitors?: { homeAway?: string; team?: { id?: string } }[] }[] }
const history = snapshot.games as NbaGame[]
const calibration = fitNbaCalibration(history)
const scheduleSource = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261020'

function selectedMarkets(markets: NbaMarket[], gameId: string, forecast: NonNullable<ReturnType<typeof forecastNbaGame>>) {
  const available = markets.filter((m) => m.gameId === gameId)
  const moneyline = available.filter((m) => m.kind === 'moneyline')
  const spread = available.filter((m) => m.kind === 'spread').sort((a, b) => Math.abs((a.line ?? 0) - Math.abs(forecast.expectedMargin)) - Math.abs((b.line ?? 0) - Math.abs(forecast.expectedMargin))).slice(0, 4)
  const total = available.filter((m) => m.kind === 'total').sort((a, b) => Math.abs((a.line ?? 0) - forecast.expectedTotal) - Math.abs((b.line ?? 0) - forecast.expectedTotal)).slice(0, 4)
  return [...moneyline, ...spread, ...total]
}

export default async function handler(request: Request, response: Response): Promise<void> {
  response.setHeader('Cache-Control', 'private, no-store')
  if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); response.status(405).json({ error: 'Method not allowed' }); return }
  const secret = process.env.EDGEBOARD_SESSION_SECRET
  const cookie = request.headers?.cookie?.split(';').map((s) => s.trim()).find((s) => s.startsWith('edgeboard_session='))?.slice(18)
  if (!secret || !verifySessionToken(cookie, secret)) { response.status(401).json({ error: 'Unauthorized' }); return }
  const date = request.query?.date
  if (date !== '2026-10-20') { response.status(400).json({ error: 'Only October 20 opening slate has exact verified mapping' }); return }
  const quantityText = request.query?.quantity ?? '10'
  if (typeof quantityText !== 'string' || !/^[1-9]\d{0,2}$/.test(quantityText) || Number(quantityText) > 100) {
    response.status(400).json({ error: 'Quantity must be 1–100 whole contracts' }); return
  }
  const quantity = Number(quantityText)
  try {
    const [inventory, scheduleResponse] = await Promise.all([
      collectOpeningNbaMarkets(date), fetch(scheduleSource, { signal: AbortSignal.timeout(12000) }),
    ])
    if (!scheduleResponse.ok) throw new Error('Schedule unavailable')
    const schedule: { events?: ScheduledEvent[] } = await scheduleResponse.json()
    if (!Array.isArray(schedule.events)) throw new Error('Schedule incomplete')
    const games = await Promise.all(OPENING_NBA_GAMES.map(async (mapped) => {
      const matching = schedule.events!.filter((item) => item.id === mapped.gameId)
      const event = matching[0]
      const competition = event?.competitions?.[0]
      const homeId = competition?.competitors?.find((item) => item.homeAway === 'home')?.team?.id
      const awayId = competition?.competitors?.find((item) => item.homeAway === 'away')?.team?.id
      if (matching.length !== 1 || homeId !== mapped.homeId || awayId !== mapped.awayId || event.season?.type !== 2 ||
        typeof competition?.neutralSite !== 'boolean' || !event.date || !Number.isFinite(Date.parse(event.date))) throw new Error('Opening game mapping changed')
      const beforeTip = event.status?.type?.state === 'pre' && Date.parse(event.date) > Date.now()
      const freshHistory = Date.parse(event.date) <= Date.parse(snapshot.observedAt) + 21 * 86400000
      const forecast = beforeTip && freshHistory ? forecastNbaGame({ home: homeId, away: awayId, tip: event.date, neutral: competition.neutralSite }, history, calibration) : null
      const chosen = forecast ? selectedMarkets(inventory.markets, mapped.gameId, forecast) : []
      const rawBooks: Record<string, NbaBook> = {}
      const bookObservedAt: Record<string, string> = {}
      await Promise.all(chosen.map(async (market) => {
        const url = `${NBA_KALSHI_BASE}/markets/${encodeURIComponent(market.ticker)}/orderbook`
        const upstream = await fetch(url, { signal: AbortSignal.timeout(10000) })
        if (!upstream.ok) throw new Error('Orderbook unavailable')
        rawBooks[market.ticker] = await upstream.json() as NbaBook
        bookObservedAt[market.ticker] = new Date().toISOString()
      }))
      // Coverage includes all mapped inventory, not just the bounded orderbook subset.
      const ranked = rankOpeningNbaGame(mapped, inventory.markets, rawBooks, forecast, quantity)
      return { ...ranked, home: mapped.homeCity, away: mapped.awayCity, startsAt: event.date, forecast,
        inspected: chosen.map((m) => ({ ticker: m.ticker, source: `${NBA_KALSHI_BASE}/markets/${m.ticker}/orderbook`, book: rawBooks[m.ticker],
          observedAt: bookObservedAt[m.ticker] })) }
    }))
    response.status(200).json({ date, quantity, observedAt: new Date().toISOString(), marketObservedAt: inventory.observedAt,
      historyObservedAt: snapshot.observedAt,
      sources: { schedule: scheduleSource, markets: inventory.source, feeSchedule: 'https://kalshi.com/docs/kalshi-fee-schedule.pdf' },
      series: inventory.series, marketInventory: inventory.markets, games, status: 'STUDY_ONLY_NO_QUALIFIED_PICKS' })
  } catch { response.status(502).json({ error: 'NBA public scan incomplete or schedule mapping changed; no partial picks returned' }) }
}
