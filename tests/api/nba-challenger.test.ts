import { describe, expect, it } from 'vitest'
import { fitNbaChallengerCalibration, forecastNbaChallenger, nbaChallengerCalibrationAt } from '../../server/nba-challenger'
import { evaluateNbaChallenger, summarizeNbaChallengerRows, type NbaChallengerEvaluationRow } from '../../scripts/evaluate-nba-challenger'
import snapshot from '../../server/data/nba-games.json'
import { fitNbaCalibration } from '../../server/nba-model'
import type { NbaForecast, NbaGame, NbaTarget } from '../../server/nba-model'

const baseline: NbaForecast = { model: 'nba-scores-v2', expectedMargin: 1, expectedTotal: 229.125,
  homeWin: 0.51, awayWin: 0.49, marginSd: 14, totalSd: 21.875, homeAdvantage: 2,
  headToHeadCount: 8 }
const calibration = { trainingSeason: 2024, sampleSize: 800, homeAdvantage: 2, marginSd: 14, totalSd: baseline.totalSd }
const target: NbaTarget = { home: 'a', away: 'b', tip: '2025-02-01T00:00:00Z', neutral: true }
const history: NbaGame[] = Array.from({ length: 420 }, (_, i) => ({
  id: `g${i}`, season: 2025, tip: new Date(Date.UTC(2024, 9, 1) + i * 6 * 3600_000).toISOString(),
  home: i % 2 === 0 ? 'a' : 'b', away: i % 2 === 0 ? 'b' : 'a',
  homeScore: i % 2 === 0 ? 112 : 100, awayScore: i % 2 === 0 ? 100 : 112, neutral: true,
}))

describe('isolated nba-sides-v3 challenger', () => {
  it('fits regularized opponent-adjusted margin but copies baseline v2 totals exactly', () => {
    const result = forecastNbaChallenger(target, history, baseline, { trainingSeason: 2024, sampleSize: 800, homeAdvantage: 2, marginSd: 14, totalSd: baseline.totalSd })
    expect(result).not.toBeNull()
    expect(result!.forecast.model).toBe('nba-sides-v3')
    expect(result!.forecast.expectedMargin).toBeGreaterThan(10)
    expect(result!.forecast.expectedMargin).toBeLessThan(12)
    expect(result!.forecast.expectedTotal).toBe(baseline.expectedTotal)
    expect(result!.forecast.totalSd).toBe(baseline.totalSd)
    expect(result!.sample.games).toBe(420)
    expect(result!.sample.homeGames).toBe(420)
    expect(Date.parse(result!.asOf)).toBeLessThan(Date.parse(target.tip) - 6 * 3600_000)
    expect(result!.diagnostics.converged).toBe(true)
    expect(result!.diagnostics.maxNormalEquationResidual).toBeLessThan(1e-7)
  })

  it('canonicalizes order and duplicate IDs/fixtures before fitting, without mutating inputs', () => {
    const original = JSON.stringify(history)
    const before = forecastNbaChallenger(target, history, baseline, calibration)
    const reverse = [...history].reverse()
    expect(forecastNbaChallenger(target, reverse, baseline, calibration)).toEqual(before)
    expect(forecastNbaChallenger(target, [...reverse, ...history, { ...history[0], id: 'alias' }], baseline, calibration)).toEqual(before)
    expect(JSON.stringify(history)).toBe(original)
  })

  it('excludes invalid scores, conflicting duplicates, future results and the exact six-hour boundary', () => {
    const before = forecastNbaChallenger(target, history, baseline, calibration)
    const injection = [NaN, Infinity, -1, 101.5].map((score, i) => ({ ...history[0], id: `bad${i}`, homeScore: score }))
    injection.push({ ...history[0], id: 'bad-time', tip: 'not-a-date' })
    injection.push({ ...history[0], id: 'bad-season', season: 2026 })
    injection.push({ ...history[0], id: 'future', tip: target.tip, homeScore: 1000 })
    injection.push({ ...history[0], id: 'embargo', tip: '2025-01-31T18:00:00Z', homeScore: 1000 })
    injection.push({ ...history[0], tip: target.tip, homeScore: 999 })
    expect(forecastNbaChallenger(target, [...history, ...injection], baseline, calibration)).toEqual(before)
    const conflict = { ...history[0], awayScore: 80 }
    expect(forecastNbaChallenger(target, [...history, conflict], baseline, calibration))
      .toEqual(forecastNbaChallenger(target, history.slice(1), baseline, calibration))
  })

  it('abstains on unknown teams, inadequate history, invalid target or invalid baseline calibration', () => {
    expect(forecastNbaChallenger({ ...target, home: 'unknown' }, history, baseline, calibration)).toBeNull()
    expect(forecastNbaChallenger(target, history.slice(0, 399), baseline, calibration)).toBeNull()
    expect(forecastNbaChallenger({ ...target, tip: 'bad' }, history, baseline, calibration)).toBeNull()
    expect(forecastNbaChallenger(target, history, { ...baseline, expectedTotal: NaN }, calibration)).toBeNull()
    expect(forecastNbaChallenger(target, history, baseline, { ...calibration, marginSd: NaN })).toBeNull()
    expect(forecastNbaChallenger(target, history, { ...baseline, model: 'nba-scores-v1' }, calibration)).toBeNull()
  })

  it('uses symmetric zero-advantage probabilities and swapped neutral team ratings', () => {
    const forward = forecastNbaChallenger(target, history, baseline, calibration)!
    const reverse = forecastNbaChallenger({ ...target, home: 'b', away: 'a' }, history, baseline, calibration)!
    expect(forward.forecast.expectedMargin).toBe(-reverse.forecast.expectedMargin)
    expect(forward.forecast.homeWin).toBeCloseTo(reverse.forecast.awayWin, 14)
    const paired = history.flatMap((g, i) => [{ ...g, id: `p${i}a`, home: 'a', away: 'b', homeScore: 112, awayScore: 100 },
      { ...g, id: `p${i}b`, home: 'b', away: 'a', homeScore: 112, awayScore: 100 }])
    const even = forecastNbaChallenger(target, paired, baseline, calibration)!
    expect(even.forecast.expectedMargin).toBe(0)
    expect(even.forecast.homeWin).toBe(0.5)
  })

  it('fits uncertainty from chronological 2025 residuals only, unaffected by 2026 outcomes', () => {
    const games = snapshot.games as NbaGame[]
    const pretraining = fitNbaCalibration(games)
    const before = fitNbaChallengerCalibration(games, pretraining)!
    expect(before.trainingSeason).toBe(2025)
    expect(before.sampleSize).toBe(1230)
    expect(before.marginSd).toBeGreaterThan(0)
    expect(before.asOf).toBe('2025-04-13T19:30:00Z')
    const altered = games.map(g => g.season === 2026 ? { ...g, homeScore: g.homeScore + 100 } : g)
    expect(fitNbaChallengerCalibration(altered, pretraining)).toEqual(before)
    const validationTip = games.filter(g => g.season === 2025)[150].tip
    const prefix = nbaChallengerCalibrationAt(before, validationTip)!
    expect(prefix).toEqual(fitNbaChallengerCalibration(games, pretraining, validationTip))
    expect(nbaChallengerCalibrationAt(before, 'not-a-date')).toBeNull()
    expect(nbaChallengerCalibrationAt(before, games.find(g => g.season === 2025)!.tip)).toBeNull()
    expect(nbaChallengerCalibrationAt(before, '2025-10-21T23:30:00Z')).toEqual(before)
  }, 120000)

  it('excludes the validation target and future residuals; rejects future-fitted uncertainty', () => {
    const games = snapshot.games as NbaGame[]
    const pretraining = fitNbaCalibration(games)
    const game = games.filter(g => g.season === 2025)[150]
    const before = fitNbaChallengerCalibration(games, pretraining, game.tip)!
    expect(before.sampleSize).toBeGreaterThan(100)
    expect(Date.parse(before.asOf)).toBeLessThan(Date.parse(game.tip) - 6 * 3600_000)
    const changed = games.map(g => Date.parse(g.tip) >= Date.parse(game.tip) - 6 * 3600_000
      ? { ...g, awayScore: g.awayScore + 50 } : g)
    expect(fitNbaChallengerCalibration(changed, pretraining, game.tip)).toEqual(before)
    expect(forecastNbaChallenger(target, history, baseline, calibration,
      { ...before, asOf: target.tip })).toBeNull()
    expect(forecastNbaChallenger({ ...target, tip: '2024-03-01T00:00:00Z' }, history, baseline, calibration)).toBeNull()
  }, 120000)

  it('reports paired errors, proper scores, calibration bins and deterministic slate bootstrap', () => {
    const result = forecastNbaChallenger(target, history, baseline, calibration)!
    const rows: NbaChallengerEvaluationRow[] = [true, false].map((homeWon, i) => ({
      game: { ...history[0], id: `eval${i}`, tip: `2025-02-0${i + 1}T00:00:00Z`, homeScore: homeWon ? 110 : 100, awayScore: homeWon ? 100 : 110 },
      baseline: { ...baseline, expectedMargin: 0, expectedTotal: 200, homeWin: 0.5, awayWin: 0.5 },
      challenger: { ...result, forecast: { ...result.forecast, expectedMargin: homeWon ? 5 : -5,
        expectedTotal: 200, homeWin: homeWon ? 0.8 : 0.2, awayWin: homeWon ? 0.2 : 0.8 } }, uncertainty: null,
    }))
    const summary = summarizeNbaChallengerRows(rows, 100)
    expect(summary.count).toBe(2)
    expect(summary.baseline!.marginMAE).toBe(10)
    expect(summary.challenger!.marginMAE).toBe(5)
    expect(summary.challenger!.mlBrier).toBeCloseTo(0.04, 14)
    expect(summary.challenger!.mlLogloss).toBeCloseTo(-Math.log(0.8), 14)
    expect(summary.baseline!.hitRate).toBe(0.5)
    expect(summary.challenger!.hitRate).toBe(1)
    expect(summary.challenger!.totalMAE).toBe(10)
    expect(summary.delta!.totalRMSE).toBe(0)
    expect(summary.challenger!.calibrationBins.reduce((n, bin) => n + bin.count, 0)).toBe(2)
    expect(summary.pairedUncertainty!.intervals.marginMAE.lower).toBe(-5)
    expect(summary.pairedUncertainty!.intervals.totalMAE.upper).toBe(0)
    expect(summarizeNbaChallengerRows([...rows].reverse(), 100)).toEqual(summary)
    expect(summarizeNbaChallengerRows([], 100).baseline).toBeNull()
    const broken = { ...rows[0], challenger: { ...rows[0].challenger,
      forecast: { ...rows[0].challenger.forecast, expectedTotal: 199 } } }
    expect(() => summarizeNbaChallengerRows([broken], 100)).toThrow(/total/i)
  })

  it('evaluates paired seasons with expanding 2025 and locked 2026 uncertainty without in-sample 2024 claims', () => {
    const evaluation = evaluateNbaChallenger(snapshot.games as NbaGame[], 20)
    expect(evaluation.rows).toHaveLength(2460)
    expect(evaluation.summary.years[2024].label).toBe('training-2024')
    expect(evaluation.summary.years[2024].count).toBe(0)
    expect(evaluation.summary.years[2025].count).toBe(1230)
    expect(evaluation.summary.years[2026].count).toBe(1230)
    expect(evaluation.summary.pristineLiveHoldout).toBe(false)
    expect(evaluation.summary.totalPreservationMismatches).toBe(0)
    expect(evaluation.summary.lockedCalibration.sampleSize).toBe(1230)
    const validation = evaluation.rows.filter(row => row.game.season === 2025)
    const test = evaluation.rows.filter(row => row.game.season === 2026)
    expect(validation[0].uncertainty).toBeNull()
    expect(validation[validation.length - 1].uncertainty!.sampleSize).toBeLessThan(1230)
    for (const row of evaluation.rows) {
      const cutoff = Date.parse(row.game.tip) - 6 * 3600_000
      expect(Date.parse(row.challenger.asOf)).toBeLessThan(cutoff)
      if (row.uncertainty) expect(Date.parse(row.uncertainty.asOf)).toBeLessThan(cutoff)
    }
    for (const row of test) expect(row.uncertainty!.marginSd).toBe(evaluation.summary.lockedCalibration.marginSd)
    expect(() => evaluateNbaChallenger((snapshot.games as NbaGame[]).slice(1), 20)).toThrow(/1230/)
    expect(() => evaluateNbaChallenger([...snapshot.games as NbaGame[], { ...history[0], id: 'invalid', homeScore: NaN }], 20)).toThrow(/invalid/i)
  }, 120000)
})
