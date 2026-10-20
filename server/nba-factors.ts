import type { OpeningNbaGame } from './nba-kalshi.js'
import type { NbaGame } from './nba-model.js'

export type NbaFactor = { status: 'verified' | 'reported' | 'estimated' | 'unknown'; detail: string;
  source?: string; observedAt?: string; players?: { team: string; name: string; status: string; reportedAt: string }[] }
export type NbaFactors = { injuries: NbaFactor; starters: NbaFactor; offenseDefense: NbaFactor;
  pace: NbaFactor; threes: NbaFactor; ballMovement: NbaFactor; rosterMatchup: NbaFactor }

const root = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba'
const unknown = (detail: string): NbaFactor => ({ status: 'unknown', detail })
type TeamStats = { points: number; allowed: number; possessions: number; threes: number; threePct: number; assists: number; turnovers: number }

function parseStats(raw: unknown, id: string, history: NbaGame[]): TeamStats | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as { requestedSeason?: { year?: number; type?: number }; results?: { stats?: { categories?: { stats?: { name?: string; value?: number }[] }[] } } }
  if (data.requestedSeason?.year !== 2026 || data.requestedSeason.type !== 2) return null
  const fields = Object.fromEntries((data.results?.stats?.categories ?? []).flatMap((category) => category.stats ?? [])
    .filter((stat) => stat.name && Number.isFinite(stat.value)).map((stat) => [stat.name!, stat.value!]))
  const need = ['gamesPlayed', 'avgPoints', 'avgFieldGoalsAttempted', 'avgFreeThrowsAttempted', 'avgOffensiveRebounds',
    'avgTurnovers', 'avgThreePointFieldGoalsAttempted', 'threePointPct', 'avgAssists']
  if (need.some((key) => !Number.isFinite(fields[key])) || fields.gamesPlayed < 60 || fields.gamesPlayed > 82 ||
    fields.threePointPct < 0 || fields.threePointPct > 100) return null
  const games = history.filter((game) => game.season === 2026 && (game.home === id || game.away === id))
  if (games.length < 60) return null
  const allowed = games.reduce((sum, game) => sum + (game.home === id ? game.awayScore : game.homeScore), 0) / games.length
  const possessions = fields.avgFieldGoalsAttempted + .44 * fields.avgFreeThrowsAttempted - fields.avgOffensiveRebounds + fields.avgTurnovers
  if (!Number.isFinite(possessions) || possessions <= 0 || possessions > 150 || !Number.isFinite(allowed)) return null
  return { points: fields.avgPoints, allowed, possessions, threes: fields.avgThreePointFieldGoalsAttempted,
    threePct: fields.threePointPct, assists: fields.avgAssists, turnovers: fields.avgTurnovers }
}

export async function collectNbaFactors(game: OpeningNbaGame, history: NbaGame[], observedAt: string,
  fetcher: typeof fetch = fetch): Promise<NbaFactors> {
  const summaryUrl = `${root}/summary?event=${game.gameId}`
  const homeUrl = `${root}/teams/${game.homeId}/statistics?season=2026&seasontype=2`
  const awayUrl = `${root}/teams/${game.awayId}/statistics?season=2026&seasontype=2`
  const fetchJson = async (url: string): Promise<unknown> => {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(10000) })
      return response.ok ? await response.json() as unknown : null
    } catch { return null }
  }
  const [summary, homeRaw, awayRaw] = await Promise.all([fetchJson(summaryUrl), fetchJson(homeUrl), fetchJson(awayUrl)])
  const injuryGroups = summary && typeof summary === 'object' ? (summary as { injuries?: unknown }).injuries : null
  const now = Date.parse(observedAt)
  const players: NonNullable<NbaFactor['players']> = []
  if (Array.isArray(injuryGroups) && Number.isFinite(now)) for (const group of injuryGroups) {
    const id = group?.team?.id
    const team = id === game.homeId ? game.homeCity : id === game.awayId ? game.awayCity : null
    if (!team || !Array.isArray(group.injuries)) continue
    for (const item of group.injuries) {
      const reportedAt = Date.parse(item?.date)
      if (typeof item?.athlete?.displayName === 'string' && typeof item?.status === 'string' &&
        Number.isFinite(reportedAt) && reportedAt <= now && now - reportedAt <= 48 * 60 * 60_000) {
        players.push({ team, name: item.athlete.displayName, status: item.status, reportedAt: item.date })
      }
    }
  }
  const injuries: NbaFactor = players.length ? { status: 'reported', detail: `${players.length} dated ESPN injury listing(s); not an official complete availability clearance.`,
    source: summaryUrl, observedAt, players } : unknown('No fresh dated injury listings for these teams; absence does not mean healthy. Check the official NBA report before tip.')
  const home = parseStats(homeRaw, game.homeId, history)
  const away = parseStats(awayRaw, game.awayId, history)
  const evidence = { source: `${homeUrl} · ${awayUrl}`, observedAt }
  return { injuries,
    starters: unknown('Confirmed starting five not available before lineup announcement.'),
    rosterMatchup: unknown('No validated current-roster adjustment or player on/off model; prior-season rates are context only.'),
    offenseDefense: home && away ? { status: 'verified', detail: `2025–26 points for/allowed: ${game.awayCode} ${away.points.toFixed(1)}/${away.allowed.toFixed(1)}, ${game.homeCode} ${home.points.toFixed(1)}/${home.allowed.toFixed(1)}. Not opponent-adjusted ratings.`, ...evidence } : unknown('Season-validated prior-year points for/allowed unavailable.'),
    pace: home && away ? { status: 'estimated', detail: `2025–26 rough possessions per game: ${game.awayCode} ${away.possessions.toFixed(1)}, ${game.homeCode} ${home.possessions.toFixed(1)} (FGA + .44 FTA − OREB + TO); not 48-minute adjusted pace.`, ...evidence } : unknown('Season-validated possession inputs unavailable.'),
    threes: home && away ? { status: 'verified', detail: `2025–26 3PA/game and 3P%: ${game.awayCode} ${away.threes.toFixed(1)} / ${away.threePct.toFixed(1)}%, ${game.homeCode} ${home.threes.toFixed(1)} / ${home.threePct.toFixed(1)}%. Not current-roster projections.`, ...evidence } : unknown('Season-validated three-point inputs unavailable.'),
    ballMovement: home && away ? { status: 'estimated', detail: `2025–26 assists/turnovers per game: ${game.awayCode} ${away.assists.toFixed(1)}/${away.turnovers.toFixed(1)}, ${game.homeCode} ${home.assists.toFixed(1)}/${home.turnovers.toFixed(1)}. Touches/chemistry remain unknown.`, ...evidence } : unknown('Season-validated assist and turnover inputs unavailable.') }
}
