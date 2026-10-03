import type { ScannedMarket } from './nfl-core.js'
import { fitScoreModel, forecastGame, parseGamesCsv, parseScheduleCsv } from './nfl-model.js'
import { forecastFromSportsbook, parseArchivedMarketGamesCsv, type BookmakerLine } from './nfl-bookmaker.js'

export type MarketForecast = { ticker: string; status: 'MODELED' | 'UNRATED'; reason: string;
  probabilityYes?: number; probabilityNo?: number; tieProbability?: number;
  projectedHome?: number; projectedAway?: number; trainingGames?: number; modelVersion?: string;
  modelSource?: string; modelObservedAt?: string }
const aliases: Record<string, string> = { JAX: 'JAC', LA: 'LAR' }
const alias = (team: string) => aliases[team] ?? team
const titlePrefixes: Record<string, string> = { LAC: 'LA', LAR: 'LA', NYG: 'NY', NYJ: 'NY' }
const month = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
export const gameCode = (date: string, away: string, home: string) =>
  date.slice(2, 4) + month[Number(date.slice(5, 7)) - 1] + date.slice(8, 10) + alias(away) + alias(home)

export function forecastMarkets(markets: ScannedMarket[], csv: string, date: string, bookmakerLines: BookmakerLine[] = []): MarketForecast[] {
  const schedule = parseScheduleCsv(csv, date)
  const model = fitScoreModel(parseGamesCsv(csv), date)
  const archived = bookmakerLines.length ? parseArchivedMarketGamesCsv(csv) : []

  const unavailable = (ticker: string, reason: string): MarketForecast => ({ ticker, status: 'UNRATED', reason })
  return markets.map((market) => {
    const { ticker, series, eventTicker, title, rules } = market
    if (market.phase !== 'pregame' || !['KXNFLGAME', 'KXNFLSPREAD', 'KXNFLTOTAL'].includes(series)) return unavailable(ticker, 'Needs a separate period-specific model')
    if (market.gameDate !== date || !ticker.startsWith(`${eventTicker}-`) || !rules.trim()) return unavailable(ticker, 'Exact contract or rules unavailable')
    const matches = schedule.filter((g) => eventTicker === `${series}-${gameCode(date, g.away, g.home)}`)
    if (matches.length !== 1) return unavailable(ticker, 'Game identity ambiguous or missing from schedule')
    const game = matches[0]
    const odds = bookmakerLines.filter((line) => line.home === game.home && line.away === game.away)
    const independent = odds.length === 1 ? forecastFromSportsbook(archived, odds[0], date) : null
    const forecast = independent ?? (model && forecastGame(model, game.home, game.away))
    if (!forecast) return unavailable(ticker, 'Team history insufficient')
    const suffix = ticker.slice(eventTicker.length + 1)
    let wins: (home: number, away: number) => boolean
    if (series === 'KXNFLGAME') {
      const team = [game.home, game.away].find((t) => alias(t) === suffix)
      if (!team || !/\bwins\b/i.test(title) || !/\bwins\b/i.test(rules)) return unavailable(ticker, 'Winner contract mismatch')
      wins = (home, away) => team === game.home ? home > away : away > home
    } else if (series === 'KXNFLSPREAD') {
      const match = /^([A-Z]{2,3})(\d{1,2})$/.exec(suffix)
      const team = [game.home, game.away].find((t) => alias(t) === match?.[1])
      const line = match ? Number(match[2]) - 0.5 : NaN
      if (!team || !Number.isFinite(line) || !title.startsWith(`${titlePrefixes[alias(team)] ?? alias(team)} `) || !title.includes(`wins by over ${line} points?`) || !rules.includes(`${line}`)) return unavailable(ticker, 'Spread side or threshold mismatch')
      wins = (home, away) => (team === game.home ? home - away : away - home) > line
    } else {
      const match = /^(\d{1,3})$/.exec(suffix)
      const line = match ? Number(match[1]) - 0.5 : NaN
      if (!Number.isFinite(line) || title !== `Full Game: over ${line} points scored?` || !rules.includes(`${line}`)) return unavailable(ticker, 'Total threshold mismatch')
      wins = (home, away) => home + away > line
    }
    const yes = forecast.samples.filter(([home, away]) => wins(home, away)).length / forecast.samples.length
    const tie = series === 'KXNFLGAME' ? forecast.samples.filter(([home, away]) => home === away).length / forecast.samples.length : 0
    return { ticker, status: 'MODELED', reason: 'Experimental score baseline; not a validated edge or paper pick',
      probabilityYes: yes, probabilityNo: 1 - yes - tie, tieProbability: tie,
      projectedHome: forecast.projectedHome, projectedAway: forecast.projectedAway,
      trainingGames: forecast.trainingGames, modelVersion: independent ? 'sportsbook-score-v2' : 'pregame-score-v1',
      modelSource: independent ? `${odds[0].provider} via ESPN` : 'nflverse completed scores',
      modelObservedAt: independent ? odds[0].observedAt : undefined }
  })
}
