import type { NbaFactor } from './nba-factors.js'
import type { NbaGame } from './nba-model.js'

const root = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event='
type Zones = { three: number; paint: number; midrange: number; attempts: number }
const empty = (): Zones => ({ three: 0, paint: 0, midrange: 0, attempts: 0 })
const stat = (items: { name?: string; displayValue?: string }[], name: string) =>
  items.find((item) => item.name === name)?.displayValue

// Coordinates are ESPN's chart positions, not an official NBA zone label.
// The paint proxy is x 17..33 and y 0..19 (court units); all other 2PA
// are a midrange proxy. A valid shot count and box-score 3PA are mandatory.
export function shotGame(raw: unknown, home: string, away: string): Record<string, Zones> | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as { plays?: unknown; boxscore?: { teams?: unknown } }
  if (!Array.isArray(data.plays) || !Array.isArray(data.boxscore?.teams)) return null
  const zones: Record<string, Zones> = { [home]: empty(), [away]: empty() }
  const made: Record<string, number> = { [home]: 0, [away]: 0 }
  const seen = new Set<string>()
  for (const play of data.plays) {
    if (!play?.shootingPlay) continue
    // ESPN also marks free throws as shooting plays; those have a sentinel
    // coordinate and must never enter field-goal shot-zone denominators.
    if (play.pointsAttempted === 1) continue
    const team = play.team?.id as string
    const coord = play.coordinate
    if (!zones[team] || typeof play.id !== 'string' || seen.has(play.id) ||
      !Number.isFinite(coord?.x) || coord.x < 0 || coord.x > 50 ||
      !Number.isFinite(coord?.y) || coord.y < -3 || coord.y > 90 ||
      ![2, 3].includes(play.pointsAttempted) || ![0, play.pointsAttempted].includes(play.scoreValue)) return null
    seen.add(play.id)
    const zone = zones[team]
    zone.attempts++
    if (play.scoreValue > 0) made[team]++
    if (play.pointsAttempted === 3) zone.three++
    else if (coord.x >= 17 && coord.x <= 33 && coord.y >= 0 && coord.y <= 19) zone.paint++
    else zone.midrange++
  }
  for (const team of [home, away]) {
    const entry = data.boxscore.teams.find((item: { team?: { id?: string } }) => item.team?.id === team)
    const items = entry?.statistics as { name?: string; displayValue?: string }[] | undefined
    const field = /^(\d+)-(\d+)$/.exec(stat(items ?? [], 'fieldGoalsMade-fieldGoalsAttempted') ?? '')
    const three = /^(\d+)-(\d+)$/.exec(stat(items ?? [], 'threePointFieldGoalsMade-threePointFieldGoalsAttempted') ?? '')
    if (!field || !three || zones[team].attempts !== Number(field[2]) ||
      zones[team].three !== Number(three[2]) || made[team] !== Number(field[1])) return null
  }
  return zones
}

const share = (value: number, attempts: number) => `${(100 * value / attempts).toFixed(0)}%`
export async function collectNbaShotMatchup(home: string, away: string, history: NbaGame[], observedAt: string,
  fetcher: typeof fetch = fetch, cache = new Map<string, Promise<Record<string, Zones> | null>>()): Promise<NbaFactor> {
  const unknown = (detail: string): NbaFactor => ({ status: 'unknown', detail })
  const cutoff = Date.parse(observedAt) - 6 * 3600000
  const selected = (team: string) => history.filter((g) => g.season === 2027 && Date.parse(g.tip) < cutoff &&
    (g.home === team || g.away === team)).slice(-3)
  const homeGames = selected(home); const awayGames = selected(away)
  if (homeGames.length < 2 || awayGames.length < 2) return unknown('Need at least two finalized current-season games per team for shot-location research; 0 forecast weight.')
  const all = [...new Map([...homeGames, ...awayGames].map((g) => [g.id, g])).values()]
  const urls = all.map((g) => `${root}${encodeURIComponent(g.id)}`)
  const profiles = await Promise.all(all.map((g) => {
    if (!cache.has(g.id)) cache.set(g.id, (async () => {
      try {
        const response = await fetcher(`${root}${encodeURIComponent(g.id)}`, { signal: AbortSignal.timeout(10000) })
        return response.ok ? shotGame(await response.json(), g.home, g.away) : null
      } catch { return null }
    })())
    return cache.get(g.id)!
  }))
  if (profiles.some((p) => !p)) return unknown('Shot attempt/chart reconciliation or source unavailable; zone split remains unknown, 0 forecast weight.')
  const aggregate = (team: string, games: NbaGame[], opponent: boolean) => games.reduce((totals, g) => {
    const profile = profiles[all.findIndex((item) => item.id === g.id)]!
    const shot = profile[opponent ? g.home === team ? g.away : g.home : team]
    for (const key of ['three', 'paint', 'midrange', 'attempts'] as const) totals[key] += shot[key]
    return totals
  }, empty())
  const homeOff = aggregate(home, homeGames, false); const awayOff = aggregate(away, awayGames, false)
  const homeAllowed = aggregate(home, homeGames, true); const awayAllowed = aggregate(away, awayGames, true)
  const text = (off: Zones, allowed: Zones) => `3s ${share(off.three, off.attempts)}/${share(allowed.three, allowed.attempts)}, ` +
    `paint proxy ${share(off.paint, off.attempts)}/${share(allowed.paint, allowed.attempts)}, ` +
    `midrange proxy ${share(off.midrange, off.attempts)}/${share(allowed.midrange, allowed.attempts)}`
  return { status: 'estimated', observedAt, source: urls.join(' · '),
    detail: `Offense attempt share / opponent allowed attempt share: ${home} (${homeGames.length} games) vs ${away}: ${text(homeOff, awayAllowed)}; ` +
      `${away} (${awayGames.length} games) vs ${home}: ${text(awayOff, homeAllowed)}. ` +
      `3PA and FGA reconcile to box scores; paint/midrange use approximate ESPN coordinates, not official shot zones. ` +
      `Small current-season samples and roster changes; 0 forecast weight pending chronological validation.` }
}
