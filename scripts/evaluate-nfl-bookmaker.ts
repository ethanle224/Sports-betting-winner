// Read-only chronological evaluation of the app's actual forecast functions.
// Run: npx esbuild scripts/evaluate-nfl-bookmaker.ts --bundle --platform=node --format=esm --outfile=<temp>/eval.mjs && node <temp>/eval.mjs [report.json]
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { csvRows, fitScoreModel, forecastGame, parseGamesCsv, type ScoreForecast } from '../api/nfl-model.js'
import { forecastFromSportsbook, parseArchivedMarketGamesCsv, type BookmakerLine } from '../api/nfl-bookmaker.js'

const source = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'
const response = await fetch(source, { signal: AbortSignal.timeout(30000) })
if (!response.ok) throw new Error(`Historical data HTTP ${response.status}`)
const csv = await response.text()
if (csv.length > 8_000_000) throw new Error('Historical data exceeds scan limit')
const [header, ...rows] = csvRows(csv)
const at = (row: string[], name: string) => row[header.indexOf(name)]
const scores = parseGamesCsv(csv)
const archived = parseArchivedMarketGamesCsv(csv)
const games = rows.filter((row) => at(row, 'game_type') === 'REG' && /^20(24|25|26)$/.test(at(row, 'season')) &&
  /^\d{1,2}$/.test(at(row, 'home_score') || '') && /^\d{1,2}$/.test(at(row, 'away_score') || '') &&
  at(row, 'spread_line') && at(row, 'total_line') && at(row, 'home_moneyline') && at(row, 'away_moneyline'))
  .sort((a, b) => at(a, 'gameday').localeCompare(at(b, 'gameday')))
const implied = (price: number) => price > 0 ? 100 / (price + 100) : -price / (100 - price)
const chance = (forecast: ScoreForecast, event: (home: number, away: number) => number) =>
  forecast.samples.reduce((total, [h, a]) => total + event(h, a), 0) / forecast.samples.length
const win = (home: number, away: number) => home > away ? 1 : home === away ? 0.5 : 0
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const brier = (pairs: [number, number][]) => sum(pairs.map(([p, actual]) => (p - actual) ** 2)) / pairs.length
const logLoss = (pairs: [number, number][]) => sum(pairs.map(([p, actual]) => {
  const clipped = Math.min(0.999, Math.max(0.001, p))
  return -(actual * Math.log(clipped) + (1 - actual) * Math.log(1 - clipped))
})) / pairs.length
const result: Record<string, unknown> = {}
for (const year of ['2024', '2025', '2026']) {
  const modelScores: [number, number][] = [], bookScores: [number, number][] = [], oddsScores: [number, number][] = []
  const spreads: [number, number][] = [], totals: [number, number][] = []
  let trainingDate = '', scoreModel: ReturnType<typeof fitScoreModel> = null
  for (const game of games.filter((row) => at(row, 'season') === year)) {
    const date = at(game, 'gameday'), home = at(game, 'home_team'), away = at(game, 'away_team')
    if (trainingDate !== date) { scoreModel = fitScoreModel(scores, date); trainingDate = date }
    const baseline = scoreModel && forecastGame(scoreModel, home, away)
    const margin = Number(at(game, 'spread_line')), total = Number(at(game, 'total_line'))
    const line: BookmakerLine = { home, away, homeSpread: -margin, total,
      provider: 'archived sportsbook', eventId: at(game, 'game_id'), kickoff: date, observedAt: date }
    const independent = forecastFromSportsbook(archived, line, date)
    const h = Number(at(game, 'home_score')), a = Number(at(game, 'away_score'))
    const homeMoneyline = Number(at(game, 'home_moneyline')), awayMoneyline = Number(at(game, 'away_moneyline'))
    if (!baseline || !independent || !Number.isFinite(homeMoneyline) || !Number.isFinite(awayMoneyline) || !homeMoneyline || !awayMoneyline) continue
    const actual = win(h, a)
    modelScores.push([chance(baseline, win), actual]); bookScores.push([chance(independent, win), actual])
    const rawHome = implied(homeMoneyline), rawAway = implied(awayMoneyline)
    oddsScores.push([rawHome / (rawHome + rawAway), actual])
    // Main spread/total are historical settlement probes; pushes are excluded, not called losses.
    if (h - a !== margin) spreads.push([chance(independent, (x, y) => x - y > margin ? 1 : x - y === margin ? 0.5 : 0), h - a > margin ? 1 : 0])
    if (h + a !== total) totals.push([chance(independent, (x, y) => x + y > total ? 1 : x + y === total ? 0.5 : 0), h + a > total ? 1 : 0])
  }
  result[year] = { games: bookScores.length, homeWinBrier: { scoreOnly: brier(modelScores), sportsbookScore: brier(bookScores), sportsbookNoVig: brier(oddsScores) },
    homeWinLogLoss: { scoreOnly: logLoss(modelScores), sportsbookScore: logLoss(bookScores), sportsbookNoVig: logLoss(oddsScores) },
    mainSpreadBrier: brier(spreads), mainTotalBrier: brier(totals), spreadGames: spreads.length, totalGames: totals.length,
    sportsbookScoreCalibration: Array.from({ length: 5 }, (_, index) => {
      const bin = bookScores.filter(([p]) => p >= index / 5 && (index === 4 ? p <= 1 : p < (index + 1) / 5))
      return { range: `${index * 20}-${(index + 1) * 20}%`, games: bin.length,
        forecast: bin.length ? sum(bin.map(([p]) => p)) / bin.length : null,
        observed: bin.length ? sum(bin.map(([, y]) => y)) / bin.length : null }
    }) }
}
const report = { source, sha256: createHash('sha256').update(csv).digest('hex'), retrievedAt: new Date().toISOString(),
  method: 'Regular season, earlier games only; 512 newest paired closing-line score residuals; winner ties count half. Archived lines may be closing odds, not decision-time quotes.',
  bySeason: result }
if (process.argv[2]) writeFileSync(process.argv[2], `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
