import { describe, expect, it, vi } from 'vitest'
import { collectNbaCurrentHistory } from '../../server/nba-current-history'

const event = (id: string, date: string, state: string, homeScore: string, awayScore: string) => ({
  id, date, season: { year: 2027, type: 2 }, status: { type: { state } },
  competitions: [{ neutralSite: false, competitors: [
    { homeAway: 'home', team: { id: '8' }, score: homeScore },
    { homeAway: 'away', team: { id: '2' }, score: awayScore },
  ] }],
})

describe('current-season NBA history feed', () => {
  it('takes only finalized regular-season games available six hours before tip, with source provenance', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ events: [
      event('a', '2026-10-20T19:00:00Z', 'post', '121', '113'),
      event('b', '2026-10-21T19:00:00Z', 'pre', '0', '0'),
      event('c', '2026-10-21T18:00:00Z', 'post', '120', '118'),
    ] }) })) as unknown as typeof fetch
    const result = await collectNbaCurrentHistory('2026-10-21T23:00:00Z', '2026-10-21T20:00:00Z', fetcher)
    expect(result.games.map((game) => game.id)).toEqual(['a'])
    expect(result.games[0]).toMatchObject({ season: 2027, home: '8', away: '2', homeScore: 121, awayScore: 113 })
    expect(result.sources).toEqual(['https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=202610&limit=500'])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('fails closed on conflicting finals or incomplete monthly data', async () => {
    const duplicate = vi.fn(async () => ({ ok: true, json: async () => ({ events: [
      event('same', '2026-10-20T19:00:00Z', 'post', '121', '113'),
      event('same', '2026-10-20T19:00:00Z', 'post', '120', '113'),
    ] }) })) as unknown as typeof fetch
    await expect(collectNbaCurrentHistory('2026-10-22T23:00:00Z', '2026-10-22T18:00:00Z', duplicate)).rejects.toThrow()
    const missing = vi.fn(async () => ({ ok: false })) as unknown as typeof fetch
    await expect(collectNbaCurrentHistory('2026-10-22T23:00:00Z', '2026-10-22T18:00:00Z', missing)).rejects.toThrow()
  })
  it('does not read a target future month or accept an already started scan as pregame evidence', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ events: [] }) })) as unknown as typeof fetch
    await collectNbaCurrentHistory('2026-11-04T23:00:00Z', '2026-10-21T20:00:00Z', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
    await expect(collectNbaCurrentHistory('2026-10-20T19:00:00Z', '2026-10-21T20:00:00Z', fetcher)).rejects.toThrow()
  })
})
