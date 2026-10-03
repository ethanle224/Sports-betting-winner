import { expect, it } from 'vitest'
import { fitScoreModel, parseGamesCsv } from './nfl-model'
import { forecastMarkets } from './nfl-forecast'
import type { ScannedMarket } from './nfl-core'

const csv = 'game_type,gameday,home_team,away_team,home_score,away_score\n' +
  Array.from({ length: 32 }, (_, i) => `REG,2025-${String(1 + Math.floor(i / 4)).padStart(2, '0')}-${String(1 + (i % 4) * 6).padStart(2, '0')},CIN,JAX,${20 + i % 8},${17 + i % 6}`).join('\n') +
  '\nREG,2026-10-04,CIN,JAX,,\n'
const m = (series: string, suffix: string, title: string, rules = title): ScannedMarket => ({
  series, phase: 'pregame', kind: 'Game', gameDate: '2026-10-04', eventTicker: `${series}-26OCT04JACCIN`,
  ticker: `${series}-26OCT04JACCIN-${suffix}`, title, rules, indicativeAsk: 0.45, indicativeSize: 10,
})

it('scores distinct alternate total and spread lines with matching teams and rules', () => {
  const markets = [m('KXNFLTOTAL', '43', 'Full Game: over 42.5 points scored?'),
    m('KXNFLTOTAL', '49', 'Full Game: over 48.5 points scored?'),
    m('KXNFLSPREAD', 'JAC4', 'JAC Jaguars wins by over 3.5 points?'),
    m('KXNFLGAME', 'JAC', 'Jacksonville wins', 'If Jacksonville wins, market resolves to Yes. Tie resolves to $0.50.')]
  const result = forecastMarkets(markets, csv, '2026-10-04')
  expect(result.map((r) => r.status)).toEqual(['MODELED', 'MODELED', 'MODELED', 'MODELED'])
  expect(result[0].probabilityYes!).toBeGreaterThanOrEqual(result[1].probabilityYes!)
  expect(result[2].probabilityYes).toBeGreaterThanOrEqual(0)
  expect(result[3].tieProbability).toBeGreaterThanOrEqual(0)
  expect(result[0].modelVersion).toBe('pregame-score-v1')
})

it('abstains on mismatched thresholds, periods, ambiguous events and unknown team histories', () => {
  const markets = [m('KXNFLTOTAL', '43', 'Full Game: over 48.5 points scored?'),
    { ...m('KXNFLSPREAD', 'JAC4', 'JAC Jaguars wins by over 3.5 points?'), phase: 'halftime' },
    { ...m('KXNFLTOTAL', '43', 'Full Game: over 42.5 points scored?'), eventTicker: 'KXNFLTOTAL-26OCT04UNKNOWN' },
    m('KXNFLSPREAD', 'JAC4', 'JAC Jaguars wins by over 3.5 points?', '')]
  expect(forecastMarkets(markets, csv, '2026-10-04').map((r) => r.status)).toEqual(['UNRATED', 'UNRATED', 'UNRATED', 'UNRATED'])
  expect(fitScoreModel(parseGamesCsv(csv), '2026-10-04')).not.toBeNull()
})

it('recognizes displayed LA and NY prefixes without changing the team token', () => {
  const laCsv = csv.replaceAll('CIN', 'SEA').replaceAll('JAX', 'LAC')
  const market = { ...m('KXNFLSPREAD', 'JAC4', 'JAC Jaguars wins by over 3.5 points?'),
    eventTicker: 'KXNFLSPREAD-26OCT04LACSEA', ticker: 'KXNFLSPREAD-26OCT04LACSEA-LAC4',
    title: 'LA Chargers wins by over 3.5 points?', rules: 'LA Chargers wins by more than 3.5 points' }
  expect(forecastMarkets([market], laCsv, '2026-10-04')[0].status).toBe('MODELED')
})

it('uses a distinct independent sportsbook score distribution when matching pregame odds exist', () => {
  const market = m('KXNFLTOTAL', '49', 'Full Game: over 48.5 points scored?')
  const marketCsv = csv.replace('game_type,gameday,home_team,away_team,home_score,away_score',
    'game_type,gameday,home_team,away_team,home_score,away_score,spread_line,total_line')
    .replaceAll(/,(\d+),(\d+)\n/g, ',$1,$2,3.5,45.5\n')
  const lines = [{ home: 'CIN', away: 'JAX', homeSpread: -5.5, total: 51.5, provider: 'Draft Kings', eventId: '401', kickoff: '2026-10-04T17:00:00Z', observedAt: '2026-10-02T12:00:00Z' }]
  const result = forecastMarkets([market], marketCsv, '2026-10-04', lines)[0]
  expect(result).toMatchObject({ status: 'MODELED', modelVersion: 'sportsbook-score-v2', modelSource: 'Draft Kings via ESPN' })
  expect(result.probabilityYes).not.toEqual(forecastMarkets([market], csv, '2026-10-04')[0].probabilityYes)
})
