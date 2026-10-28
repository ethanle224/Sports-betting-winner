import { describe, expect, it } from 'vitest'
import { summarizeNbaSimulation } from './nba-simulation-summary'

const sample = () => {
  const scores = Array.from({ length: 1000 }, (_, i) => i < 500
    ? { home: 110, away: 100, overtimePeriods: 0 }
    : { home: 100, away: 120, overtimePeriods: 0 })
  return { status: 'estimated' as const, simulations: 1000, scores, totals: scores.map((s) => s.home + s.away) }
}

describe('paired NBA simulation summary', () => {
  it('summarizes the paired outcomes rather than inventing independent team forecasts', () => {
    expect(summarizeNbaSimulation(sample())).toEqual({ meanHome: 105, meanAway: 110, meanTotal: 215,
      homeWin: .5, medianTotal: 215, p10Total: 210, p90Total: 220 })
  })
  it('does not turn unknown or incomplete simulation evidence into a trend', () => {
    const result = sample()
    expect(summarizeNbaSimulation({ ...result, status: 'unknown' })).toBeNull()
    expect(summarizeNbaSimulation({ ...result, simulations: 999 })).toBeNull()
    expect(summarizeNbaSimulation({ ...result, scores: result.scores.slice(1) })).toBeNull()
  })
  it('rejects mismatched totals, tied scores and non-finite scores', () => {
    for (const score of [{ home: 110, away: 110, overtimePeriods: 0 },
      { home: NaN, away: 100, overtimePeriods: 0 }, { home: -1, away: 100, overtimePeriods: 0 },
      { home: 110.5, away: 100, overtimePeriods: 0 }]) {
      const result = sample(); result.scores[0] = score
      expect(summarizeNbaSimulation(result)).toBeNull()
    }
    const result = sample(); result.totals[0]++
    expect(summarizeNbaSimulation(result)).toBeNull()
  })
})
