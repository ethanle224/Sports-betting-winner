import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSessionToken } from '../../server/auth-core'
import handler from '../../api/nba-research'

function response() {
  const state: { code: number; payload: unknown } = { code: 0, payload: null }
  return { state, setHeader: vi.fn(), status(code: number) { state.code = code; return { json(payload: unknown) { state.payload = payload } } } }
}
const cookie = `edgeboard_session=${createSessionToken('Admin', 'test-secret')}`
const teams = Array.from({ length: 30 }, (_, i) => ({ team: { id: String(i + 1), abbreviation: `T${i}`, displayName: `Team ${i}` }, stats: [
  { name: 'avgPointsFor', displayValue: '115.2' }, { name: 'avgPointsAgainst', displayValue: '111.7' },
  { name: 'wins', displayValue: '50' }, { name: 'losses', displayValue: '32' },
] }))
const standings = { season: { displayName: '2025-26' }, children: [{ standings: { entries: teams.slice(0, 15) } }, { standings: { entries: teams.slice(15) } }] }
const scoreboard = { events: [{ id: '401', name: 'Team 1 at Team 0', date: '2026-10-20T19:00:00Z', season: { type: 2 }, competitions: [{ competitors: [
  { homeAway: 'home', team: { id: '1' } }, { homeAway: 'away', team: { id: '2' } },
], neutralSite: false }] }] }

describe('NBA research endpoint', () => {
  afterEach(() => { vi.restoreAllMocks(); delete process.env.EDGEBOARD_SESSION_SECRET })
  it('denies anonymous requests without fetching NBA data', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
    const res = response()
    await handler({ method: 'GET', headers: {} }, res)
    expect(res.state.code).toBe(401)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('returns sourced scores-only forecast and dated matchups without inventing ratings or picks', async () => {
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true, json: async () => String(url).includes('standings') ? standings : scoreboard }) as Response)
    const res = response()
    await handler({ method: 'GET', headers: { cookie } }, res)
    expect(res.state.code).toBe(200)
    expect(res.state.payload).toMatchObject({ priorSeason: '2025-26',
      ratingsStatus: 'unavailable', forecastStatus: 'experimental score-only',
      games: [{ id: '401', home: 'Team 0', away: 'Team 1', startsAt: '2026-10-20T19:00:00Z',
        forecast: { model: 'nba-scores-v1', homeWin: expect.any(Number), expectedMargin: expect.any(Number) }, meetings: expect.any(Array),
        venueContext: { home: { wins: expect.any(Number), losses: expect.any(Number), margin: expect.any(Number) },
          awayRoad: { wins: expect.any(Number), losses: expect.any(Number), margin: expect.any(Number) } } }] })
    expect((res.state.payload as { teams: unknown[] }).teams).toHaveLength(30)
    expect((res.state.payload as { teams: unknown[] }).teams[0]).toMatchObject({ name: 'Team 0', pointsFor: 115.2, pointsAgainst: 111.7, wins: 50, losses: 32 })
    expect(JSON.stringify(res.state.payload)).not.toContain('offensiveRating')
    expect(JSON.stringify(res.state.payload)).not.toContain('paperPick')
  })
  it('fails closed when the prior-season team table is incomplete', async () => {
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true, json: async () => String(url).includes('standings') ? { ...standings, children: [standings.children[0]] } : scoreboard }) as Response)
    const res = response()
    await handler({ method: 'GET', headers: { cookie } }, res)
    expect(res.state.code).toBe(502)
    expect(JSON.stringify(res.state.payload)).not.toContain('Team 0')
  })

  it.skipIf(process.env.EDGEBOARD_LIVE_NBA !== '1')('parses the live opening-day schedule and 30-team prior-season standings', async () => {
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    const res = response()
    await handler({ method: 'GET', headers: { cookie } }, res)
    expect(res.state.code).toBe(200)
    const payload = res.state.payload as { teams: unknown[]; games: { forecast: { homeWin: number } | null; meetings: unknown[]; venueContext: unknown }[]; priorSeason: string }
    expect(payload.teams).toHaveLength(30)
    expect(payload.games.length).toBeGreaterThan(0)
    expect(payload.games[0].forecast?.homeWin).toBeGreaterThan(0)
    expect(payload.games[0].meetings.length).toBeGreaterThan(0)
    expect(payload.games[0].venueContext).toBeTruthy()
    expect(payload.priorSeason).toBe('2025-26')
  }, 30000)
})
