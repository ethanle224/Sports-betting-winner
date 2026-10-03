import { csvRows, type ScoreForecast } from './nfl-model.js'

export type BookmakerLine = { home: string; away: string; homeSpread: number; total: number;
  provider: string; eventId: string; kickoff: string; observedAt: string; sourceOdds?: unknown }
export type ArchivedLineGame = { date: string; homeScore: number; awayScore: number; homeMargin: number; total: number }
const teamAliases: Record<string, string> = { WSH: 'WAS', LAR: 'LA', JAC: 'JAX' }
const normalizedTeam = (team: string) => teamAliases[team] ?? team

// ESPN scoreboard odds are an external sportsbook observation, NOT Kalshi market prices.
// ESPN does not publish a quote-update timestamp here: observedAt is our HTTP collection time.
export function parseEspnOdds(raw: unknown, date: string, observedAt: string): BookmakerLine[] {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { events?: unknown }).events)) throw new Error('Malformed scoreboard')
  return (raw as { events: Record<string, unknown>[] }).events.flatMap((event) => {
    if (!event || typeof event !== 'object' || typeof event.date !== 'string' || !event.date.startsWith(date) ||
      !Number.isFinite(Date.parse(event.date)) || Date.parse(event.date) <= Date.parse(observedAt) ||
      (event.status as { type?: { state?: string } } | undefined)?.type?.state !== 'pre') return []
    const competitions = event.competitions as { competitors?: { homeAway?: string; team?: { abbreviation?: string } }[];
      odds?: { provider?: { name?: string }; spread?: number; overUnder?: number;
        homeTeamOdds?: { favorite?: boolean }; awayTeamOdds?: { favorite?: boolean } }[] }[] | undefined
    if (!Array.isArray(competitions) || competitions.length !== 1) return []
    const competition = competitions[0]
    if (!Array.isArray(competition.competitors) || competition.competitors.length !== 2) return []
    const home = competition.competitors.find((team) => team.homeAway === 'home')?.team?.abbreviation
    const away = competition.competitors.find((team) => team.homeAway === 'away')?.team?.abbreviation
    const odds = competition.odds?.find((line) => line.provider?.name === 'Draft Kings')
    if (!home || !away || home === away || !odds || !Number.isFinite(odds.spread) || !Number.isFinite(odds.overUnder)) return []
    const spread = odds.spread!; const total = odds.overUnder!
    if (Math.abs(spread) > 35 || total < 20 || total > 90 ||
      (spread < 0 && odds.homeTeamOdds?.favorite !== true) ||
      (spread > 0 && odds.awayTeamOdds?.favorite !== true)) return []
    return [{ home: normalizedTeam(home), away: normalizedTeam(away), homeSpread: spread, total,
      provider: 'Draft Kings', eventId: String(event.id ?? ''), kickoff: event.date, observedAt, sourceOdds: odds }]
  })
}

export function parseArchivedMarketGamesCsv(csv: string): ArchivedLineGame[] {
  const [headers, ...rows] = csvRows(csv)
  if (!headers) throw new Error('Empty historical data')
  const columns = ['game_type', 'gameday', 'home_score', 'away_score', 'spread_line', 'total_line'].map((key) => {
    const index = headers.indexOf(key); if (index < 0) throw new Error(`Historical data missing ${key}`); return index
  })
  return rows.flatMap((row) => {
    const [kind, date, homeText, awayText, spreadText, totalText] = columns.map((i) => row[i])
    if (kind !== 'REG' || !/^20\d\d-\d\d-\d\d$/.test(date || '') ||
      !/^\d{1,2}$/.test(homeText || '') || !/^\d{1,2}$/.test(awayText || '') ||
      !/^-?\d+(?:\.\d+)?$/.test(spreadText || '') || !/^\d+(?:\.\d+)?$/.test(totalText || '')) return []
    const homeMargin = Number(spreadText); const total = Number(totalText)
    if (Math.abs(homeMargin) > 35 || total < 20 || total > 90) return []
    return [{ date, homeScore: Number(homeText), awayScore: Number(awayText), homeMargin, total }]
  })
}

export function forecastFromSportsbook(history: ArchivedLineGame[], line: BookmakerLine, date: string): ScoreForecast | null {
  const prior = history.filter((g) => g.date < date && g.date >= `${Number(date.slice(0, 4)) - 2}-01-01`)
    .sort((a, b) => a.date.localeCompare(b.date)).slice(-512)
  if (prior.length < 24) return null
  const projectedHome = (line.total - line.homeSpread) / 2
  const projectedAway = (line.total + line.homeSpread) / 2
  if (projectedHome < 0 || projectedAway < 0) return null
  const samples: [number, number][] = prior.map((g) => {
    const priorHome = (g.total + g.homeMargin) / 2
    const priorAway = (g.total - g.homeMargin) / 2
    return [Math.max(0, Math.round(projectedHome + g.homeScore - priorHome)),
      Math.max(0, Math.round(projectedAway + g.awayScore - priorAway))]
  })
  return { samples, projectedHome, projectedAway, trainingGames: prior.length }
}
