import { expect, it } from 'vitest'
import { parseEspnOdds, forecastFromSportsbook, parseArchivedMarketGamesCsv } from '../../server/nfl-bookmaker'

const event = (spread = -4.5, total = 47.5) => ({ id: '401', date: '2026-10-04T17:00:00Z', status: { type: { state: 'pre' } },
  competitions: [{ competitors: [
    { homeAway: 'home', team: { abbreviation: 'WSH' } }, { homeAway: 'away', team: { abbreviation: 'IND' } },
  ], odds: [{ provider: { name: 'Draft Kings' }, spread, overUnder: total,
    homeTeamOdds: { favorite: spread < 0 }, awayTeamOdds: { favorite: spread > 0 } }] }] })

it('validates kickoff, identity, home spread direction and independent provider', () => {
  expect(parseEspnOdds({ events: [event(4.5)] }, '2026-10-04', '2026-10-02T12:00:00Z'))
    .toMatchObject([{ home: 'WAS', away: 'IND', homeSpread: 4.5, total: 47.5, provider: 'Draft Kings' }])
  expect(parseEspnOdds({ events: [event()] }, '2026-10-04', '2026-10-05T12:00:00Z')).toEqual([])
  const reversed = event(-4.5); reversed.competitions[0].odds[0].homeTeamOdds.favorite = false
  expect(parseEspnOdds({ events: [reversed] }, '2026-10-04', '2026-10-02T12:00:00Z')).toEqual([])
  expect(parseEspnOdds({ events: [{ ...event(), status: { type: { state: 'in' } } }] }, '2026-10-04', '2026-10-02T12:00:00Z')).toEqual([])
})

it('keeps only strictly prior archived score residuals and scores alternate lines differently', () => {
  const history = Array.from({ length: 32 }, (_, i) => ({ date: `2025-${String(1 + Math.floor(i / 4)).padStart(2, '0')}-${String(1 + i % 4 * 6).padStart(2, '0')}`,
    homeScore: 20 + i % 6, awayScore: 17 + i % 5, homeMargin: 3, total: 43 }))
  const line = { home: 'WAS', away: 'IND', total: 47.5, homeSpread: 4.5, provider: 'Draft Kings', eventId: '401', kickoff: '2026-10-04T17:00:00Z', observedAt: '2026-10-02T12:00:00Z' }
  const base = forecastFromSportsbook(history, line, '2026-10-04')!
  const poisoned = forecastFromSportsbook([...history, { date: '2026-10-04', homeScore: 90, awayScore: 0, homeMargin: 50, total: 90 }], line, '2026-10-04')!
  expect(base).toEqual(poisoned)
  expect(base.projectedHome).toBe(21.5)
  expect(base.samples.filter(([h, a]) => h + a > 42.5).length).toBeGreaterThanOrEqual(base.samples.filter(([h, a]) => h + a > 48.5).length)
})

it('rejects historical rows without scores and independent spread and total', () => {
  const text = 'game_type,gameday,home_score,away_score,spread_line,total_line\nREG,2025-09-07,28,21,3.5,47.5\nREG,2025-09-08,20,19,,39.5\n'
  expect(parseArchivedMarketGamesCsv(text)).toEqual([{ date: '2025-09-07', homeScore: 28, awayScore: 21, homeMargin: 3.5, total: 47.5 }])
})
