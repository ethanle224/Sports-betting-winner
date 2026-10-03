import { gzipSync } from 'node:zlib'
import { expect, it, vi } from 'vitest'
import { refreshEfficiency } from '../../server/nfl-live-efficiency'
import type { CompletedGame } from '../../server/nfl-model'
import type { EfficiencySnapshot } from '../../server/nfl-efficiency'

const snapshot: EfficiencySnapshot = { version: 1, generatedAt: '2026-10-02T00:00:00Z', lastGameDate: '2026-10-01', sources: [], games: [] }
const played: CompletedGame[] = [
  { date: '2026-10-01', home: 'CIN', away: 'JAX', homeScore: 20, awayScore: 10 },
  { date: '2026-10-08', home: 'CIN', away: 'JAX', homeScore: 24, awayScore: 21 },
]
const header = 'game_id,game_date,season_type,play_type,posteam,defteam,home_team,away_team,drive,epa,success,first_down,qb_spike,qb_kneel,desc\n'
const records = (day: string, teams = ['CIN', 'JAX']) => teams.flatMap((team) => Array.from({ length: 20 }, (_, i) =>
  `2026_05_JAX_CIN,${day},REG,${i % 2 ? 'pass' : 'run'},${team},${team === 'CIN' ? 'JAX' : 'CIN'},CIN,JAX,${Math.floor(i / 5) + 1},0.2,1,1,0,0,"quoted,\nplay"`)).join('\n') + '\n'
const feed = (text: string) => ({ ok: true, arrayBuffer: async () => Uint8Array.from(gzipSync(text)).buffer }) as Response

it('does not download efficiency data when the bundled snapshot already covers all prior finals', async () => {
  const fetcher = vi.fn()
  const result = await refreshEfficiency(snapshot, played.slice(0, 1), '2026-10-11', fetcher)
  expect(result.status).toBe('current')
  expect(fetcher).not.toHaveBeenCalled()
})

it('downloads current-season play-by-play before computing context and excludes future games', async () => {
  const fetcher = vi.fn().mockResolvedValue(feed(header + records('2026-10-08') + records('2026-10-11')))
  const result = await refreshEfficiency(snapshot, played, '2026-10-11', fetcher)
  expect(result.status).toBe('refreshed')
  expect(result.snapshot?.lastGameDate).toBe('2026-10-08')
  expect(result.snapshot?.games.filter((g) => g.date === '2026-10-08')).toHaveLength(2)
  expect(result.snapshot?.games.some((g) => g.date >= '2026-10-11')).toBe(false)
  expect(result.snapshot?.sources.at(-1)).toMatchObject({ url: expect.stringContaining('play_by_play_2026.csv.gz'), sha256: expect.stringMatching(/^[a-f0-9]{64}$/) })
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('does not serve stale statistics when the new play-by-play feed lags a completed game', async () => {
  const fetcher = vi.fn().mockResolvedValue(feed(header + records('2026-10-08', ['CIN'])))
  const result = await refreshEfficiency(snapshot, played, '2026-10-11', fetcher)
  expect(result.status).toBe('unavailable')
  expect(result.snapshot).toBeNull()
})
