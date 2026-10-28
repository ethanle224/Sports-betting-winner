import { forecastNbaGame, type NbaCalibration, type NbaForecast, type NbaGame, type NbaTarget } from './nba-model.js'

/** Fixed before historical 2026 evaluation; deliberately not a replacement for v2. */
export const NBA_CHALLENGER_CONFIG = Object.freeze({
  model: 'nba-sides-v3' as const, previousSeasons: 2, ridge: 12,
  seasonWeights: Object.freeze([1, 0.55, 0.25]), halfLifeDays: 60,
  embargoHours: 6, minGames: 400, minTeamGames: 12, minCalibrationGames: 100, maxIterations: 500, tolerance: 1e-10,
})
export type NbaChallengerResidual = { id: string; tip: string; residual: number; modelAsOf: string }
export type NbaChallengerCalibration = {
  trainingSeason: 2025; baselineTrainingSeason: 2024; sampleSize: number; marginSd: number; asOf: string
  residuals: NbaChallengerResidual[]
}
export type NbaChallengerForecast = Omit<NbaForecast, 'model'> & { model: 'nba-sides-v3' }
export type NbaChallengerResult = {
  forecast: NbaChallengerForecast
  asOf: string
  sample: { games: number; teams: number; homeGames: number; awayGames: number; weightedGames: number }
  diagnostics: { iterations: number; converged: boolean; maxNormalEquationResidual: number;
    homeRating: number; awayRating: number; uncertaintySource: string }
}
const HOUR = 3600_000
const seasonAt = (tip: string) => { const d = new Date(tip); return d.getUTCFullYear() + Number(d.getUTCMonth() >= 7) }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const cdf = (x: number) => {
  if (x === 0) return 0.5 // no 0.5-point continuity correction: neutral swap symmetry
  const z = Math.abs(x) / Math.sqrt(2); const t = 1 / (1 + 0.3275911 * z)
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z)
  return (1 + Math.sign(x) * erf) / 2
}

/** Validate scores before arithmetic; remove exact duplicates and discard every
 * conflicting ID/fixture. Filtering by cutoff precedes conflict detection, so a
 * future injection cannot erase a past row. Does not mutate caller data.
 */
export function prepareNbaChallengerGames(games: readonly NbaGame[], cutoff = Infinity): NbaGame[] {
  const valid = games.filter(g => g && typeof g.id === 'string' && g.id.length > 0 &&
    typeof g.home === 'string' && g.home.length > 0 && typeof g.away === 'string' && g.away.length > 0 &&
    g.home !== g.away && typeof g.neutral === 'boolean' &&
    Number.isFinite(Date.parse(g.tip)) && Date.parse(g.tip) < cutoff &&
    Number.isInteger(g.season) && g.season === seasonAt(g.tip) &&
    Number.isFinite(g.homeScore) && Number.isInteger(g.homeScore) && g.homeScore >= 0 &&
    Number.isFinite(g.awayScore) && Number.isInteger(g.awayScore) && g.awayScore >= 0 && g.homeScore !== g.awayScore)
    .sort((a, b) => Date.parse(a.tip) - Date.parse(b.tip) || compare(a.id, b.id) || compare(a.tip, b.tip))
  const fixture = (g: NbaGame) => JSON.stringify([Date.parse(g.tip), g.home, g.away])
  const signature = (g: NbaGame) => JSON.stringify([fixture(g), g.season, g.neutral, g.homeScore, g.awayScore])
  const ids = new Map<string, Set<string>>(); const fixtures = new Map<string, Set<string>>()
  for (const g of valid) {
    const s = signature(g); const f = fixture(g)
    if (!ids.has(g.id)) ids.set(g.id, new Set())
    if (!fixtures.has(f)) fixtures.set(f, new Set())
    ids.get(g.id)!.add(s); fixtures.get(f)!.add(s)
  }
  const seen = new Set<string>()
  return valid.filter(g => {
    const f = fixture(g)
    if (ids.get(g.id)!.size > 1 || fixtures.get(f)!.size > 1 || seen.has(f)) return false
    seen.add(f); return true
  })
}

/** Minimize sum w*(margin-HCA-r_home+r_away)^2 + 12*sum r_team^2.
 * Sorted-team cyclic Gauss-Seidel on the SPD normal equations; stop at max
 * coordinate change <=1e-10, at most 500 sweeps; fail closed if not converged.
 * Previous-season decay is within that season (anchor its latest eligible tip),
 * while current-season decay is anchored at the target's six-hour cutoff.
 */
export function forecastNbaChallenger(target: NbaTarget, games: NbaGame[], baseline: NbaForecast,
  calibration: NbaCalibration, uncertainty?: Omit<NbaChallengerCalibration, 'residuals'>): NbaChallengerResult | null {
  const cutoff = Date.parse(target.tip) - NBA_CHALLENGER_CONFIG.embargoHours * HOUR
  // A complete end-year-2024 calibration cannot be used for a 2024 forecast.
  if (cutoff < Date.UTC(2024, 7, 1)) return null
  if (uncertainty && (uncertainty.trainingSeason !== 2025 || uncertainty.baselineTrainingSeason !== 2024 ||
    uncertainty.sampleSize < NBA_CHALLENGER_CONFIG.minCalibrationGames || !Number.isFinite(uncertainty.marginSd) ||
    uncertainty.marginSd <= 0 || !Number.isFinite(Date.parse(uncertainty.asOf)) || Date.parse(uncertainty.asOf) >= cutoff ||
    seasonAt(uncertainty.asOf) !== 2025)) return null
  if (!Number.isFinite(cutoff) || !target.home || !target.away || target.home === target.away || typeof target.neutral !== 'boolean' ||
    baseline.model !== 'nba-scores-v2' || calibration.trainingSeason !== 2024 ||
    ![baseline.expectedMargin, baseline.expectedTotal, baseline.marginSd, baseline.totalSd, baseline.homeWin, baseline.awayWin,
      calibration.homeAdvantage, calibration.marginSd, calibration.totalSd].every(Number.isFinite) ||
    baseline.expectedTotal <= 0 || baseline.totalSd <= 0 || baseline.marginSd <= 0 || calibration.marginSd <= 0 ||
    calibration.totalSd <= 0 || calibration.homeAdvantage < 0 || calibration.homeAdvantage > 5) return null
  const season = seasonAt(target.tip)
  const history = prepareNbaChallengerGames(games.filter(g => g.season <= season && g.season >= season - 2), cutoff)
  if (history.length < NBA_CHALLENGER_CONFIG.minGames) return null
  const teams = [...new Set(history.flatMap(g => [g.home, g.away]))].sort(compare)
  const index = new Map(teams.map((team, i) => [team, i]))
  const hi = index.get(target.home); const ai = index.get(target.away)
  const count = (id: string) => history.filter(g => g.home === id || g.away === id).length
  const homeGames = count(target.home); const awayGames = count(target.away)
  if (hi === undefined || ai === undefined || homeGames < 12 || awayGames < 12) return null
  const anchors = new Map<number, number>()
  for (const g of history) anchors.set(g.season, Math.max(anchors.get(g.season) ?? -Infinity, Date.parse(g.tip)))
  anchors.set(season, cutoff)
  const n = teams.length
  const matrix: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 12 : 0))
  const rhs = Array<number>(n).fill(0)
  let weightedGames = 0
  for (const g of history) {
    const h = index.get(g.home)!; const a = index.get(g.away)!
    const age = (anchors.get(g.season)! - Date.parse(g.tip)) / (24 * HOUR)
    const w = NBA_CHALLENGER_CONFIG.seasonWeights[season - g.season] * 2 ** (-age / 60)
    const margin = g.homeScore - g.awayScore - (g.neutral ? 0 : calibration.homeAdvantage)
    matrix[h][h] += w; matrix[a][a] += w; matrix[h][a] -= w; matrix[a][h] -= w
    rhs[h] += w * margin; rhs[a] -= w * margin; weightedGames += w
  }
  const ratings = Array<number>(n).fill(0)
  let iterations = 0; let converged = false
  for (; iterations < NBA_CHALLENGER_CONFIG.maxIterations;) {
    iterations++; let maxChange = 0
    for (let i = 0; i < n; i++) {
      let value = rhs[i]
      for (let j = 0; j < n; j++) if (j !== i) value -= matrix[i][j] * ratings[j]
      value /= matrix[i][i]
      maxChange = Math.max(maxChange, Math.abs(value - ratings[i])); ratings[i] = value
    }
    if (maxChange <= NBA_CHALLENGER_CONFIG.tolerance) { converged = true; break }
  }
  const maxNormalEquationResidual = Math.max(...matrix.map((row, i) => Math.abs(row.reduce((sum, v, j) => sum + v * ratings[j], 0) - rhs[i])))
  if (!converged || !Number.isFinite(maxNormalEquationResidual) || maxNormalEquationResidual > 1e-7) return null
  const homeAdvantage = target.neutral ? 0 : calibration.homeAdvantage
  const expectedMargin = ratings[hi] - ratings[ai] + homeAdvantage
  const marginSd = uncertainty?.marginSd ?? calibration.marginSd
  const homeWin = cdf(expectedMargin / marginSd)
  return { forecast: { ...baseline, model: 'nba-sides-v3', expectedMargin, homeWin, awayWin: 1 - homeWin,
    marginSd, homeAdvantage }, asOf: history[history.length - 1].tip,
    sample: { games: history.length, teams: n, homeGames, awayGames, weightedGames },
    diagnostics: { iterations, converged, maxNormalEquationResidual, homeRating: ratings[hi], awayRating: ratings[ai],
      uncertaintySource: uncertainty ? 'validation-2025' : 'pretraining-2024' } }
}

function residualCalibration(residuals: NbaChallengerResidual[]): NbaChallengerCalibration | null {
  if (residuals.length < NBA_CHALLENGER_CONFIG.minCalibrationGames) return null
  // Zero-mean normal residual MLE (RMS), not a recentered SD hiding margin bias.
  const marginSd = Math.sqrt(residuals.reduce((sum, r) => sum + r.residual ** 2, 0) / residuals.length)
  if (!Number.isFinite(marginSd) || marginSd <= 0) return null
  return { trainingSeason: 2025, baselineTrainingSeason: 2024, sampleSize: residuals.length,
    marginSd, asOf: residuals[residuals.length - 1].tip, residuals }
}

/** Only 2025 outcomes may calibrate v3 uncertainty. Every residual's prediction
 * is refitted using strictly earlier scores; an optional targetTip also embargoes
 * the calibration outcomes themselves. 2024 supplies only baseline pretraining.
 */
export function fitNbaChallengerCalibration(games: NbaGame[], baselineCalibration: NbaCalibration,
  targetTip?: string): NbaChallengerCalibration | null {
  const cutoff = targetTip === undefined ? Infinity : Date.parse(targetTip) - 6 * HOUR
  if (Number.isNaN(cutoff)) return null
  const history = prepareNbaChallengerGames(games.filter(g => g.season === 2024 || g.season === 2025), cutoff)
  const residuals: NbaChallengerResidual[] = []
  for (const game of history.filter(g => g.season === 2025)) {
    const baseline = forecastNbaGame(game, history, baselineCalibration, 'nba-scores-v2')
    if (!baseline) continue
    const result = forecastNbaChallenger(game, history, baseline, baselineCalibration)
    if (result) residuals.push({ id: game.id, tip: game.tip,
      residual: game.homeScore - game.awayScore - result.forecast.expectedMargin, modelAsOf: result.asOf })
  }
  return residualCalibration(residuals)
}

/** Select only available validation residuals for expanding 2025 uncertainty.
 * Permits computing the full residual ledger once without using future labels.
 */
export function nbaChallengerCalibrationAt(calibration: NbaChallengerCalibration,
  targetTip: string): NbaChallengerCalibration | null {
  const cutoff = Date.parse(targetTip) - 6 * HOUR
  if (!Number.isFinite(cutoff) || calibration.trainingSeason !== 2025 || calibration.baselineTrainingSeason !== 2024) return null
  const residuals = calibration.residuals.filter(r => Number.isFinite(r.residual) && seasonAt(r.tip) === 2025 &&
    Date.parse(r.tip) < cutoff && Date.parse(r.modelAsOf) < Date.parse(r.tip) - 6 * HOUR)
    .sort((a, b) => Date.parse(a.tip) - Date.parse(b.tip) || compare(a.id, b.id))
  return residualCalibration(residuals)
}
