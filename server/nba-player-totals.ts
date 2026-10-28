import type { NbaGame, NbaTarget } from './nba-model.js'

const ROOT = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event='
const RUNS = 1000
// Predeclared research constants, not fitted/tuned to outcomes.
const RATE_PRIOR_MINUTES = 60
const SHOOTING_PRIOR_ATTEMPTS = 30
const SCORING_BLEND = 0.15
const SCORING_PRIOR_GAMES = 5
const PACE_BLEND = 0.15
const MAX_OT = 6

type Shots = { made: number; attempts: number }
type PlayerContextStats = { rebounds: number; offensiveRebounds: number; defensiveRebounds: number;
  assists: number | null; turnovers: number | null; steals: number | null; blocks: number | null; personalFouls: number | null }
type TeamContextRates = { reboundsPerGame: number; offensiveReboundsPerGame: number; defensiveReboundsPerGame: number;
  assistsPerGame: number | null; turnoversPerGame: number | null; stealsPerGame: number | null; blocksPerGame: number | null;
  personalFoulsPerGame: number | null; paintPointsPerGame: number | null }
type Player = { id: string; name: string; minutes: number; points: number; two: Shots; three: Shots; ft: Shots; plusMinus: number | null; context: PlayerContextStats }
type TeamBox = { id: string; minutes: number; durationMinutes: number; points: number; players: Player[]; two: Shots; three: Shots; ft: Shots; rebounds: number; offensiveRebounds: number; paintPoints: number | null; context: PlayerContextStats }
type GameBox = { teams: Record<string, TeamBox> }
export type PlayerTotalsInput = {
  id: string; name: string; meanMinutes: number; sampleMinutes: number
  twoAttemptsPerMinute: number; threeAttemptsPerMinute: number; ftAttemptsPerMinute: number
  twoPct: number; threePct: number; ftPct: number; paintAttempts: null
  plusMinus?: { samples: { gameId: string; value: number | null }[]; total: number | null; perGame: number | null; observedGames: number; forecastWeight: 0 }
  context?: { samples: ({ gameId: string } & PlayerContextStats)[]; forecastWeight: 0; reason: string }
}
type Rotation = { id: string; minutes: number }[]
export type PlayerTotalsTeamInput = {
  id: string; gameIds: string[]; players: PlayerTotalsInput[]; rotationSamples: Rotation[]
  allowedShooting: { twoPct: number; threePct: number; twoAttempts: number; threeAttempts: number; forecastWeight: number }
  reboundsAllowed: { totalPerGame: number; offensivePerGame: number; forecastWeight: 0 }
  teamPaintPointsPerGame: number | null
  context?: { own: TeamContextRates; opponent: TeamContextRates; forecastWeight: 0; reason: string }
  scoring?: { pointsForPerGame: number; pointsAllowedPerGame: number; pointsForPer48: number; pointsAllowedPer48: number;
    offensivePointsPerPossession: number | null; allowedPointsPerPossession: number | null }
  possessions?: { status: 'estimated' | 'unavailable'; perGame: number | null; per48: number | null; estimatedGames: number;
    samples: { gameId: string; durationMinutes: number; own: number | null; opponent: number | null; paired: number | null; per48: number | null }[]; reason: string }
  drivers?: { mode: 'pace-and-efficiency' | 'scoring-rate-fallback'; expectedPace: number | null; playerBaseline: number;
    expectedRegulationPoints: number; attemptMultiplier: number; scoringBlendWeight: number; paceWeight: number; allowedShootingWeight: 0; reason: string }
}
type Score = { home: number; away: number; overtimePeriods: number }
export type NbaPlayerTotalsResult = {
  version: 'nba-player-totals-shadow-v1' | 'nba-player-totals-shadow-v2' | 'nba-player-totals-v2'; status: 'estimated' | 'unknown'; eligibleForPrimary: boolean
  observedAt: string; asOfCutoff: string | null; simulations: number; seed: string | null
  sources: string[]; assumptions: string[]; unknowns: string[]; reason: string | null; reasons: string[]
  totals: number[]; scores: Score[]; expectedTotal: number | null; totalSd: number | null
  inputs: { home: PlayerTotalsTeamInput; away: PlayerTotalsTeamInput; sharedAttemptSpread: number } | null
}
// Cache raw observations, not parsed games: every caller revalidates its history identity.
// A caller must create this Map once per scan, never retain it between scans.
export type NbaPlayerTotalsCache = Map<string, Promise<unknown>>

const assumptions = [
  'User-approved unvalidated PAPER ONLY experiment; not calibrated, qualified, or eligible for live orders.',
  'Recent rotation-conditional assumption: sample whole historical rotations, normalized to 240 regulation player-minutes; no live lineup inference.',
  'Fixed player shrinkage: 60 player-minutes toward same-team attempt rates, 30 attempts toward same-team shooting.',
  'Predeclared scoring blend: 15% multiplied by n/(n+5), n = minimum team sample count; midpoint of own scoring and opponent points allowed. Allowed-shooting adjustment disabled to avoid double counting.',
  'With complete verified team turnovers: possessions = FGA + 0.44 FTA - OREB + total TO, paired across teams and normalized per 48; move player baseline pace 15% toward matchup midpoint, then weakly blend matchup scoring efficiency.',
  'Shared bounded empirical attempt variation plus stochastic attempt rounding and binomial makes; not a play-by-play possession simulator.',
  'Observed attempts already include second chances; rebounds have 0 added-attempt forecast weight. No offensive-rebound double count.',
  'Historical overtime minutes are normalized to regulation; ties receive up to six 5-minute overtime periods; unresolved ties fail closed.',
  'Six-hour historical tip buffer approximates final availability; current API snapshots are not archived point-in-time observations.',
]
const unknowns = [
  'Individual player paint attempts and paint shooting are unknown; 2PA is NOT paint. Team points in paint are context only.',
  'Current injuries, availability, live starting lineup, trades, and minutes restrictions are unknown.',
  'No demonstrated edge or calibrated uncertainty; small current-season sample, independent makes, no possession/foul/late-game strategy model.',
]
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const fail = (message: string): never => { throw new Error(message) }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('Missing object')
  return value as Record<string, unknown>
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : fail('Missing array') }
function text(value: unknown): string { return typeof value === 'string' && value.length > 0 ? value : fail('Missing string') }
function integer(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN
  return Number.isSafeInteger(n) && n >= 0 ? n : fail('Invalid non-negative integer')
}
function signedPlusMinus(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^[+-]?\d+$/.test(value) ? Number(value) : NaN
  return Number.isSafeInteger(n) ? n : fail('Invalid player plus/minus')
}
function shots(value: unknown): Shots {
  const match = /^(\d+)-(\d+)$/.exec(text(value))
  if (!match) return fail('Malformed makes-attempts')
  const made = integer(match[1]); const attempts = integer(match[2])
  if (made > attempts || attempts > 200) return fail('Invalid makes/attempts')
  return { made, attempts }
}
function minutes(value: unknown): number {
  const match = /^(\d+)(?::([0-5]\d))?$/.exec(text(value))
  return match ? Number(match[1]) + Number(match[2] ?? 0) / 60 : fail('Invalid MIN')
}
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)
function addShots(values: Shots[]): Shots {
  return { made: sum(values.map((v) => v.made)), attempts: sum(values.map((v) => v.attempts)) }
}
function twoFrom(fg: Shots, three: Shots): Shots {
  const two = { made: fg.made - three.made, attempts: fg.attempts - three.attempts }
  if (two.made < 0 || two.attempts < two.made) return fail('FG/3PT containment mismatch')
  return two
}
const points = (two: Shots, three: Shots, ft: Shots) => 2 * two.made + 3 * three.made + ft.made
function parseBox(raw: unknown, game: NbaGame): GameBox {
  const data = record(raw); const header = record(data.header)
  const competitions = array(header.competitions)
  if (header.id !== game.id || competitions.length !== 1 || record(header.season).year !== game.season) return fail('Game identity/season mismatch')
  const competition = record(competitions[0]); const status = record(record(competition.status).type)
  if (competition.id !== game.id || Date.parse(text(competition.date)) !== Date.parse(game.tip) ||
    status.completed !== true || status.state !== 'post') return fail('Game date/final status mismatch')
  const competitors = array(competition.competitors).map(record)
  if (competitors.length !== 2) return fail('Competitors mismatch')
  // ESPN summaries may omit status.period; final linescores identify OT duration.
  const periods = competitors.map((c) => Array.isArray(c.linescores) ? c.linescores.length : null)
  const period = record(competition.status).period ?? periods[0]
  if (!Number.isInteger(period) || Number(period) < 4 || Number(period) > 4 + MAX_OT ||
    periods.some((p) => p !== null && p !== period)) return fail('Unknown/invalid game duration')
  const expectedMinutes = 240 + (Number(period) - 4) * 25
  const boxscore = record(data.boxscore)
  const teamRows = array(boxscore.teams).map(record); const playerRows = array(boxscore.players).map(record)
  if (teamRows.length !== 2 || playerRows.length !== 2) return fail('Team boxscore count mismatch')
  const teams: Record<string, TeamBox> = {}
  for (const [id, side, score] of [[game.home, 'home', game.homeScore], [game.away, 'away', game.awayScore]] as const) {
    const unique = (rows: Record<string, unknown>[]) => {
      const found = rows.filter((row) => record(row.team).id === id)
      return found.length === 1 ? found[0] : fail('Team identity mismatch')
    }
    const competitor = unique(competitors)
    if (competitor.homeAway !== side || integer(competitor.score) !== score) return fail('Final score/home-away mismatch')
    const stats = array(unique(teamRows).statistics).map(record)
    const get = (key: string) => {
      const found = stats.filter((stat) => stat.name === key)
      return found.length === 1 ? found[0].displayValue : fail(`Missing/duplicate team ${key}`)
    }
    const optional = (key: string) => stats.some((s) => s.name === key) ? integer(get(key)) : null
    const fg = shots(get('fieldGoalsMade-fieldGoalsAttempted'))
    const three = shots(get('threePointFieldGoalsMade-threePointFieldGoalsAttempted'))
    const ft = shots(get('freeThrowsMade-freeThrowsAttempted')); const two = twoFrom(fg, three)
    const rebounds = integer(get('totalRebounds')); const offensiveRebounds = integer(get('offensiveRebounds'))
    if (rebounds !== offensiveRebounds + integer(get('defensiveRebounds')) || points(two, three, ft) !== score) return fail('Team points/rebounds mismatch')
    const blocks = array(unique(playerRows).statistics).map(record)
    if (blocks.length !== 1) return fail('Player stat blocks mismatch')
    const block = blocks[0]; const names = array(block.names).map(text)
    for (const key of ['MIN', 'PTS', 'FG', '3PT', 'FT', 'REB', 'OREB', 'DREB']) if (names.filter((n) => n === key).length !== 1) return fail(`Missing/duplicate player ${key}`)
    if (names.filter((n) => n === '+/-').length > 1) return fail('Duplicate player plus/minus')
    for (const key of ['AST', 'TO', 'STL', 'BLK', 'PF']) if (names.filter((n) => n === key).length > 1) return fail(`Duplicate player ${key}`)
    const players: Player[] = []; const seen = new Set<string>()
    const athletes = array(block.athletes)
    if (athletes.length > 30) return fail('Unbounded roster')
    for (const item of athletes) {
      const row = record(item); const athlete = record(row.athlete); const playerId = text(athlete.id)
      if (seen.has(playerId)) return fail('Duplicate player identity')
      seen.add(playerId)
      const values = array(row.stats)
      if (row.didNotPlay === true && values.length === 0) continue
      if (values.length !== names.length || typeof row.didNotPlay !== 'boolean') return fail('Missing player stats/DNP')
      const value = (key: string) => values[names.indexOf(key)]
      const min = minutes(value('MIN')); const pts = integer(value('PTS'))
      const pfg = shots(value('FG')); const pthree = shots(value('3PT')); const pft = shots(value('FT'))
      const ptwo = twoFrom(pfg, pthree)
      const reb = integer(value('REB')); const oreb = integer(value('OREB')); const dreb = integer(value('DREB'))
      if (reb !== oreb + dreb || reb > rebounds) return fail('Player rebounds mismatch')
      if (min > expectedMinutes / 5 || points(ptwo, pthree, pft) !== pts ||
        (min === 0 && pfg.attempts + pft.attempts > 0) ||
        (row.didNotPlay === true && min + pts + pfg.attempts + pft.attempts + reb > 0)) return fail('Player minutes/points/DNP mismatch')
      const pm = signedPlusMinus(value('+/-'))
      if (pm !== null && (Math.abs(pm) > game.homeScore + game.awayScore || (row.didNotPlay && pm !== 0))) return fail('Invalid player plus/minus bound/DNP')
      const optionalStat = (key: string) => {
        const stat = !names.includes(key) || value(key) === null ? null : integer(value(key))
        if (row.didNotPlay === true && stat !== null && stat !== 0) return fail(`Invalid player ${key} DNP`)
        return stat
      }
      const context = { rebounds: reb, offensiveRebounds: oreb, defensiveRebounds: dreb,
        assists: optionalStat('AST'), turnovers: optionalStat('TO'), steals: optionalStat('STL'), blocks: optionalStat('BLK'), personalFouls: optionalStat('PF') }
      players.push({ id: playerId, name: text(athlete.displayName), minutes: min, points: pts, two: ptwo, three: pthree, ft: pft, plusMinus: pm, context })
    }
    const totalMinutes = sum(players.map((p) => p.minutes))
    if (players.length < 5 || Math.abs(totalMinutes - expectedMinutes) > players.length / 2 + 0.5) return fail('Team player-minute reconciliation mismatch')
    for (const key of ['two', 'three', 'ft'] as const) {
      const aggregate = addShots(players.map((p) => p[key])); const official = { two, three, ft }[key]
      if (aggregate.made !== official.made || aggregate.attempts !== official.attempts) return fail(`Player/team ${key} reconciliation mismatch`)
    }
    if (sum(players.map((p) => p.points)) !== score) return fail('Player/team points mismatch')
    const margin = score - (side === 'home' ? game.awayScore : game.homeScore)
    if (players.every((p) => p.plusMinus !== null) && sum(players.map((p) => p.plusMinus!)) !== 5 * margin) return fail('Player/team plus/minus reconciliation mismatch')
    const paintPoints = optional('pointsInPaint')
    if (paintPoints !== null && (paintPoints > 2 * two.made || paintPoints % 2)) return fail('Invalid team paint context')
    const totalTurnovers = optional('totalTurnovers'); const turnovers = optional('turnovers'); const teamTurnovers = optional('teamTurnovers')
    // ESPN distinguishes player-credited TO, uncredited team TO, and their possession total.
    if (totalTurnovers !== null && ((turnovers !== null && totalTurnovers < turnovers) ||
      (teamTurnovers !== null && totalTurnovers < teamTurnovers) ||
      (turnovers !== null && teamTurnovers !== null && totalTurnovers !== turnovers + teamTurnovers))) return fail('Inconsistent team turnover components')
    const possessionTurnovers = totalTurnovers ?? (turnovers !== null && teamTurnovers !== null ? turnovers + teamTurnovers : null)
    const creditedTurnovers = turnovers ?? (totalTurnovers !== null && teamTurnovers !== null ? totalTurnovers - teamTurnovers : null)
    if (creditedTurnovers !== null && players.every((p) => p.context.turnovers !== null) &&
      sum(players.map((p) => p.context.turnovers!)) !== creditedTurnovers) return fail('Player/credited turnover reconciliation mismatch')
    const context = { rebounds, offensiveRebounds, defensiveRebounds: rebounds - offensiveRebounds,
      assists: optional('assists'), turnovers: possessionTurnovers, steals: optional('steals'), blocks: optional('blocks'), personalFouls: optional('fouls') }
    for (const key of ['rebounds', 'offensiveRebounds', 'defensiveRebounds', 'assists', 'turnovers', 'steals', 'blocks', 'personalFouls'] as const) {
      const official = context[key]; const values = players.map((p) => p.context[key])
      if (official === null || values.some((v) => v === null)) continue
      const aggregate = sum(values as number[])
      // Team rebounds and team turnovers may include events not credited to a player.
      const allowsTeamEvents = ['rebounds', 'offensiveRebounds', 'defensiveRebounds', 'turnovers'].includes(key)
      if (allowsTeamEvents ? aggregate > official : aggregate !== official) return fail(`Player/team ${key} context reconciliation mismatch`)
    }
    teams[id] = { id, minutes: totalMinutes, durationMinutes: expectedMinutes / 5, points: score, players, two, three, ft, rebounds, offensiveRebounds, paintPoints, context }
  }
  return { teams }
}
function profile(id: string, games: NbaGame[], boxes: Map<string, GameBox>): PlayerTotalsTeamInput {
  const own = games.map((g) => boxes.get(g.id)!.teams[id])
  const opponents = games.map((g) => boxes.get(g.id)!.teams[g.home === id ? g.away : g.home])
  const totalMinutes = sum(own.map((t) => t.minutes))
  const teamShots = { two: addShots(own.map((t) => t.two)), three: addShots(own.map((t) => t.three)), ft: addShots(own.map((t) => t.ft)) }
  // No external league prior invented when a category has no observed attempts.
  const pct = (s: Shots) => s.attempts ? s.made / s.attempts : fail('No shooting attempts for required rate')
  const rotations = own.map((t) => t.players.filter((p) => p.minutes > 0).map((p) => ({ id: p.id, minutes: p.minutes * 240 / t.minutes })))
  const ids = [...new Set(own.flatMap((t) => t.players.filter((p) => p.minutes > 0).map((p) => p.id)))].sort()
  const players = ids.map((playerId): PlayerTotalsInput => {
    const rows = own.flatMap((t) => t.players.filter((p) => p.id === playerId))
    const sampleMinutes = sum(rows.map((p) => p.minutes))
    const rate = (key: 'two' | 'three' | 'ft') => (addShots(rows.map((p) => p[key])).attempts + RATE_PRIOR_MINUTES * teamShots[key].attempts / totalMinutes) / (sampleMinutes + RATE_PRIOR_MINUTES)
    const shooting = (key: 'two' | 'three' | 'ft') => {
      const s = addShots(rows.map((p) => p[key]))
      return (s.made + SHOOTING_PRIOR_ATTEMPTS * pct(teamShots[key])) / (s.attempts + SHOOTING_PRIOR_ATTEMPTS)
    }
    const pmSamples = games.map((g, i) => ({ gameId: g.id, value: own[i].players.find((p) => p.id === playerId)?.plusMinus ?? null }))
    const pmValues = pmSamples.flatMap((s) => s.value === null ? [] : [s.value])
    return { id: playerId, name: rows[0].name, sampleMinutes,
      meanMinutes: sum(rotations.flatMap((r) => r.filter((p) => p.id === playerId).map((p) => p.minutes))) / games.length,
      twoAttemptsPerMinute: rate('two'), threeAttemptsPerMinute: rate('three'), ftAttemptsPerMinute: rate('ft'),
      twoPct: shooting('two'), threePct: shooting('three'), ftPct: shooting('ft'), paintAttempts: null,
      plusMinus: { samples: pmSamples, total: pmValues.length ? sum(pmValues) : null,
        perGame: pmValues.length ? sum(pmValues) / pmValues.length : null, observedGames: pmValues.length, forecastWeight: 0 },
      context: { samples: games.flatMap((g, i) => own[i].players.filter((p) => p.id === playerId).map((p) => ({ gameId: g.id, ...p.context }))),
        forecastWeight: 0, reason: 'Descriptive boxscore counts only; no validated independent player effect. Rebounds add no second-chance attempts.' } }
  })
  const completeMean = (values: (number | null)[]) => values.every((n) => n !== null) ? sum(values as number[]) / values.length : null
  const contextRates = (rows: TeamBox[]): TeamContextRates => ({
    reboundsPerGame: sum(rows.map((t) => t.rebounds)) / rows.length,
    offensiveReboundsPerGame: sum(rows.map((t) => t.offensiveRebounds)) / rows.length,
    defensiveReboundsPerGame: sum(rows.map((t) => t.context.defensiveRebounds)) / rows.length,
    assistsPerGame: completeMean(rows.map((t) => t.context.assists)), turnoversPerGame: completeMean(rows.map((t) => t.context.turnovers)),
    stealsPerGame: completeMean(rows.map((t) => t.context.steals)), blocksPerGame: completeMean(rows.map((t) => t.context.blocks)),
    personalFoulsPerGame: completeMean(rows.map((t) => t.context.personalFouls)), paintPointsPerGame: completeMean(rows.map((t) => t.paintPoints)),
  })
  const allowed = (key: 'two' | 'three') => pct(addShots(opponents.map((t) => t[key])))
  const teamPossessions = (t: TeamBox): number | null => {
    if (t.context.turnovers === null) return null
    const value = t.two.attempts + t.three.attempts + 0.44 * t.ft.attempts - t.offensiveRebounds + t.context.turnovers
    return value > 0 && Number.isFinite(value) ? value : fail('Invalid team possession estimate')
  }
  const possessionSamples = games.map((g, i) => {
    const ownPossessions = teamPossessions(own[i]); const opponent = teamPossessions(opponents[i])
    const paired = ownPossessions === null || opponent === null ? null : (ownPossessions + opponent) / 2
    return { gameId: g.id, durationMinutes: own[i].durationMinutes, own: ownPossessions, opponent, paired,
      per48: paired === null ? null : paired * 48 / own[i].durationMinutes }
  })
  const estimatedGames = possessionSamples.filter((s) => s.paired !== null).length
  const completePossessions = estimatedGames === games.length
  const totalPossessions = completePossessions ? sum(possessionSamples.map((s) => s.paired!)) : null
  const durationMinutes = sum(own.map((t) => t.durationMinutes))
  return { id, gameIds: games.map((g) => g.id), players, rotationSamples: rotations,
    allowedShooting: { twoPct: allowed('two'), threePct: allowed('three'),
      twoAttempts: addShots(opponents.map((t) => t.two)).attempts,
      threeAttempts: addShots(opponents.map((t) => t.three)).attempts, forecastWeight: 0 },
    scoring: { pointsForPerGame: sum(own.map((t) => t.points)) / games.length,
      pointsAllowedPerGame: sum(opponents.map((t) => t.points)) / games.length,
      pointsForPer48: 48 * sum(own.map((t) => t.points)) / sum(own.map((t) => t.durationMinutes)),
      pointsAllowedPer48: 48 * sum(opponents.map((t) => t.points)) / sum(own.map((t) => t.durationMinutes)),
      offensivePointsPerPossession: totalPossessions === null ? null : sum(own.map((t) => t.points)) / totalPossessions,
      allowedPointsPerPossession: totalPossessions === null ? null : sum(opponents.map((t) => t.points)) / totalPossessions },
    possessions: { status: completePossessions ? 'estimated' : 'unavailable',
      perGame: totalPossessions === null ? null : totalPossessions / games.length,
      per48: totalPossessions === null ? null : totalPossessions * 48 / durationMinutes,
      estimatedGames, samples: possessionSamples,
      reason: completePossessions ? 'Paired boxscore estimate, not tracked possessions; 0.44 FTA coefficient is fixed, with overtime normalized to 48 minutes.' : 'Verified team turnovers are required on both sides of every sample game; no possessions are invented.' },
    reboundsAllowed: { totalPerGame: sum(opponents.map((t) => t.rebounds)) / games.length,
      offensivePerGame: sum(opponents.map((t) => t.offensiveRebounds)) / games.length, forecastWeight: 0 },
    teamPaintPointsPerGame: own.every((t) => t.paintPoints !== null) ? sum(own.map((t) => t.paintPoints!)) / games.length : null,
    context: { own: contextRates(own), opponent: contextRates(opponents), forecastWeight: 0,
      reason: 'No separate assists/turnovers/rebounds/paint adjustment: shooting already reflects these events. Team TO and OREB enter possession estimation only when verified; no extra second chances.' } }
}
function scoringDrivers(team: PlayerTotalsTeamInput, opponent: PlayerTotalsTeamInput): NonNullable<PlayerTotalsTeamInput['drivers']> {
  const playerBaseline = sum(team.players.map((p) => p.meanMinutes * (2 * p.twoAttemptsPerMinute * p.twoPct + 3 * p.threeAttemptsPerMinute * p.threePct + p.ftAttemptsPerMinute * p.ftPct)))
  if (!(playerBaseline > 0)) return fail('No positive player scoring baseline')
  const n = Math.min(team.gameIds.length, opponent.gameIds.length)
  const scoringBlendWeight = SCORING_BLEND * n / (n + SCORING_PRIOR_GAMES)
  if (team.possessions?.status === 'estimated' && opponent.possessions?.status === 'estimated') {
    const ownPace = team.possessions.per48!; const expectedPace = (ownPace + opponent.possessions.per48!) / 2
    const baselineAtPace = playerBaseline * ((1 - PACE_BLEND) + PACE_BLEND * expectedPace / ownPace)
    const efficiency = (team.scoring!.offensivePointsPerPossession! + opponent.scoring!.allowedPointsPerPossession!) / 2
    const expectedRegulationPoints = (1 - scoringBlendWeight) * baselineAtPace + scoringBlendWeight * expectedPace * efficiency
    return { mode: 'pace-and-efficiency', expectedPace, playerBaseline, expectedRegulationPoints,
      attemptMultiplier: expectedRegulationPoints / playerBaseline, scoringBlendWeight, paceWeight: PACE_BLEND, allowedShootingWeight: 0,
      reason: '15% move from own pace toward the matchup pace midpoint, then sample-shrunk scoring blend toward midpoint of own offensive and opponent allowed efficiency. No additional allowed-shooting or rebound adjustment.' }
  }
  const matchupRate = (team.scoring!.pointsForPer48 + opponent.scoring!.pointsAllowedPer48) / 2
  const expectedRegulationPoints = (1 - scoringBlendWeight) * playerBaseline + scoringBlendWeight * matchupRate
  return { mode: 'scoring-rate-fallback', expectedPace: null, playerBaseline, expectedRegulationPoints,
    attemptMultiplier: expectedRegulationPoints / playerBaseline, scoringBlendWeight, paceWeight: 0, allowedShootingWeight: 0,
    reason: 'Pace unavailable without complete verified team turnovers on both sides. Weak normalized scoring-rate blend only; allowed shooting has zero separate weight.' }
}
function fingerprint(value: unknown): string {
  const source = JSON.stringify(value); let hash = 2166136261
  for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619)
  return (hash >>> 0).toString(16).padStart(8, '0')
}
function simulate(inputs: NonNullable<NbaPlayerTotalsResult['inputs']>, seed: string): Score[] {
  let state = parseInt(seed, 16)
  const random = () => { state = (state + 0x6D2B79F5) | 0; let t = Math.imul(state ^ state >>> 15, 1 | state); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296 }
  const binomial = (n: number, p: number) => { let made = 0; for (let i = 0; i < n; i++) if (random() < p) made++; return made }
  const score = (team: PlayerTotalsTeamInput, rotation: Rotation, pace: number, fraction: number) => sum(rotation.map((r) => {
    const player = team.players.find((p) => p.id === r.id)!
    const category = (key: 'two' | 'three' | 'ft') => {
      const lambda = player[`${key}AttemptsPerMinute`] * r.minutes * pace * fraction * team.drivers!.attemptMultiplier
      const n = Math.floor(lambda) + (random() < lambda % 1 ? 1 : 0)
      return binomial(n, player[`${key}Pct`])
    }
    return 2 * category('two') + 3 * category('three') + category('ft')
  }))
  return Array.from({ length: RUNS }, () => {
    const homeRotation = inputs.home.rotationSamples[Math.floor(random() * inputs.home.rotationSamples.length)]
    const awayRotation = inputs.away.rotationSamples[Math.floor(random() * inputs.away.rotationSamples.length)]
    const pace = 1 + (random() - random()) * inputs.sharedAttemptSpread
    let home = score(inputs.home, homeRotation, pace, 1)
    let away = score(inputs.away, awayRotation, pace, 1)
    let overtimePeriods = 0
    while (home === away && overtimePeriods < MAX_OT) {
      home += score(inputs.home, homeRotation, pace, 5 / 48)
      away += score(inputs.away, awayRotation, pace, 5 / 48)
      overtimePeriods++
    }
    if (home === away) return fail('Unresolved tie after bounded overtime')
    return { home, away, overtimePeriods }
  })
}

async function readSource(url: string, fetcher: typeof fetch): Promise<unknown> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('Boxscore source timeout')) }, 8000)
  })
  try {
    return await Promise.race([deadline, (async () => {
      const response = await fetcher(url, { signal: controller.signal })
      if (!response.ok) return fail('Boxscore source HTTP failure')
      return response.json() as Promise<unknown>
    })()])
  } finally { clearTimeout(timer) }
}

export async function collectNbaPlayerTotals(target: NbaTarget, history: NbaGame[], observedAt: string,
  fetcher: typeof fetch = fetch, cache: NbaPlayerTotalsCache = new Map()): Promise<NbaPlayerTotalsResult> {
  const observed = Date.parse(observedAt); const tip = Date.parse(target.tip)
  const valid = Number.isFinite(observed) && Number.isFinite(tip) && observed < tip && target.home !== target.away
  const cutoff = valid ? Math.min(observed, tip) - 6 * 3600000 : NaN
  const base: NbaPlayerTotalsResult = { version: 'nba-player-totals-v2', status: 'unknown', eligibleForPrimary: false,
    observedAt, asOfCutoff: valid ? new Date(cutoff).toISOString() : null, simulations: 0, seed: null,
    sources: [], assumptions: [...assumptions], unknowns: [...unknowns], reason: null, reasons: [],
    totals: [], scores: [], expectedTotal: null, totalSd: null, inputs: null }
  const unknown = (reason: string) => ({ ...base, reason, reasons: [reason] })
  if (!valid) return unknown('Invalid pregame target/observation')
  const season = new Date(tip).getUTCFullYear() + (new Date(tip).getUTCMonth() >= 7 ? 1 : 0)
  const unique = new Map<string, NbaGame>()
  for (const game of history.filter((g) => g.season === season && Date.parse(g.tip) < cutoff &&
    [g.home, g.away].some((id) => id === target.home || id === target.away))) {
    const previous = unique.get(game.id)
    if (previous && [previous.tip, previous.home, previous.away, previous.homeScore, previous.awayScore].join('|') !==
      [game.tip, game.home, game.away, game.homeScore, game.awayScore].join('|')) return unknown('Conflicting history game identity')
    unique.set(game.id, game)
  }
  const selected = (id: string) => [...unique.values()].filter((g) => g.home === id || g.away === id)
    .sort((a, b) => Date.parse(b.tip) - Date.parse(a.tip) || a.id.localeCompare(b.id)).slice(0, 5)
  const homeGames = selected(target.home); const awayGames = selected(target.away)
  if (homeGames.length < 2 || awayGames.length < 2) return unknown('Need at least two finalized current-season games per team')
  const all = [...new Map([...homeGames, ...awayGames].map((g) => [g.id, g])).values()]
  base.sources = all.map((g) => ROOT + encodeURIComponent(g.id))
  try {
    const boxes = new Map<string, GameBox>()
    let next = 0; let failed = false
    const worker = async () => {
      while (!failed && next < all.length) {
        const game = all[next++]; const url = ROOT + encodeURIComponent(game.id)
        const key = `${observedAt}|${url}`
        try {
          if (!cache.has(key)) cache.set(key, readSource(url, fetcher))
          boxes.set(game.id, parseBox(await cache.get(key), game))
        } catch (error) { failed = true; throw error }
      }
    }
    const workers = await Promise.allSettled([worker(), worker()])
    for (const result of workers) if (result.status === 'rejected') throw result.reason
    const home = profile(target.home, homeGames, boxes); const away = profile(target.away, awayGames, boxes)
    home.drivers = scoringDrivers(home, away); away.drivers = scoringDrivers(away, home)
    const attempts = [homeGames.map((g) => boxes.get(g.id)!.teams[target.home]), awayGames.map((g) => boxes.get(g.id)!.teams[target.away])]
      .flatMap((rows) => rows.map((t) => (t.two.attempts + t.three.attempts) * 240 / t.minutes))
    const avg = sum(attempts) / attempts.length
    const cv = Math.sqrt(sum(attempts.map((n) => (n - avg) ** 2)) / attempts.length) / avg
    const inputs = { home, away, sharedAttemptSpread: clamp(cv * Math.sqrt(6), 0.04, 0.18) }
    const forecastInput = ({ players, rotationSamples, scoring, drivers }: PlayerTotalsTeamInput) => ({
      players: players.map(({ id, meanMinutes, sampleMinutes, twoAttemptsPerMinute, threeAttemptsPerMinute, ftAttemptsPerMinute, twoPct, threePct, ftPct }) =>
        ({ id, meanMinutes, sampleMinutes, twoAttemptsPerMinute, threeAttemptsPerMinute, ftAttemptsPerMinute, twoPct, threePct, ftPct })),
      rotationSamples, scoring, drivers })
    const seed = fingerprint({ version: base.version, target: { home: target.home, away: target.away, tip: target.tip, neutral: target.neutral },
      home: forecastInput(inputs.home), away: forecastInput(inputs.away), sharedAttemptSpread: inputs.sharedAttemptSpread })
    const scores = simulate(inputs, seed); const totals = scores.map((s) => s.home + s.away)
    const expectedTotal = sum(totals) / RUNS
    return { ...base, status: 'estimated', eligibleForPrimary: true, simulations: RUNS, seed, inputs, scores, totals, expectedTotal,
      totalSd: Math.sqrt(sum(totals.map((n) => (n - expectedTotal) ** 2)) / RUNS) }
  } catch (error) { return unknown(error instanceof Error ? error.message : 'Boxscore source unavailable') }
}

export function playerTotalChance(result: NbaPlayerTotalsResult, kind: 'over' | 'under', line: number): number | null {
  if (result.status !== 'estimated' || result.simulations !== RUNS || result.totals.length !== RUNS ||
    !Number.isFinite(line) || line <= 0 || line % 1 !== 0.5 || !['over', 'under'].includes(kind) ||
    result.totals.some((n) => !Number.isSafeInteger(n) || n < 0)) return null
  const over = result.totals.filter((n) => n > line).length / RUNS
  return kind === 'over' ? over : 1 - over
}
