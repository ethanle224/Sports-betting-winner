import { verifySessionToken } from '../server/auth-core.js'
import { fitNbaCalibration, forecastNbaGame, recentNbaMeetings, type NbaGame } from '../server/nba-model.js'
import { collectNbaCurrentHistory } from '../server/nba-current-history.js'
import snapshot from '../server/data/nba-games.json' with { type: 'json' }

type Request = { method?: string; headers?: { cookie?: string }; query?: { date?: string | string[] } }
type Response = { setHeader: (name: string, value: string) => void; status: (code: number) => { json: (body: unknown) => void } }

type Team = { id: string; name: string; abbreviation: string; pointsFor: number; pointsAgainst: number; wins: number; losses: number }
type Standings = { season?: { displayName?: string }; children?: { standings?: { entries?: { team?: { id?: string; displayName?: string; abbreviation?: string }; stats?: { name?: string; displayValue?: string }[] }[] } }[] }
type Scoreboard = { events?: { id?: string; date?: string; season?: { type?: number }; status?: { type?: { state?: string } }; competitions?: { neutralSite?: boolean; competitors?: { homeAway?: string; team?: { id?: string } }[] }[] }[] }
const standingsSource = 'https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?season=2026&seasontype=2'
const number = (stats: { name?: string; displayValue?: string }[], name: string) => Number(stats.find((stat) => stat.name === name)?.displayValue)
const history = snapshot.games as NbaGame[]
const calibration = fitNbaCalibration(history)
function venueRecord(teamId: string, side: 'home' | 'away') {
  const games = history.filter((g) => g.season === 2026 && !g.neutral && g[side] === teamId)
  if (games.length < 30) return null
  const margins = games.map((g) => side === 'home' ? g.homeScore - g.awayScore : g.awayScore - g.homeScore)
  return { wins: margins.filter((margin) => margin > 0).length, losses: margins.filter((margin) => margin < 0).length,
    margin: margins.reduce((sum, margin) => sum + margin, 0) / games.length }
}

export default async function handler(request: Request, response: Response): Promise<void> {
  response.setHeader('Cache-Control', 'private, no-store')
  if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); response.status(405).json({ error: 'Method not allowed' }); return }
  const secret = process.env.EDGEBOARD_SESSION_SECRET
  const cookie = request.headers?.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('edgeboard_session='))?.slice(18)
  if (!secret || !verifySessionToken(cookie, secret)) { response.status(401).json({ error: 'Unauthorized' }); return }
  const date = request.query?.date ?? '2026-10-20'
  if (typeof date !== 'string' || !/^20\d\d-\d\d-\d\d$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || date < '2026-10-20' || date > '2027-04-11') {
    response.status(400).json({ error: 'Use a 2026–27 regular-season date (YYYY-MM-DD)' }); return
  }
  const scheduleSource = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date.replaceAll('-', '')}`
  try {
    const [statsResponse, gamesResponse] = await Promise.all([
      fetch(standingsSource, { signal: AbortSignal.timeout(12000) }),
      fetch(scheduleSource, { signal: AbortSignal.timeout(12000) }),
    ])
    if (!statsResponse.ok || !gamesResponse.ok) throw new Error('NBA source unavailable')
    const stats: Standings = await statsResponse.json()
    const schedule: Scoreboard = await gamesResponse.json()
    if (stats.season?.displayName !== '2025-26' || !Array.isArray(schedule.events)) throw new Error('NBA source incomplete')
    const entries = stats.children?.flatMap((child) => child.standings?.entries ?? []) ?? []
    const teams: Team[] = entries.map((entry) => {
      const values = entry.stats ?? []
      return { id: entry.team?.id ?? '', name: entry.team?.displayName ?? '', abbreviation: entry.team?.abbreviation ?? '',
        pointsFor: number(values, 'avgPointsFor'), pointsAgainst: number(values, 'avgPointsAgainst'),
        wins: number(values, 'wins'), losses: number(values, 'losses') }
    })
    if (teams.length !== 30 || new Set(teams.map((team) => team.id)).size !== 30 || teams.some((team) => !team.id || !team.name || !team.abbreviation ||
      ![team.pointsFor, team.pointsAgainst, team.wins, team.losses].every(Number.isFinite) || team.wins + team.losses < 70)) throw new Error('NBA team data incomplete')
    const byId = new Map(teams.map((team) => [team.id, team]))
    const observedHistoryAt = new Date().toISOString()
    const futureTips = schedule.events.filter((event) => event.season?.type === 2 && event.status?.type?.state === 'pre' &&
      Date.parse(event.date ?? '') > Date.parse(observedHistoryAt)).map((event) => event.date!).sort()
    const current = futureTips.length ? await collectNbaCurrentHistory(futureTips[0], observedHistoryAt) :
      { games: [] as NbaGame[], sources: [] as string[], observedAt: observedHistoryAt }
    const activeHistory = [...history, ...current.games]
    const games = schedule.events.filter((event) => event.season?.type === 2).map((event) => {
      const competition = event.competitions?.[0]
      const competitors = competition?.competitors ?? []
      const home = byId.get(competitors.find((team) => team.homeAway === 'home')?.team?.id ?? '')
      const away = byId.get(competitors.find((team) => team.homeAway === 'away')?.team?.id ?? '')
      if (!event.id || !home || !away || home.id === away.id || !event.date || !Number.isFinite(Date.parse(event.date)) || typeof competition?.neutralSite !== 'boolean') throw new Error('NBA event mapping incomplete')
      const target = { home: home.id, away: away.id, tip: event.date, neutral: competition.neutralSite }
      const forecast = event.status?.type?.state === 'pre' && Date.parse(event.date) > Date.now() ?
        forecastNbaGame(target, activeHistory, calibration, 'nba-scores-v2') : null
      const meetings = recentNbaMeetings(target, activeHistory).map((g) => ({ id: g.id, tip: g.tip, homeId: g.home, awayId: g.away,
        homeScore: g.homeScore, awayScore: g.awayScore, neutral: g.neutral }))
      const venueContext = { home: venueRecord(home.id, 'home'), awayRoad: venueRecord(away.id, 'away') }
      return { id: event.id, home: home.name, away: away.name, homeId: home.id, awayId: away.id, startsAt: event.date,
        neutral: competition.neutralSite, status: event.status?.type?.state ?? 'unknown', forecast, meetings, venueContext }
    })
    response.status(200).json({ date, observedAt: new Date().toISOString(), priorSeason: '2025-26', teams, games,
      sources: { standings: standingsSource, schedule: scheduleSource, history: snapshot.sources, currentHistory: current.sources },
      historyObservedAt: current.observedAt, currentSeasonFinals: current.games.length,
      ratingsStatus: 'unavailable', forecastStatus: 'experimental score-only' })
  } catch { response.status(502).json({ error: 'NBA source incomplete or unavailable; no partial matchup data returned' }) }
}
