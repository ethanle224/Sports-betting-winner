import { expect, it } from 'vitest'
import { matchupContext, type EfficiencySnapshot } from './nfl-efficiency'

const games = Array.from({ length: 8 }, (_, i) => [
  { gameId: `2025_${i}_AAA_BBB`, date: `2025-09-${String(i + 1).padStart(2, '0')}`, team: 'AAA', opponent: 'BBB', plays: 50, epaSum: 10, successes: 25, firstDowns: 15, drives: 10 },
  { gameId: `2025_${i}_AAA_BBB`, date: `2025-09-${String(i + 1).padStart(2, '0')}`, team: 'BBB', opponent: 'AAA', plays: 60, epaSum: -6, successes: 24, firstDowns: 12, drives: 11 },
]).flat()
const snapshot: EfficiencySnapshot = { version: 1, generatedAt: '2026-10-02T00:00:00Z', lastGameDate: '2026-10-01', sources: [], games }

it('shows offense versus opposing defense using only games before the decision date', () => {
  const context = matchupContext(snapshot, 'AAA', 'BBB', '2026-10-04', '2025-09-08')!
  expect(context.home.offense.epaPerPlay).toBe(0.2)
  expect(context.home.opposingDefense.epaPerPlay).toBe(0.2)
  expect(context.away.offense.firstDownsPerGame).toBe(12)
  expect(context.home.offense.playsPerGame).toBe(50)
  const future = { ...snapshot, games: [...games, { ...games[0], gameId: 'future', date: '2026-10-04', epaSum: 1000 }] }
  expect(matchupContext(future, 'AAA', 'BBB', '2026-10-04', '2025-09-08')).toEqual(context)
})

it('abstains when snapshot is behind completed scores or samples are insufficient', () => {
  expect(matchupContext(snapshot, 'AAA', 'BBB', '2026-10-04', '2026-10-02')).toBeNull()
  expect(matchupContext({ ...snapshot, games: games.slice(0, 4) }, 'AAA', 'BBB', '2026-10-04', '2025-09-08')).toBeNull()
})
