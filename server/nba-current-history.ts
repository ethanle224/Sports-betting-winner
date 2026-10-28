import type { NbaGame } from './nba-model.js'

const root = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard'
type Event = { id?: string; date?: string; season?: { year?: number; type?: number };
  status?: { type?: { state?: string } }; competitions?: { neutralSite?: boolean;
    competitors?: { homeAway?: string; team?: { id?: string }; score?: string }[] }[] }

// Read only months that have started as of this scan. This does not backfill a
// decision later: the entire result is frozen with the selected paper record.
export async function collectNbaCurrentHistory(targetTip: string, observedAt: string, fetcher: typeof fetch = fetch) {
  const tip = Date.parse(targetTip); const observed = Date.parse(observedAt)
  if (!Number.isFinite(tip) || !Number.isFinite(observed) || tip <= observed ||
    tip < Date.parse('2026-10-20T00:00:00Z')) throw new Error('Current history requires a future 2026–27 tip')
  const end = Math.min(observed, tip)
  const sources: string[] = []
  const games: NbaGame[] = []
  const seen = new Set<string>()
  for (let year = 2026, month = 10; year * 12 + month <= new Date(end).getUTCFullYear() * 12 + new Date(end).getUTCMonth() + 1;
    month++, year += month > 12 ? 1 : 0, month = month > 12 ? 1 : month) {
    const url = `${root}?dates=${year}${String(month).padStart(2, '0')}&limit=500`
    const response = await fetcher(url, { signal: AbortSignal.timeout(12000) })
    if (!response.ok) throw new Error('Monthly NBA history unavailable')
    const payload: { events?: Event[] } = await response.json()
    if (!Array.isArray(payload.events) || payload.events.length > 500) throw new Error('Incomplete NBA monthly scoreboard')
    sources.push(url)
    for (const event of payload.events) {
      if (event.season?.type !== 2 || event.season.year !== 2027) continue
      if (!event.id || seen.has(event.id) || !Number.isFinite(Date.parse(event.date ?? ''))) throw new Error('Ambiguous NBA historical event')
      seen.add(event.id)
      const started = Date.parse(event.date!)
      // The feed has no dependable finalization timestamp. Six hours prevents
      // using an in-progress or newly corrected same-day score as a prior.
      if (started >= Math.min(tip - 6 * 3600000, observed - 6 * 3600000)) continue
      if (event.status?.type?.state !== 'post') throw new Error('Unfinalized NBA history game')
      const competition = event.competitions?.[0]
      const home = competition?.competitors?.find((item) => item.homeAway === 'home')
      const away = competition?.competitors?.find((item) => item.homeAway === 'away')
      const homeScore = Number(home?.score); const awayScore = Number(away?.score)
      if (!home?.team?.id || !away?.team?.id || home.team.id === away.team.id ||
        typeof competition?.neutralSite !== 'boolean' ||
        !/^\d{1,3}$/.test(home.score ?? '') || !/^\d{1,3}$/.test(away.score ?? '') ||
        homeScore === awayScore) throw new Error('Incomplete NBA final score')
      games.push({ id: event.id, season: 2027, tip: event.date!, home: home.team.id, away: away.team.id,
        homeScore, awayScore, neutral: competition.neutralSite })
    }
  }
  return { games: games.sort((a, b) => a.tip.localeCompare(b.tip)), sources, observedAt }
}
