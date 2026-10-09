import { describe, expect, it } from 'vitest'
import { fitNbaCalibration, forecastNbaGame, nbaLineChance, recentNbaMeetings, type NbaGame } from '../../server/nba-model'
import snapshot from '../../server/data/nba-games.json'

const games = snapshot.games as NbaGame[]
const calibration = fitNbaCalibration(games)

describe('NBA score-distribution v1', () => {
  it('uses only scores that could have been final before the target game, never future games', () => {
    const target = { home: '8', away: '2', tip: '2026-10-20T19:00:00Z', neutral: false }
    const before = forecastNbaGame(target, games, calibration)
    expect(before).not.toBeNull()
    const future: NbaGame = { id: 'future', season: 2027, tip: '2026-10-20T18:00:00Z', home: '8', away: '2', homeScore: 500, awayScore: 0, neutral: false }
    expect(forecastNbaGame(target, [...games, future], calibration)).toEqual(before)
    expect(calibration.trainingSeason).toBe(2024)
    expect(calibration.sampleSize).toBeGreaterThan(500)
  })

  it('abstains without adequate verified prior games or with an unknown team', () => {
    expect(forecastNbaGame({ home: '8', away: '2', tip: '2026-10-20T19:00:00Z', neutral: false }, games.slice(0, 10), calibration)).toBeNull()
    expect(forecastNbaGame({ home: 'not-a-team', away: '2', tip: '2026-10-20T19:00:00Z', neutral: false }, games, calibration)).toBeNull()
  })

  it('prices ML, home spread, and over/under from one score distribution, not from a market price', () => {
    const forecast = forecastNbaGame({ home: '8', away: '2', tip: '2026-10-20T19:00:00Z', neutral: false }, games, calibration)
    expect(forecast).not.toBeNull()
    if (!forecast) return
    expect(forecast.homeWin + forecast.awayWin).toBeCloseTo(1, 8)
    expect(nbaLineChance(forecast, 'homeSpread', -0.5)).toBeCloseTo(forecast.homeWin, 8)
    expect(nbaLineChance(forecast, 'homeSpread', 5.5)).toBeGreaterThan(nbaLineChance(forecast, 'homeSpread', -5.5)!)
    expect(nbaLineChance(forecast, 'over', 220.5)! + nbaLineChance(forecast, 'under', 220.5)!).toBeCloseTo(1, 8)
    expect(nbaLineChance(forecast, 'over', 210.5)).toBeGreaterThan(nbaLineChance(forecast, 'over', 230.5)!)
    expect(nbaLineChance(forecast, 'over', 220)).toBeNull() // integer lines can push; rules unverified
    expect(nbaLineChance(forecast, 'homeSpread', Number.NaN)).toBeNull()
  })

  it('never uses season-2026 games to fit the residual distribution on the season-2024 training block', () => {
    const altered = games.map((game) => game.season === 2026 ? { ...game, homeScore: game.homeScore + 100 } : game)
    expect(fitNbaCalibration(altered)).toEqual(calibration)
    expect(calibration.marginSd).toBeGreaterThan(0)
    expect(calibration.totalSd).toBeGreaterThan(0)
  })

  it('shows only past head-to-head games and treats home court as a modest non-neutral adjustment', () => {
    const target = { home: '8', away: '2', tip: '2026-10-20T19:00:00Z', neutral: false }
    const h2h = recentNbaMeetings(target, games)
    expect(h2h.length).toBeGreaterThan(0)
    expect(h2h.length).toBeLessThanOrEqual(8)
    expect(h2h.every((game) => game.tip < target.tip && game.season >= 2025)).toBe(true)
    const home = forecastNbaGame(target, games, calibration)
    const neutral = forecastNbaGame({ ...target, neutral: true }, games, calibration)
    expect(home && neutral && home.expectedMargin - neutral.expectedMargin).toBeCloseTo(calibration.homeAdvantage, 5)
    expect(calibration.homeAdvantage).toBeGreaterThanOrEqual(0)
    expect(calibration.homeAdvantage).toBeLessThanOrEqual(5)
  })

  it('evaluates 2025 and 2026 chronologically without market-return claims', () => {
    const rows = games.filter((g) => g.season === 2025 || g.season === 2026).map((g) => ({ g,
      f: forecastNbaGame(g, games, calibration) })).filter((row) => row.f !== null)
    expect(rows.length).toBeGreaterThan(2000)
    const mean = (f: (row: typeof rows[number]) => number) => rows.reduce((sum, row) => sum + f(row), 0) / rows.length
    const brier = mean(({ g, f }) => (f!.homeWin - Number(g.homeScore > g.awayScore)) ** 2)
    const marginMAE = mean(({ g, f }) => Math.abs(f!.expectedMargin - (g.homeScore - g.awayScore)))
    const totalMAE = mean(({ g, f }) => Math.abs(f!.expectedTotal - (g.homeScore + g.awayScore)))
    console.info('NBA score-only walk-forward (2025-26):', JSON.stringify({ count: rows.length, brier, marginMAE, totalMAE,
      baselineBrier: mean(({ g }) => (0.5 - Number(g.homeScore > g.awayScore)) ** 2) }))
    expect(Number.isFinite(brier + marginMAE + totalMAE)).toBe(true)
  }, 20000)
})
