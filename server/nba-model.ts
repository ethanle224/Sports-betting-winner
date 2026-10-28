// Experimental NBA score-only baseline. No market prices, orders, or injury claims.
export type NbaGame = { id: string; season: number; tip: string; home: string; away: string; homeScore: number; awayScore: number; neutral: boolean }
export type NbaTarget = Pick<NbaGame, 'home' | 'away' | 'tip' | 'neutral'>
export type NbaCalibration = { trainingSeason: number; sampleSize: number; homeAdvantage: number; marginSd: number; totalSd: number }
export type NbaForecast = { model: 'nba-scores-v1' | 'nba-scores-v2' | 'nba-sides-v3'; expectedMargin: number; expectedTotal: number; homeWin: number; awayWin: number; marginSd: number; totalSd: number; homeAdvantage: number; headToHeadCount: number }

const seasonAt = (tip: string) => { const d = new Date(tip); return d.getUTCFullYear() + (d.getUTCMonth() >= 7 ? 1 : 0) }
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))
// Normal CDF approximation, absolute error < 1e-7 for typical sports lines.
const cdf = (x: number) => {
  const z = Math.abs(x) / Math.sqrt(2)
  const t = 1 / (1 + 0.3275911 * z)
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z)
  return (1 + Math.sign(x) * erf) / 2
}

function prior(target: NbaTarget, games: NbaGame[]) {
  const cutoff = Date.parse(target.tip) - 6 * 60 * 60 * 1000 // no same-day results with unknown final time
  const season = seasonAt(target.tip)
  return games.filter((g) => Date.parse(g.tip) < cutoff && g.season >= season - 2 && g.season <= season)
}

export function recentNbaMeetings(target: NbaTarget, games: NbaGame[]): NbaGame[] {
  const season = seasonAt(target.tip)
  return prior(target, games).filter((g) => g.season >= season - 2 &&
    ((g.home === target.home && g.away === target.away) || (g.home === target.away && g.away === target.home)))
    .sort((a, b) => b.tip.localeCompare(a.tip)).slice(0, 8)
}

function scoreProjection(target: NbaTarget, games: NbaGame[], homeAdvantage: number) {
  const history = prior(target, games)
  if (history.length < 400) return null
  const season = seasonAt(target.tip)
  const baseline = history.slice(-800)
  const leagueMean = baseline.reduce((sum, g) => sum + g.homeScore + g.awayScore, 0) / (2 * baseline.length)
  const team = (id: string) => {
    const selected = history.filter((g) => g.home === id || g.away === id).slice(-30)
    if (selected.length < 12) return null
    let forSum = 0; let againstSum = 0; let weightSum = 0
    for (const g of selected) {
      const weight = g.season === season ? 1 : g.season === season - 1 ? 0.55 : 0.25
      const sideHome = g.home === id
      forSum += (sideHome ? g.homeScore : g.awayScore) * weight
      againstSum += (sideHome ? g.awayScore : g.homeScore) * weight
      weightSum += weight
    }
    // Team-specific rates shrink to the contemporaneous league baseline.
    return { attack: (forSum - leagueMean * weightSum) / (weightSum + 12), defense: (againstSum - leagueMean * weightSum) / (weightSum + 12) }
  }
  const home = team(target.home); const away = team(target.away)
  if (!home || !away || target.home === target.away) return null
  const homePoints = leagueMean + home.attack + away.defense + (target.neutral ? 0 : homeAdvantage / 2)
  const awayPoints = leagueMean + away.attack + home.defense - (target.neutral ? 0 : homeAdvantage / 2)
  return { expectedMargin: homePoints - awayPoints, expectedTotal: homePoints + awayPoints }
}

export function fitNbaCalibration(games: NbaGame[]): NbaCalibration {
  const training = games.filter((g) => g.season === 2024).sort((a, b) => a.tip.localeCompare(b.tip))
  if (training.length !== 1230) throw new Error('NBA 2024 calibration requires complete 1230-game regular season')
  const nonNeutral = training.filter((g) => !g.neutral)
  const homeAdvantage = clamp(nonNeutral.reduce((sum, g) => sum + g.homeScore - g.awayScore, 0) / nonNeutral.length, 0, 5)
  const residuals = training.map((g) => {
    const projection = scoreProjection(g, training, homeAdvantage)
    return projection && { margin: g.homeScore - g.awayScore - projection.expectedMargin,
      total: g.homeScore + g.awayScore - projection.expectedTotal }
  }).filter((r): r is { margin: number; total: number } => r !== null)
  if (residuals.length < 500) throw new Error('Insufficient NBA calibration games')
  const sd = (key: 'margin' | 'total') => {
    const mean = residuals.reduce((sum, r) => sum + r[key], 0) / residuals.length
    return Math.sqrt(residuals.reduce((sum, r) => sum + (r[key] - mean) ** 2, 0) / residuals.length)
  }
  return { trainingSeason: 2024, sampleSize: residuals.length, homeAdvantage, marginSd: sd('margin'), totalSd: sd('total') }
}

export function forecastNbaGame(target: NbaTarget, games: NbaGame[], calibration: NbaCalibration,
  version: 'nba-scores-v1' | 'nba-scores-v2' = 'nba-scores-v1'): NbaForecast | null {
  if (!Number.isFinite(Date.parse(target.tip))) return null
  const projection = scoreProjection(target, games, calibration.homeAdvantage)
  if (!projection || calibration.marginSd <= 0 || calibration.totalSd <= 0) return null
  const homeWin = clamp(1 - cdf((0.5 - projection.expectedMargin) / calibration.marginSd), 0, 1)
  return { model: version, ...projection, homeWin, awayWin: 1 - homeWin,
    marginSd: calibration.marginSd, totalSd: calibration.totalSd,
    homeAdvantage: target.neutral ? 0 : calibration.homeAdvantage,
    headToHeadCount: recentNbaMeetings(target, games).length }
}

// Integer spreads/totals can push; only non-integer half-point lines are supported.
export function nbaLineChance(forecast: NbaForecast, kind: 'homeSpread' | 'over' | 'under', line: number): number | null {
  if (!Number.isFinite(line) || Math.abs(line % 1) !== 0.5) return null
  if (kind === 'homeSpread') return 1 - cdf((-line - forecast.expectedMargin) / forecast.marginSd)
  if (kind === 'over') return 1 - cdf((line - forecast.expectedTotal) / forecast.totalSd)
  return cdf((line - forecast.expectedTotal) / forecast.totalSd)
}
