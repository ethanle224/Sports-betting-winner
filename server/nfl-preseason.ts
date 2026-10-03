import type { CompletedGame } from './nfl-model.js'

export type PreseasonGame = CompletedGame & { eventId: string }
export type PreseasonResult = { games: PreseasonGame[]; status: 'observed' | 'unavailable'; sources: string[]; observedAt?: string }
export type WeightedTeamForm = { team: string; currentGames: number; previousGames: number; preseasonGames: number;
  pointsFor: number; pointsAgainst: number; weights: { currentRegular: 4; previousRegular: 1; currentPreseason: 0.5 };
  probabilityAdjustment: false }
const aliases: Record<string, string> = { WSH: 'WAS', LAR: 'LA', JAC: 'JAX' }
const normalized = (team: string) => aliases[team] ?? team
const seasonFor = (date: string) => Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) <= 3 ? 1 : 0)

// ESPN's preseason scoreboard is separate from nflverse's REG-only schedule/PBP.
export function parsePreseason(raw: unknown, season: number, cutoff: string): PreseasonGame[] {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { events?: unknown }).events)) throw new Error('Malformed preseason scoreboard')
  return (raw as { events: Record<string, unknown>[] }).events.flatMap((event) => {
    if (!event || typeof event !== 'object' ||
      (event.season as { year?: number; type?: number } | undefined)?.year !== season ||
      (event.season as { year?: number; type?: number } | undefined)?.type !== 1 ||
      (event.status as { type?: { completed?: boolean } } | undefined)?.type?.completed !== true ||
      typeof event.date !== 'string' || !event.date.startsWith(`${season}-`) ||
      !Number.isFinite(Date.parse(event.date)) || event.date.slice(0, 10) >= cutoff ||
      !Array.isArray(event.competitions) || event.competitions.length !== 1) return []
    const competitors = (event.competitions as { competitors?: { homeAway?: string; team?: { abbreviation?: string }; score?: string }[] }[])[0]?.competitors
    if (!Array.isArray(competitors) || competitors.length !== 2) return []
    const home = competitors.find((team) => team.homeAway === 'home')
    const away = competitors.find((team) => team.homeAway === 'away')
    if (!home?.team?.abbreviation || !away?.team?.abbreviation || home.team.abbreviation === away.team.abbreviation ||
      !/^\d{1,2}$/.test(home.score ?? '') || !/^\d{1,2}$/.test(away.score ?? '') || !event.id) return []
    return [{ date: event.date.slice(0, 10), home: normalized(home.team.abbreviation), away: normalized(away.team.abbreviation),
      homeScore: Number(home.score), awayScore: Number(away.score), eventId: String(event.id) }]
  })
}

export async function fetchPreseason(cutoff: string, fetcher: typeof fetch = fetch): Promise<PreseasonResult> {
  const season = seasonFor(cutoff)
  const sources = [1, 2, 3, 4].map((week) =>
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=1&week=${week}&limit=100`)
  try {
    const pages = await Promise.all(sources.map(async (url) => {
      const response = await fetcher(url, { signal: AbortSignal.timeout(10000) })
      if (!response.ok) throw new Error('Preseason feed unavailable')
      return parsePreseason(await response.json(), season, cutoff)
    }))
    const games = [...new Map(pages.flat().map((game) => [game.eventId, game])).values()]
    return { games, status: 'observed', sources, observedAt: new Date().toISOString() }
  } catch { return { games: [], status: 'unavailable', sources } }
}

export function weightedTeamForm(regular: CompletedGame[], preseason: PreseasonGame[], team: string,
  cutoff: string): WeightedTeamForm | null {
  const season = seasonFor(cutoff)
  const teamGames = (games: CompletedGame[]) => games.filter((g) => g.date < cutoff && (g.home === team || g.away === team))
  const current = teamGames(regular).filter((g) => seasonFor(g.date) === season).slice(-16)
  const previous = teamGames(regular).filter((g) => seasonFor(g.date) === season - 1).slice(-8)
  const warmup = teamGames(preseason).filter((g) => seasonFor(g.date) === season).slice(-4)
  const weighted = [[current, 4], [previous, 1], [warmup, 0.5]] as const
  const total = weighted.reduce((n, [games, weight]) => n + games.length * weight, 0)
  if (!total) return null
  const points = (forTeam: boolean) => weighted.reduce((n, [games, weight]) => n + weight * games.reduce((value, g) => value +
    (g.home === team ? forTeam ? g.homeScore : g.awayScore : forTeam ? g.awayScore : g.homeScore), 0), 0) / total
  return { team, currentGames: current.length, previousGames: previous.length, preseasonGames: warmup.length,
    pointsFor: points(true), pointsAgainst: points(false),
    weights: { currentRegular: 4, previousRegular: 1, currentPreseason: 0.5 }, probabilityAdjustment: false }
}
