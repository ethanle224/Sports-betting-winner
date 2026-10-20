import { describe, expect, it, vi } from 'vitest'
import { collectNbaFactors } from '../../server/nba-factors'
import type { NbaGame } from '../../server/nba-model'
import { OPENING_NBA_GAMES } from '../../server/nba-kalshi'

const now = '2026-10-19T23:00:00Z'
const game = OPENING_NBA_GAMES[0]
const history = Array.from({ length: 82 }, (_, index): NbaGame => ({ id: `h${index}`, season: 2026,
  tip: '2026-03-01T00:00:00Z', home: game.homeId, away: game.awayId, homeScore: 115, awayScore: 109, neutral: false }))
const stats = (year: number) => ({ requestedSeason: { year, type: 2 }, results: { stats: { categories: [
  { stats: Object.entries({ gamesPlayed: 82, avgPoints: 115, avgFieldGoalsAttempted: 88, avgFreeThrowsAttempted: 23,
    avgOffensiveRebounds: 11, avgTurnovers: 14, avgThreePointFieldGoalsAttempted: 34,
    threePointPct: 37, avgAssists: 27 }).map(([name, value]) => ({ name, value })) },
] } } })
const summary = { injuries: [
  { team: { id: game.homeId }, injuries: [{ athlete: { displayName: 'Player A' }, status: 'Out', date: '2026-10-19T22:00:00Z' }] },
  { team: { id: game.awayId }, injuries: [] },
] }
const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('summary?') ? summary : stats(2026) } as Response))

describe('NBA factor evidence', () => {
  it('records dated reported injuries and validated prior-season pace, threes and assists without claiming current roster verification', async () => {
    const factors = await collectNbaFactors(game, history, now, fetcher)
    expect(factors.injuries).toMatchObject({ status: 'reported', players: [{ name: 'Player A', status: 'Out', team: 'Detroit' }] })
    expect(factors.threes).toMatchObject({ status: 'verified', detail: expect.stringContaining('34.0') })
    expect(factors.pace).toMatchObject({ status: 'estimated', detail: expect.stringContaining('possessions') })
    expect(factors.ballMovement).toMatchObject({ status: 'estimated', detail: expect.stringContaining('27.0') })
    expect(factors.offenseDefense.status).toBe('verified')
    expect(factors.starters.status).toBe('unknown')
    expect(factors.rosterMatchup.status).toBe('unknown')
    expect(factors.injuries.source).toContain(`event=${game.gameId}`)
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/statistics'))).toHaveLength(2)
  })
  it('never accepts mismatched future stats, stale injury reports or broken feeds as current evidence', async () => {
    const broken = vi.fn(async (url: string) => {
      if (url.includes('summary?')) return { ok: true, json: async () => ({ injuries: [{ team: { id: game.homeId }, injuries: [{ athlete: { displayName: 'Old' }, status: 'Out', date: '2026-10-12T00:00:00Z' }] }] }) } as Response
      if (url.includes(`/teams/${game.awayId}/`)) throw Error('upstream unavailable')
      return { ok: true, json: async () => stats(2027) } as Response
    })
    const factors = await collectNbaFactors(game, history, now, broken)
    expect(factors.injuries.status).toBe('unknown')
    expect(factors.threes.status).toBe('unknown')
    expect(factors.offenseDefense.status).toBe('unknown')
    expect(factors.starters.status).toBe('unknown')
  })
  it('never treats a missing team injury list as proof that the team is healthy', async () => {
    const factors = await collectNbaFactors(game, history, now, vi.fn(async (url: string) =>
      ({ ok: true, json: async () => url.includes('summary?') ? { injuries: [] } : stats(2026) } as Response)))
    expect(factors.injuries.status).toBe('unknown')
  })
})
