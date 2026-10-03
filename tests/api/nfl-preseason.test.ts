import { expect, it, vi } from 'vitest'
import { fetchPreseason, parsePreseason, weightedTeamForm } from '../../server/nfl-preseason'
import type { CompletedGame } from '../../server/nfl-model'

const event = (date = '2026-08-13T23:00:00Z', completed = true) => ({
  id: '401', date, season: { year: 2026, type: 1 }, status: { type: { completed } },
  competitions: [{ competitors: [
    { homeAway: 'home', team: { abbreviation: 'WSH' }, score: '16' },
    { homeAway: 'away', team: { abbreviation: 'IND' }, score: '14' },
  ] }],
})

it('accepts final preseason scores before cutoff and normalizes team identity', () => {
  expect(parsePreseason({ events: [event(), event('2026-10-11T17:00:00Z'), event('2026-08-14T23:00:00Z', false)] }, 2026, '2026-10-11'))
    .toEqual([{ date: '2026-08-13', home: 'WAS', away: 'IND', homeScore: 16, awayScore: 14, eventId: '401' }])
})

it('collects all preseason weeks and deduplicates repeated event ids', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ events: [event()] }) })
  const result = await fetchPreseason('2026-10-11', fetcher)
  expect(result.status).toBe('observed')
  expect(result.games).toHaveLength(1)
  expect(result.sources).toHaveLength(4)
  expect(fetcher).toHaveBeenCalledTimes(4)
})

it('uses current regular-season games more than prior seasons and preseason only as weak context', () => {
  const regular: CompletedGame[] = [
    ...Array.from({ length: 8 }, (_, i) => ({ date: `2025-10-${String(i + 1).padStart(2, '0')}`, home: 'WAS', away: 'IND', homeScore: 10, awayScore: 10 })),
    { date: '2026-09-10', home: 'WAS', away: 'IND', homeScore: 30, awayScore: 10 },
    { date: '2026-09-17', home: 'WAS', away: 'IND', homeScore: 30, awayScore: 10 },
  ]
  const preseason = [{ date: '2026-08-13', home: 'WAS', away: 'IND', homeScore: 20, awayScore: 10, eventId: '401' }]
  const form = weightedTeamForm(regular, preseason, 'WAS', '2026-10-11')!
  expect(form.weights).toEqual({ currentRegular: 4, previousRegular: 1, currentPreseason: 0.5 })
  expect(form.currentGames).toBe(2)
  expect(form.previousGames).toBe(8)
  expect(form.preseasonGames).toBe(1)
  expect(form.pointsFor).toBeGreaterThan(19)
  expect(form.pointsFor).toBeLessThan(30)
  expect(form.probabilityAdjustment).toBe(false)
  expect(weightedTeamForm(regular, [{ ...preseason[0], date: '2026-10-11', homeScore: 100 }], 'WAS', '2026-10-11')!.preseasonGames).toBe(0)
})
