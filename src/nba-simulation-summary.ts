import type { NbaPlayerTotalsResult } from '../server/nba-player-totals'

export type NbaSimulationSummary = { meanHome: number; meanAway: number; meanTotal: number;
  homeWin: number; medianTotal: number; p10Total: number; p90Total: number }
type Simulation = Pick<NbaPlayerTotalsResult, 'status' | 'simulations' | 'scores' | 'totals'>

export function summarizeNbaSimulation(result: Simulation): NbaSimulationSummary | null {
  if (result.status !== 'estimated' || result.simulations !== 1000 ||
    !Array.isArray(result.scores) || result.scores.length !== 1000 ||
    !Array.isArray(result.totals) || result.totals.length !== 1000 ||
    result.scores.some((score, i) => !score || !Number.isSafeInteger(score.home) ||
      !Number.isSafeInteger(score.away) || score.home < 0 || score.away < 0 ||
      score.home === score.away || score.home + score.away !== result.totals[i])) return null
  const count = result.scores.length
  const meanHome = result.scores.reduce((sum, s) => sum + s.home, 0) / count
  const meanAway = result.scores.reduce((sum, s) => sum + s.away, 0) / count
  const totals = [...result.totals].sort((a, b) => a - b)
  // Linear empirical quantiles describe these draws, not a calibrated prediction interval.
  const quantile = (p: number) => {
    const index = (count - 1) * p; const lower = Math.floor(index)
    return totals[lower] + (totals[Math.ceil(index)] - totals[lower]) * (index - lower)
  }
  return { meanHome, meanAway, meanTotal: meanHome + meanAway,
    homeWin: result.scores.filter((s) => s.home > s.away).length / count,
    medianTotal: quantile(.5), p10Total: quantile(.1), p90Total: quantile(.9) }
}
