import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { NBA_CHALLENGER_CONFIG, fitNbaChallengerCalibration, forecastNbaChallenger, nbaChallengerCalibrationAt, prepareNbaChallengerGames,
  type NbaChallengerCalibration, type NbaChallengerForecast, type NbaChallengerResult } from '../server/nba-challenger.js'
import { fitNbaCalibration, forecastNbaGame, type NbaForecast, type NbaGame } from '../server/nba-model.js'

export type NbaChallengerEvaluationRow = {
  game: NbaGame; baseline: NbaForecast; challenger: NbaChallengerResult
  uncertainty: Omit<NbaChallengerCalibration, 'residuals'> | null
}
const metricNames = ['marginMAE', 'marginRMSE', 'mlBrier', 'mlLogloss', 'hitRate', 'totalMAE', 'totalRMSE'] as const
type Metric = typeof metricNames[number]
type Scores = Record<Metric, number>
type Bin = { lower: number; upper: number; count: number; meanProbability: number | null; observedHomeWinRate: number | null }
type Sum = { count: number; marginAbs: number; marginSquared: number; brier: number; logloss: number; hits: number; totalAbs: number; totalSquared: number }
const empty = (): Sum => ({ count: 0, marginAbs: 0, marginSquared: 0, brier: 0, logloss: 0, hits: 0, totalAbs: 0, totalSquared: 0 })
const add = (a: Sum, b: Sum) => { for (const key of Object.keys(a) as (keyof Sum)[]) a[key] += b[key] }
const scores = (sum: Sum): Scores => ({ marginMAE: sum.marginAbs / sum.count, marginRMSE: Math.sqrt(sum.marginSquared / sum.count),
  mlBrier: sum.brier / sum.count, mlLogloss: sum.logloss / sum.count, hitRate: sum.hits / sum.count,
  totalMAE: sum.totalAbs / sum.count, totalRMSE: Math.sqrt(sum.totalSquared / sum.count) })
const difference = (baseline: Scores, challenger: Scores): Scores => Object.fromEntries(metricNames.map(key => [key, challenger[key] - baseline[key]])) as Scores

function observation(game: NbaGame, forecast: NbaForecast | NbaChallengerForecast): Sum {
  const margin = game.homeScore - game.awayScore
  const total = game.homeScore + game.awayScore
  if (![margin, total, forecast.expectedMargin, forecast.expectedTotal, forecast.homeWin].every(Number.isFinite) ||
    margin === 0 || forecast.homeWin < 0 || forecast.homeWin > 1) throw new Error('Invalid evaluation outcome or forecast')
  const won = Number(margin > 0); const probability = forecast.homeWin
  const clipped = Math.max(1e-15, Math.min(1 - 1e-15, probability))
  return { count: 1, marginAbs: Math.abs(margin - forecast.expectedMargin), marginSquared: (margin - forecast.expectedMargin) ** 2,
    brier: (probability - won) ** 2, logloss: -(won * Math.log(clipped) + (1 - won) * Math.log(1 - clipped)),
    hits: probability === 0.5 ? 0.5 : Number((probability > 0.5) === Boolean(won)),
    totalAbs: Math.abs(total - forecast.expectedTotal), totalSquared: (total - forecast.expectedTotal) ** 2 }
}
function calibrationBins(rows: NbaChallengerEvaluationRow[], side: 'baseline' | 'challenger'): Bin[] {
  return Array.from({ length: 10 }, (_, i) => {
    const selected = rows.filter(row => Math.min(9, Math.floor((side === 'baseline' ? row.baseline : row.challenger.forecast).homeWin * 10)) === i)
    return { lower: i / 10, upper: (i + 1) / 10, count: selected.length,
      meanProbability: selected.length ? selected.reduce((sum, row) => sum + (side === 'baseline' ? row.baseline : row.challenger.forecast).homeWin, 0) / selected.length : null,
      observedHomeWinRate: selected.length ? selected.filter(row => row.game.homeScore > row.game.awayScore).length / selected.length : null }
  })
}
function percentile(sorted: number[], q: number): number {
  const index = (sorted.length - 1) * q; const lower = Math.floor(index)
  return sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower)
}

/** Paired, deterministic bootstrap resamples whole UTC tip-date clusters, retaining
 * every game's baseline/challenger pair. Intervals are percentile 95% CIs, not
 * live-holdout guarantees or multiple-comparison-adjusted significance tests.
 */
export function summarizeNbaChallengerRows(input: NbaChallengerEvaluationRow[], replicates = 2000) {
  if (!Number.isInteger(replicates) || replicates < 2) throw new Error('At least two bootstrap replicates required')
  const rows = [...input].sort((a, b) => Date.parse(a.game.tip) - Date.parse(b.game.tip) || a.game.id.localeCompare(b.game.id))
  if (!rows.length) return { count: 0, baseline: null, challenger: null, delta: null, pairedUncertainty: null }
  const baseline = empty(); const challenger = empty(); const days = new Map<string, { baseline: Sum; challenger: Sum }>()
  for (const row of rows) {
    if (row.baseline.expectedTotal !== row.challenger.forecast.expectedTotal || row.baseline.totalSd !== row.challenger.forecast.totalSd) {
      throw new Error(`Baseline totals must remain exactly unchanged: ${row.game.id}`)
    }
    const b = observation(row.game, row.baseline); const c = observation(row.game, row.challenger.forecast)
    add(baseline, b); add(challenger, c)
    const date = new Date(row.game.tip).toISOString().slice(0, 10)
    if (!days.has(date)) days.set(date, { baseline: empty(), challenger: empty() })
    add(days.get(date)!.baseline, b); add(days.get(date)!.challenger, c)
  }
  const clusters = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, pair]) => pair)
  const deltas = Object.fromEntries(metricNames.map(key => [key, [] as number[]])) as Record<Metric, number[]>
  const seed = 20251022; let randomState = seed
  const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296 }
  for (let r = 0; r < replicates; r++) {
    const b = empty(); const c = empty()
    for (let day = 0; day < clusters.length; day++) {
      const pair = clusters[Math.floor(random() * clusters.length)]
      add(b, pair.baseline); add(c, pair.challenger)
    }
    const delta = difference(scores(b), scores(c))
    for (const key of metricNames) deltas[key].push(delta[key])
  }
  const intervals = Object.fromEntries(metricNames.map(key => {
    const sorted = deltas[key].sort((a, b) => a - b)
    return [key, { lower: percentile(sorted, 0.025), upper: percentile(sorted, 0.975) }]
  })) as Record<Metric, { lower: number; upper: number }>
  return { count: rows.length, baseline: { ...scores(baseline), calibrationBins: calibrationBins(rows, 'baseline') },
    challenger: { ...scores(challenger), calibrationBins: calibrationBins(rows, 'challenger') },
    delta: difference(scores(baseline), scores(challenger)),
    pairedUncertainty: { method: 'paired UTC-tip-date cluster percentile bootstrap', clusters: clusters.length, replicates, seed,
      confidenceLevel: 0.95, deltaConvention: 'challenger minus baseline; negative improves errors, positive improves hitRate', intervals } }
}

/** Historical evaluation only: all three seasons already existed when this
 * challenger was implemented. 2024 is pretraining, never an honest test period.
 * 2025 probabilities use expanding past residuals (100 minimum), while every
 * 2026 probability uses the single frozen full-2025 residual RMS.
 */
export function evaluateNbaChallenger(input: NbaGame[], bootstrapReplicates = 2000) {
  const started = performance.now()
  const games = prepareNbaChallengerGames(input)
  if (games.length !== input.length) throw new Error('Invalid, duplicate or conflicting historical game rows; evaluation aborted')
  for (const season of [2024, 2025, 2026]) {
    if (games.filter(game => game.season === season).length !== 1230) throw new Error(`Expected complete 1230-game season ${season}`)
  }
  if (games.some(game => ![2024, 2025, 2026].includes(game.season))) throw new Error('Unexpected/future evaluation season')
  const baselineStarted = performance.now()
  const baselineCalibration = fitNbaCalibration(games.filter(game => game.season === 2024))
  const baselineCalibrationMs = performance.now() - baselineStarted
  const calibrationStarted = performance.now()
  const calibration = fitNbaChallengerCalibration(games, baselineCalibration)
  const uncertaintyFitMs = performance.now() - calibrationStarted
  if (!calibration) throw new Error('Insufficient chronological 2025 calibration residuals')
  const { residuals, ...lockedCalibration } = calibration
  const rows: NbaChallengerEvaluationRow[] = []
  const excluded: { id: string; season: number; reason: string }[] = []
  const predictionMs: number[] = []
  let firstForecastMs: number | null = null
  for (const game of games.filter(game => game.season === 2025 || game.season === 2026)) {
    const baseline = forecastNbaGame(game, games, baselineCalibration, 'nba-scores-v2')
    if (!baseline) { excluded.push({ id: game.id, season: game.season, reason: 'baseline unavailable' }); continue }
    const uncertainty = game.season === 2026 ? calibration : nbaChallengerCalibrationAt(calibration, game.tip)
    if (game.season === 2026 && !uncertainty) throw new Error(`Missing locked uncertainty: ${game.id}`)
    const predictionStarted = performance.now()
    const challenger = forecastNbaChallenger(game, games, baseline, baselineCalibration, uncertainty ?? undefined)
    const elapsed = performance.now() - predictionStarted
    firstForecastMs ??= elapsed; predictionMs.push(elapsed)
    if (!challenger) { excluded.push({ id: game.id, season: game.season, reason: 'challenger unavailable' }); continue }
    const cutoff = Date.parse(game.tip) - NBA_CHALLENGER_CONFIG.embargoHours * 3600_000
    if (Date.parse(challenger.asOf) >= cutoff || (uncertainty && Date.parse(uncertainty.asOf) >= cutoff)) throw new Error(`Temporal leakage: ${game.id}`)
    const metadata = uncertainty && { trainingSeason: uncertainty.trainingSeason, baselineTrainingSeason: uncertainty.baselineTrainingSeason,
      sampleSize: uncertainty.sampleSize, marginSd: uncertainty.marginSd, asOf: uncertainty.asOf }
    rows.push({ game, baseline, challenger, uncertainty: metadata })
  }
  const labels: Record<number, string> = { 2024: 'training-2024', 2025: 'validation-2025', 2026: 'test-2026-historical' }
  const years = Object.fromEntries([2024, 2025, 2026].map(season => {
    const selected = rows.filter(row => row.game.season === season)
    return [season, { label: labels[season], observedGames: 1230,
      excluded: season === 2024 ? 1230 : excluded.filter(game => game.season === season).length,
      exclusionReason: season === 2024 ? 'Training-only: complete-2024 calibration would leak into 2024 predictions; no scored claims' : null,
      uncertaintyFallbackCount: selected.filter(row => row.uncertainty === null).length,
      ...summarizeNbaChallengerRows(selected, bootstrapReplicates) }]
  })) as Record<number, ReturnType<typeof summarizeNbaChallengerRows> & {
    label: string; observedGames: number; excluded: number; exclusionReason: string | null; uncertaintyFallbackCount: number
  }>
  if (rows.length + excluded.length !== 2460) throw new Error('Paired evaluation accounting mismatch')
  const totalPreservationMismatches = rows.filter(row => row.baseline.expectedTotal !== row.challenger.forecast.expectedTotal ||
    row.baseline.totalSd !== row.challenger.forecast.totalSd).length
  if (totalPreservationMismatches) throw new Error('Baseline total preservation invariant violated')
  predictionMs.sort((a, b) => a - b)
  const summary = {
    model: NBA_CHALLENGER_CONFIG.model, baseline: 'nba-scores-v2', pristineLiveHoldout: false,
    evaluationKind: 'retrospective historical evaluation; 2026 was already present, not a pristine live holdout',
    config: NBA_CHALLENGER_CONFIG, baselineCalibration, lockedCalibration, years, excluded, totalPreservationMismatches,
    chronology: { training: '2024 only: unchanged v2 home advantage, margin/total SD calibration',
      validation: '2025 only: chronological v3 margin residuals; 100 prior residual minimum for expanding RMS, otherwise 2024 baseline SD',
      test: '2026 historical: locked full-2025 residual RMS; no 2026 uncertainty fitting or hyperparameter tuning',
      scoreCutoff: 'tip < target tip minus 6 hours for every rating input and uncertainty outcome',
      priorSeasonDecay: 'within-season age anchored at latest eligible tip of each prior season; current season at target cutoff' },
    caveats: ['Score-margin ratings, not measured pace, possessions, injury adjustments or roster news.',
      'No betting lines, odds, ROI, CLV, or profit claims; score/probability metrics only.',
      'Baseline retains its existing 0.5-point ML continuity correction; challenger uses symmetric normal CDF.',
      '2025 is validation with expanding residual uncertainty, not an independent test; 2026 is historical, not pristine live data.',
      'Bootstrap clusters are UTC calendar tip dates and intervals do not correct for exploratory selection or multiple comparisons.',
      'Complete-2024 calibration precludes honest scored 2024 out-of-sample comparison; its metrics are null.'],
    performance: { baselineCalibrationMs, uncertaintyFitMs, validationResiduals: residuals.length, firstForecastMs,
      forecastMedianMs: predictionMs.length ? percentile(predictionMs, 0.5) : null,
      forecastP95Ms: predictionMs.length ? percentile(predictionMs, 0.95) : null,
      maxSolverIterations: Math.max(...rows.map(row => row.challenger.diagnostics.iterations)),
      evaluationTotalMs: performance.now() - started },
  }
  return { rows, residuals, summary }
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const source = resolve(root, 'server/data/nba-games.json')
  const sourceText = await readFile(source, 'utf8')
  const snapshot = JSON.parse(sourceText) as { games: NbaGame[] }
  if (!Array.isArray(snapshot.games)) throw new Error('Missing historical NBA scores')
  const evaluation = evaluateNbaChallenger(snapshot.games)
  const output = resolve(root, 'nba-evaluation')
  await mkdir(output, { recursive: true })
  const artifact = { ...evaluation.summary, source: { path: source, sha256: createHash('sha256').update(sourceText).digest('hex'), games: snapshot.games.length } }
  await Promise.all([
    writeFile(resolve(output, 'nba-challenger-summary.json'), `${JSON.stringify(artifact, null, 2)}\n`),
    writeFile(resolve(output, 'nba-challenger-per-game.json'), `${JSON.stringify(evaluation.rows, null, 2)}\n`),
    writeFile(resolve(output, 'nba-challenger-validation-residuals.json'), `${JSON.stringify(evaluation.residuals, null, 2)}\n`),
  ])
  // Read back generated artifacts and check counts before reporting success.
  const savedRows = JSON.parse(await readFile(resolve(output, 'nba-challenger-per-game.json'), 'utf8')) as NbaChallengerEvaluationRow[]
  const savedResiduals = JSON.parse(await readFile(resolve(output, 'nba-challenger-validation-residuals.json'), 'utf8')) as unknown[]
  const savedSummary = JSON.parse(await readFile(resolve(output, 'nba-challenger-summary.json'), 'utf8')) as typeof artifact
  if (savedRows.length !== evaluation.rows.length || savedResiduals.length !== evaluation.residuals.length ||
    savedSummary.source.sha256 !== artifact.source.sha256) throw new Error('Generated artifact verification failed')
  console.log(JSON.stringify({ output, pairedGames: savedRows.length, summary: savedSummary }, null, 2))
}

// Importing this module for tests does no filesystem I/O or historical fitting.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1 })
}
