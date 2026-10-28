import { describe, expect, it, vi } from 'vitest'
import { shotGame, collectNbaShotMatchup } from '../../server/nba-shot-profile'
import type { NbaGame } from '../../server/nba-model'
import { OPENING_NBA_GAMES } from '../../server/nba-kalshi'

const teams = [OPENING_NBA_GAMES[0].homeId, OPENING_NBA_GAMES[0].awayId]
const made = (id: string, team: string, x: number, y: number, pointsAttempted: number) => ({
  id, team: { id: team }, coordinate: { x, y }, shootingPlay: true, pointsAttempted, scoreValue: pointsAttempted,
})
const sample = { plays: [made('1', teams[0], 25, 8, 2), made('2', teams[0], 12, 25, 2),
  made('3', teams[0], 2, 1, 3), made('4', teams[1], 25, 8, 2), made('5', teams[1], 25, 25, 2),
  made('6', teams[1], 45, 1, 3)], boxscore: { teams: teams.map((id) => ({ team: { id },
  statistics: [{ name: 'fieldGoalsMade-fieldGoalsAttempted', displayValue: '3-3' },
    { name: 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', displayValue: '1-1' }] })) } }
const history: NbaGame[] = ['1', '2'].map((id) => ({ id, home: teams[0], away: teams[1],
  tip: '2026-10-20T19:00:00Z', season: 2027, homeScore: 100, awayScore: 90, neutral: false }))

describe('pregame shot-zone matchup research', () => {
  it('compares offense attempts to opponent allowed shares without claiming a model weight', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => sample })) as unknown as typeof fetch
    const profile = await collectNbaShotMatchup(teams[0], teams[1], history, '2026-10-21T20:00:00Z', fetcher)
    expect(profile.status).toBe('estimated')
    expect(profile.detail).toContain('0 forecast weight')
    expect(profile.detail).toContain('paint')
    expect(profile.detail).toContain('midrange')
    expect(profile.source).toContain('summary?event=1')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('rejects coordinates and missing shot records that do not reconcile to final box scores', () => {
    expect(shotGame({ ...sample, plays: sample.plays.slice(1) }, teams[0], teams[1])).toBeNull()
    expect(shotGame({ ...sample, plays: sample.plays.map((p) => p.id === '1' ? { ...p, coordinate: { x: 600, y: 8 } } : p) }, teams[0], teams[1])).toBeNull()
  })
  it('does not replace missing current-season sample with an invented prior-year profile', async () => {
    const result = await collectNbaShotMatchup(teams[0], teams[1], [], '2026-10-21T20:00:00Z')
    expect(result.status).toBe('unknown')
  })
  it.skipIf(!process.env.EDGEBOARD_LIVE_SHOTS)('reconciles a real final ESPN shot chart with official box-score attempts', async () => {
    const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=401909088')
    expect(response.ok).toBe(true)
    const zones = shotGame(await response.json(), teams[0], teams[1])
    expect(zones?.[teams[0]].attempts).toBe(86)
    expect(zones?.[teams[1]].three).toBe(42)
  }, 20000)
})
