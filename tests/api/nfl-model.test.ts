import { expect, it } from 'vitest'
import { fitScoreModel, forecastGame, parseGamesCsv, type CompletedGame } from '../../server/nfl-model'

const history: CompletedGame[] = Array.from({ length: 32 }, (_, i) => ({
  date: `2025-${String(1 + Math.floor(i / 4)).padStart(2, '0')}-${String(1 + (i % 4) * 6).padStart(2, '0')}`,
  home: i % 2 ? 'AAA' : 'BBB', away: i % 2 ? 'BBB' : 'AAA',
  homeScore: i % 2 ? 28 : 17, awayScore: i % 2 ? 17 : 28,
}))

it('parses completed regular-season scores only and handles quoted CSV cells', () => {
  const csv = 'game_id,season,game_type,gameday,home_team,away_team,home_score,away_score,stadium\n' +
    'one,2025,REG,2025-09-01,AAA,BBB,21,17,"Field, North"\n' +
    'two,2025,REG,2025-09-08,AAA,BBB,,,"Field, North"\n' +
    'three,2025,PRE,2025-08-01,AAA,BBB,20,10,Other\n'
  expect(parseGamesCsv(csv)).toEqual([{ date: '2025-09-01', home: 'AAA', away: 'BBB', homeScore: 21, awayScore: 17 }])
})

it('never trains on a target-date or future result, and abstains with too little history', () => {
  const before = fitScoreModel(history, '2025-03-01')
  expect(before).toBeNull()
  const model = fitScoreModel(history, '2026-10-04')!
  const poisoned = fitScoreModel([...history, { date: '2026-10-04', home: 'AAA', away: 'BBB', homeScore: 100, awayScore: 0 }], '2026-10-04')!
  expect(forecastGame(model, 'AAA', 'BBB')).toEqual(forecastGame(poisoned, 'AAA', 'BBB'))
  expect(forecastGame(model, 'AAA', 'UNKNOWN')).toBeNull()
})

it('produces coherent line-specific probabilities from a single score distribution', () => {
  const forecast = forecastGame(fitScoreModel(history, '2026-10-04')!, 'AAA', 'BBB')!
  expect(forecast.samples.length).toBeGreaterThan(20)
  const over = (line: number) => forecast.samples.filter(([home, away]) => home + away > line).length / forecast.samples.length
  expect(over(42.5)).toBeGreaterThanOrEqual(over(48.5))
  expect(forecast.samples.every(([home, away]) => Number.isInteger(home) && Number.isInteger(away) && home >= 0 && away >= 0)).toBe(true)
})
