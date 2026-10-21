import { verifySessionToken } from '../server/auth-core.js'
import { mapNbaSchedule, NBA_KALSHI_BASE } from '../server/nba-kalshi.js'

type Request = { method?: string; headers?: { cookie?: string }; query?: { date?: string | string[]; gameId?: string | string[]; ticker?: string | string[] } }
type Response = { setHeader: (name: string, value: string) => void; status: (code: number) => { json: (body: unknown) => void } }
type ScheduledEvent = { id?: string; date?: string; season?: { type?: number }; status?: { type?: { state?: string; completed?: boolean } };
  competitions?: { neutralSite?: boolean; competitors?: { homeAway?: string; score?: string;
    team?: { id?: string; location?: string; name?: string; abbreviation?: string } }[] }[] }
type Market = { ticker?: string; event_ticker?: string; market_type?: string; status?: string; result?: string;
  settlement_value_dollars?: string | null; rules_primary?: string; rules_secondary?: string }
const pending = (reason: string) => ({ state: 'pending', reason })
const review = (reason: string) => ({ state: 'needs_review', reason })

function settledFromScore(rules: string, homeCity: string, awayCity: string, home: number, away: number): boolean | null {
  const spread = /^If (.+?) wins by more than ([\d.]+) points\b/.exec(rules)
  if (spread) {
    const line = Number(spread[2])
    if (!Number.isFinite(line) || ![homeCity, awayCity].includes(spread[1])) return null
    return (spread[1] === homeCity ? home - away : away - home) > line
  }
  const winner = /^If (.+?) wins the\b/.exec(rules)
  if (winner) return winner[1] === homeCity ? home > away : winner[1] === awayCity ? away > home : null
  const total = /^If over ([\d.]+) total points\b/.exec(rules)
  if (total) return Number.isFinite(Number(total[1])) ? home + away > Number(total[1]) : null
  return null
}

export default async function handler(request: Request, response: Response): Promise<void> {
  response.setHeader('Cache-Control', 'private, no-store')
  if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); response.status(405).json({ error: 'Method not allowed' }); return }
  const secret = process.env.EDGEBOARD_SESSION_SECRET
  const cookie = request.headers?.cookie?.split(';').map((s) => s.trim()).find((s) => s.startsWith('edgeboard_session='))?.slice(18)
  if (!secret || !verifySessionToken(cookie, secret)) { response.status(401).json({ error: 'Unauthorized' }); return }
  const { date, gameId, ticker } = request.query ?? {}
  if (typeof date !== 'string' || !/^20\d\d-\d\d-\d\d$/.test(date) ||
    !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date ||
    date < '2026-10-20' || date > '2027-04-11' || typeof gameId !== 'string' || !/^\d{9}$/.test(gameId) ||
    typeof ticker !== 'string' || !/^KXNBA(?:GAME|SPREAD|TOTAL)-\d{2}[A-Z]{3}\d{2}[A-Z]{6}-[A-Z0-9]+$/.test(ticker)) {
    response.status(400).json({ error: 'Exact NBA date, game and contract ticker required' }); return
  }
  const [year, month, day] = date.split('-').map(Number)
  const dateCode = `${String(year).slice(2)}${new Date(Date.UTC(year, month - 1, day)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase()}${String(day).padStart(2, '0')}`
  if (!ticker.includes(`-${dateCode}`)) { response.status(400).json({ error: 'Contract date differs from NBA game date' }); return }
  const scheduleSource = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date.replaceAll('-', '')}`
  const marketSource = `${NBA_KALSHI_BASE}/markets/${ticker}`
  try {
    const [scoreResponse, marketResponse] = await Promise.all([
      fetch(scheduleSource, { signal: AbortSignal.timeout(12000) }),
      fetch(marketSource, { signal: AbortSignal.timeout(12000) }),
    ])
    if (!scoreResponse.ok || !marketResponse.ok) throw new Error('Public outcome source unavailable')
    const schedule: { events?: ScheduledEvent[] } = await scoreResponse.json()
    const raw: { market?: Market } = await marketResponse.json()
    if (!Array.isArray(schedule.events) || !raw.market) throw new Error('Public outcome incomplete')
    const mapped = mapNbaSchedule(date, schedule.events).find((g) => g.gameId === gameId)
    if (!mapped) { response.status(200).json(review('Game is not on the selected NBA schedule')); return }
    const eventTicker = ticker.slice(0, ticker.lastIndexOf('-'))
    const market = raw.market
    const observedAt = new Date().toISOString()
    if (eventTicker !== `${ticker.split('-')[0]}-${dateCode}${mapped.eventCode}` || market.event_ticker !== eventTicker ||
      market.ticker !== ticker || market.market_type !== 'binary' || !market.rules_primary || !market.rules_secondary ||
      !market.rules_primary.includes(`the ${mapped.awayCity} vs ${mapped.homeCity} Pro Basketball game originally scheduled for `)) {
      response.status(200).json(review('Exact contract mapping or rules changed; manual verification required')); return
    }
    const base = { ticker, gameId, date, observedAt, marketSource, scheduleSource,
      rulesPrimary: market.rules_primary, rulesSecondary: market.rules_secondary }
    if (market.status !== 'finalized') { response.status(200).json({ ...base, ...pending('Kalshi contract not finalized') }); return }
    const value = market.settlement_value_dollars
    if (typeof value !== 'string' || !/^(?:0(?:\.\d{1,4})?|1(?:\.0{1,4})?)$/.test(value)) {
      response.status(200).json({ ...base, ...review('Final settlement payout is unavailable or invalid') }); return
    }
    const payoutYes = Number(value)
    if (market.result === 'scalar' && payoutYes > 0 && payoutYes < 1) {
      response.status(200).json({ ...base, state: 'finalized', result: 'FAIR_PRICE', payoutYes, scores: null }); return
    }
    if (!['yes', 'no'].includes(market.result ?? '') || payoutYes !== (market.result === 'yes' ? 1 : 0)) {
      response.status(200).json({ ...base, ...review('Final result and payout disagree or fair-price result is ambiguous') }); return
    }
    const matching = schedule.events.filter((item) => item.id === gameId)
    const event = matching[0]
    const competition = event?.competitions?.[0]
    const home = competition?.competitors?.find((item) => item.homeAway === 'home')
    const away = competition?.competitors?.find((item) => item.homeAway === 'away')
    if (matching.length !== 1 || event.status?.type?.state !== 'post' || event.status.type.completed !== true ||
      home?.team?.id !== mapped.homeId || away?.team?.id !== mapped.awayId ||
      !/^\d{1,3}$/.test(home.score ?? '') || !/^\d{1,3}$/.test(away.score ?? '')) {
      response.status(200).json({ ...base, ...pending('Official NBA final score not available') }); return
    }
    const scores = { home: Number(home.score), away: Number(away.score) }
    const expected = settledFromScore(market.rules_primary, mapped.homeCity, mapped.awayCity, scores.home, scores.away)
    if (scores.home === scores.away || expected === null || expected !== (market.result === 'yes')) {
      response.status(200).json({ ...base, ...review('Kalshi resolution and official final score/rules do not reconcile') }); return
    }
    response.status(200).json({ ...base, state: 'finalized', result: market.result!.toUpperCase(), payoutYes, scores })
  } catch { response.status(502).json({ error: 'Public NBA/Kalshi outcome sources incomplete; no audit recorded' }) }
}
