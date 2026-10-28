import { describe, expect, it, vi } from 'vitest'
import { collectNbaPlayerTotals, playerTotalChance } from '../../server/nba-player-totals'
import type { NbaGame, NbaTarget } from '../../server/nba-model'

const target: NbaTarget = { home: 'H', away: 'A', tip: '2026-10-28T23:00:00Z', neutral: false }
const observedAt = '2026-10-28T12:00:00Z'

const history: NbaGame[] = ['1', '2'].map((id, i) => ({ ...target, id, season: 2027,
  tip: `2026-10-${22 + i}T23:00:00Z`, homeScore: 120, awayScore: 102 }))
const names = ['MIN', 'PTS', 'FG', '3PT', 'FT', 'REB', 'AST', 'TO', 'STL', 'BLK', 'OREB', 'DREB', 'PF', '+/-']
const plusMinus = (margin: number, index: number) => {
  const total = 5 * margin; const base = Math.trunc(total / 6)
  return String(base + (index < Math.abs(total - base * 6) ? Math.sign(total) : 0))
}
function box(game: NbaGame) {
  const teams = [game.home, game.away]
  return { header: { id: game.id, season: { year: game.season }, competitions: [{ id: game.id, date: game.tip,
    status: { period: 4, type: { completed: true, state: 'post' } },
    competitors: teams.map((id, i) => ({ team: { id }, homeAway: i ? 'away' : 'home', score: String(i ? game.awayScore : game.homeScore) })) }] },
  boxscore: { players: teams.map((id, i) => ({ team: { id }, statistics: [{ names: [...names],
    athletes: Array.from({ length: 6 }, (_, n) => ({ athlete: { id: `${id}-${n}`, displayName: `${id} player ${n}` },
      didNotPlay: false, stats: ['40', i ? '17' : '20', i ? '7-16' : '8-16', i ? '1-6' : '2-6', '2-3', '6', '0', '0', '0', '0', '1', '5', '0', plusMinus((i ? -1 : 1) * (game.homeScore - game.awayScore), n)] })), totals: [] }] })),
  teams: teams.map((id, i) => ({ team: { id }, statistics: [
    { name: 'fieldGoalsMade-fieldGoalsAttempted', displayValue: i ? '42-96' : '48-96' },
    { name: 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', displayValue: i ? '6-36' : '12-36' },
    { name: 'freeThrowsMade-freeThrowsAttempted', displayValue: '12-18' },
    { name: 'totalRebounds', displayValue: '36' }, { name: 'offensiveRebounds', displayValue: '6' },
    { name: 'defensiveRebounds', displayValue: '30' }, { name: 'pointsInPaint', displayValue: '40' },
  ] })) } }
}
const fixtureFetcher = (games = history, edit?: (data: ReturnType<typeof box>) => void) => vi.fn(async (url: string | URL | Request) => {
  const game = games.find((g) => g.id === String(url).split('event=')[1])!
  const data = box(game); edit?.(data)
  return { ok: true, json: async () => data }
}) as unknown as typeof fetch

describe('NBA player totals SHADOW', () => {
  it.each([['AST', 'assists'], ['TO', 'turnovers'], ['STL', 'steals'], ['BLK', 'blocks'], ['PF', 'fouls']])(
    'rejects nonzero DNP %s even when the official team %s reconciles', async (key, official) => {
      const result = await collectNbaPlayerTotals(target, history, observedAt, fixtureFetcher(history, (data) => {
        const block = data.boxscore.players[0].statistics[0]
        const stats = block.names.map((name) => ['FG', '3PT', 'FT'].includes(name) ? '0-0' : name === key ? '1' : '0')
        block.athletes.push({ athlete: { id: 'H-dnp', displayName: 'DNP player' }, didNotPlay: true, stats })
        // All six active players have zero in this category; match the DNP's one exactly.
        data.boxscore.teams[0].statistics.push({ name: official, displayValue: '1' })
      }))
      expect(result.status).toBe('unknown')
      expect(result.reason).toBe(`Invalid player ${key} DNP`)
      expect(result.simulations).toBe(0)
    })
  it.each(['absent', 'null', 'zero'] as const)('accepts DNP optional counting stats that are %s', async (mode) => {
    const result = await collectNbaPlayerTotals(target, history, observedAt, fixtureFetcher(history, (data) => {
      const block = data.boxscore.players[0].statistics[0]
      const optional = ['AST', 'TO', 'STL', 'BLK', 'PF']
      const stats = block.names.map((name) => ['FG', '3PT', 'FT'].includes(name) ? '0-0' : '0')
      if (mode === 'null') for (const key of optional) stats[block.names.indexOf(key)] = null as unknown as string
      block.athletes.push({ athlete: { id: 'H-dnp', displayName: 'DNP player' }, didNotPlay: true, stats })
      if (mode === 'absent') for (const key of optional) {
        const index = block.names.indexOf(key)
        block.names.splice(index, 1)
        for (const row of block.athletes) row.stats.splice(index, 1)
      }
      for (const name of ['assists', 'turnovers', 'steals', 'blocks', 'fouls'])
        data.boxscore.teams[0].statistics.push({ name, displayValue: '0' })
    }))
    expect(result.status).toBe('estimated')
    expect(result.simulations).toBe(1000)
  })

  it('distinguishes credited player turnovers from team turnovers and possession total turnovers', async () => {
    const components = await collectNbaPlayerTotals(target, history, observedAt, fixtureFetcher(history, (data) => {
      for (const team of data.boxscore.teams) team.statistics.push(
        { name: 'turnovers', displayValue: '0' }, { name: 'teamTurnovers', displayValue: '2' }, { name: 'totalTurnovers', displayValue: '2' },
      )
    }))
    expect(components.status).toBe('estimated')
    expect(components.inputs?.home.context?.own.turnoversPerGame).toBe(2)
    expect(components.inputs?.home.possessions?.samples[0].own).toBeCloseTo(96 + 0.44 * 18 - 6 + 2)
    const derived = await collectNbaPlayerTotals(target, history, observedAt, fixtureFetcher(history, (data) => {
      for (const team of data.boxscore.teams) team.statistics.push({ name: 'turnovers', displayValue: '0' }, { name: 'teamTurnovers', displayValue: '2' })
    }))
    expect(derived.status).toBe('estimated')
    expect(derived.seed).toBe(components.seed)
    const incomplete = await collectNbaPlayerTotals(target, history, observedAt, fixtureFetcher(history, (data) => {
      for (const team of data.boxscore.teams) team.statistics.push({ name: 'turnovers', displayValue: '0' })
    }))
    expect(incomplete.status).toBe('estimated')
    expect(incomplete.inputs?.home.possessions).toMatchObject({ status: 'unavailable', per48: null })
    expect(incomplete.inputs?.home.drivers?.mode).toBe('scoring-rate-fallback')
    const zero = await collectNbaPlayerTotals(target, history, observedAt, fixtureFetcher(history, (data) => {
      for (const team of data.boxscore.teams) team.statistics.push({ name: 'totalTurnovers', displayValue: '0' })
    }))
    expect(zero.status).toBe('estimated')
    expect(zero.inputs?.home.context?.own.turnoversPerGame).toBe(0)
    expect(zero.inputs?.home.possessions?.status).toBe('estimated')
    for (const mode of ['inconsistent-total', 'malformed-team-component', 'credited-player-mismatch']) {
      const bad = await collectNbaPlayerTotals(target, history, observedAt, fixtureFetcher(history, (data) => {
        data.boxscore.teams[0].statistics.push({ name: 'turnovers', displayValue: mode === 'credited-player-mismatch' ? '1' : '0' },
          { name: 'teamTurnovers', displayValue: mode === 'malformed-team-component' ? 'x' : '2' },
          { name: 'totalTurnovers', displayValue: mode === 'inconsistent-total' ? '3' : mode === 'credited-player-mismatch' ? '3' : '2' })
      }))
      expect(bad.status, mode).toBe('unknown')
    }
  })
  it('uses verified paired possession estimates for opponent-aware pace and allowed efficiency', async () => {
    const games = [...history.map((g) => ({ ...g, away: 'X' })), ...history.map((g) => ({ ...g, id: `A-${g.id}`, home: 'Y', away: 'A' }))]
    const withTurnovers = (fast: boolean) => fixtureFetcher(games, (data) => {
      for (const row of data.boxscore.teams) row.statistics.push({ name: 'totalTurnovers', displayValue: fast && row.team.id === 'A' ? '24' : '8' })
    })
    const baseline = await collectNbaPlayerTotals(target, games, observedAt, withTurnovers(false))
    const faster = await collectNbaPlayerTotals(target, games, observedAt, withTurnovers(true))
    const homePossessions = 96 + 0.44 * 18 - 6 + 8
    const awayPossessions = homePossessions + (24 - 8) / 2
    expect(faster.status).toBe('estimated')
    expect(faster.inputs?.home.possessions).toMatchObject({ status: 'estimated', estimatedGames: 2, perGame: homePossessions, per48: homePossessions })
    expect(faster.inputs?.away.possessions?.per48).toBeCloseTo(awayPossessions)
    expect(faster.inputs?.away.possessions?.samples[0]).toMatchObject({ own: 96 + 0.44 * 18 - 6 + 24, opponent: homePossessions, paired: awayPossessions, durationMinutes: 48 })
    expect(faster.inputs?.away.scoring?.allowedPointsPerPossession).toBeCloseTo(120 / awayPossessions)
    expect(faster.inputs?.home.drivers?.expectedPace).toBeCloseTo((homePossessions + awayPossessions) / 2)
    expect(faster.inputs?.home.drivers).toMatchObject({ mode: 'pace-and-efficiency', paceWeight: 0.15, allowedShootingWeight: 0 })
    expect(faster.inputs?.home.drivers?.scoringBlendWeight).toBeCloseTo(0.15 * 2 / (2 + 5))
    expect(faster.inputs!.home.drivers!.expectedRegulationPoints).toBeGreaterThan(baseline.inputs!.home.drivers!.expectedRegulationPoints)
    expect(faster.seed).not.toBe(baseline.seed)
    expect(faster.scores).not.toEqual(baseline.scores)
  })
  it('blends reconciled opponent points allowed into the forecast even when allowed shooting percentages do not change', async () => {
    const games = [
      ...history.map((g) => ({ ...g, away: 'X' })),
      ...history.map((g) => ({ ...g, id: `A-${g.id}`, home: 'Y', away: 'A' })),
    ]
    const baseline = await collectNbaPlayerTotals(target, games, observedAt, fixtureFetcher(games))
    const higherAllowed = games.map((g) => g.home === 'Y' ? { ...g, homeScore: 132 } : g)
    const changed = await collectNbaPlayerTotals(target, higherAllowed, observedAt, fixtureFetcher(higherAllowed, (data) => {
      if (data.boxscore.players[0].team.id !== 'Y') return
      for (const row of data.boxscore.players[0].statistics[0].athletes) { row.stats[1] = '22'; row.stats[4] = '4-6' }
      data.boxscore.teams[0].statistics.find((s) => s.name === 'freeThrowsMade-freeThrowsAttempted')!.displayValue = '24-36'
    }))
    expect(changed.status).toBe('estimated')
    expect(baseline.version).toBe('nba-player-totals-v2')
    expect(baseline.inputs?.home.scoring).toMatchObject({ pointsForPerGame: 120, pointsAllowedPerGame: 102, pointsForPer48: 120, pointsAllowedPer48: 102 })
    expect(changed.inputs?.away.scoring?.pointsAllowedPerGame).toBe(132)
    expect(changed.inputs?.away.allowedShooting).toEqual(baseline.inputs?.away.allowedShooting)
    expect(changed.inputs?.home.drivers?.expectedRegulationPoints).toBeGreaterThan(baseline.inputs!.home.drivers!.expectedRegulationPoints)
    expect(changed.scores.reduce((sum, s) => sum + s.home, 0) / 1000).toBeGreaterThan(baseline.scores.reduce((sum, s) => sum + s.home, 0) / 1000)
    expect(changed.seed).not.toBe(baseline.seed)
    expect(changed.inputs?.home.allowedShooting.forecastWeight).toBe(0)
    expect(changed.inputs?.home.drivers?.allowedShootingWeight).toBe(0)
    expect(baseline.inputs?.home.possessions).toMatchObject({ status: 'unavailable', per48: null })
    expect(baseline.inputs?.home.drivers?.mode).toBe('scoring-rate-fallback')
  })
  it.each(['duplicate-player-TO', 'malformed-player-TO', 'malformed-team-TO', 'negative-team-TO', 'duplicate-team-TO', 'conflicting-team-TO',
    'turnover-reconciliation', 'assist-reconciliation', 'rebound-reconciliation', 'duplicate-paint'])(
    'rejects contradictory optional context: %s', async (mode) => {
      const result = await collectNbaPlayerTotals(target, history, observedAt, fixtureFetcher(history, (data) => {
        const block = data.boxscore.players[0].statistics[0]; const stats = data.boxscore.teams[0].statistics
        if (mode === 'duplicate-player-TO') block.names[6] = 'TO'
        if (mode === 'malformed-player-TO') block.athletes[0].stats[7] = '1x'
        if (mode === 'malformed-team-TO') stats.push({ name: 'totalTurnovers', displayValue: '1.5' })
        if (mode === 'negative-team-TO') stats.push({ name: 'totalTurnovers', displayValue: '-1' })
        if (mode === 'duplicate-team-TO') stats.push({ name: 'totalTurnovers', displayValue: '12' }, { name: 'totalTurnovers', displayValue: '12' })
        if (mode === 'conflicting-team-TO') stats.push({ name: 'totalTurnovers', displayValue: '12' }, { name: 'turnovers', displayValue: '13' })
        if (mode === 'turnover-reconciliation') { stats.push({ name: 'totalTurnovers', displayValue: '1' }); block.athletes[0].stats[7] = '2' }
        if (mode === 'assist-reconciliation') stats.push({ name: 'assists', displayValue: '6' })
        if (mode === 'rebound-reconciliation') for (const row of block.athletes) { row.stats[5] = '7'; row.stats[11] = '6' }
        if (mode === 'duplicate-paint') stats.push({ name: 'pointsInPaint', displayValue: '40' })
      }))
      expect(result.status).toBe('unknown')
      expect(result.simulations).toBe(0)
    })
  it('captures verified optional player/team context while absent fields remain null and zero-weight changes do not affect scores', async () => {
    const baseline = await collectNbaPlayerTotals(target, history, observedAt, fixtureFetcher())
    const context = await collectNbaPlayerTotals(target, history, observedAt, fixtureFetcher(history, (data) => {
      for (const team of data.boxscore.players) for (const row of team.statistics[0].athletes) {
        row.stats[6] = '1'; row.stats[8] = '1'; row.stats[9] = '1'; row.stats[12] = '2'
      }
      for (const team of data.boxscore.teams) team.statistics.push(
        { name: 'assists', displayValue: '6' }, { name: 'steals', displayValue: '6' },
        { name: 'blocks', displayValue: '6' }, { name: 'fouls', displayValue: '12' },
      )
    }))
    expect(context.status).toBe('estimated')
    expect(context.inputs?.home.players[0].context?.samples[0]).toMatchObject({
      gameId: '2', rebounds: 6, offensiveRebounds: 1, defensiveRebounds: 5,
      assists: 1, turnovers: 0, steals: 1, blocks: 1, personalFouls: 2,
    })
    expect(context.inputs?.home.context).toMatchObject({
      own: { reboundsPerGame: 36, offensiveReboundsPerGame: 6, defensiveReboundsPerGame: 30,
        assistsPerGame: 6, turnoversPerGame: null, paintPointsPerGame: 40 },
      opponent: { assistsPerGame: 6 }, forecastWeight: 0,
    })
    expect(context.seed).toBe(baseline.seed)
    expect(context.scores).toEqual(baseline.scores)
    const missing = await collectNbaPlayerTotals(target, history, observedAt, fixtureFetcher(history, (data) => {
      for (const team of data.boxscore.players) {
        const block = team.statistics[0]
        for (const key of ['AST', 'TO', 'STL', 'BLK', 'PF']) {
          const index = block.names.indexOf(key); block.names.splice(index, 1)
          for (const row of block.athletes) row.stats.splice(index, 1)
        }
      }
    }))
    expect(missing.status).toBe('estimated')
    expect(missing.inputs?.home.players[0].context?.samples[0]).toMatchObject({ assists: null, turnovers: null, steals: null, blocks: null, personalFouls: null })
    expect(missing.seed).toBe(baseline.seed)
  })
  it('distinguishes missing plus/minus from zero and rejects malformed or unreconciled supplied values', async () => {
    const missing = await collectNbaPlayerTotals(target, history, observedAt, fixtureFetcher(history, (data) => {
      for (const team of data.boxscore.players) {
        team.statistics[0].names.pop()
        for (const row of team.statistics[0].athletes) row.stats.pop()
      }
    }))
    expect(missing.status).toBe('estimated')
    expect(missing.inputs?.home.players[0].plusMinus).toMatchObject({ total: null, perGame: null, observedGames: 0, forecastWeight: 0 })
    const partial = await collectNbaPlayerTotals(target, history, observedAt, fixtureFetcher(history, (data) => {
      data.boxscore.players[0].statistics[0].athletes[0].stats[13] = ''
    }))
    expect(partial.status).toBe('estimated')
    expect(partial.inputs?.home.players[0].plusMinus?.samples.every((s) => s.value === null)).toBe(true)
    for (const value of ['15oops', '1.5', 'Infinity', ' 15', '++15', '0']) {
      const bad = await collectNbaPlayerTotals(target, history, observedAt, fixtureFetcher(history, (data) => {
        data.boxscore.players[0].statistics[0].athletes[0].stats[13] = value
      }))
      expect(bad.status, `plus/minus ${value}`).toBe('unknown')
      expect(bad.reason).toMatch(/plus.minus/i)
    }
    const duplicate = await collectNbaPlayerTotals(target, history, observedAt, fixtureFetcher(history, (data) => {
      data.boxscore.players[0].statistics[0].names[6] = '+/-'
    }))
    expect(duplicate.status).toBe('unknown')
    expect(duplicate.reason).toMatch(/plus.minus/i)
  })
  it('retains signed plus/minus samples as zero-weight context without changing the score seed', async () => {
    const baseline = await collectNbaPlayerTotals(target, history, observedAt, fixtureFetcher())
    expect(baseline.inputs?.home.players[0].plusMinus).toMatchObject({
      samples: [{ gameId: '2', value: 15 }, { gameId: '1', value: 15 }],
      total: 30, perGame: 15, observedGames: 2, forecastWeight: 0,
    })
    expect(baseline.inputs?.away.players[0].plusMinus?.perGame).toBe(-15)
    const changed = await collectNbaPlayerTotals(target, history, observedAt, fixtureFetcher(history, (data) => {
      const rows = data.boxscore.players[0].statistics[0].athletes
      rows[0].stats[13] = '+0'; rows[1].stats[13] = '+30' // team sum still 5 × margin
    }))
    expect(changed.status).toBe('estimated')
    expect(changed.inputs?.home.players[0].plusMinus?.perGame).toBe(0)
    expect(changed.seed).toBe(baseline.seed)
    expect(changed.scores).toEqual(baseline.scores)
  })
  it('produces 1000 reproducible, nondegenerate player-score outcomes from reconciled final boxscores', async () => {
    const fetcher = fixtureFetcher()
    const result = await collectNbaPlayerTotals(target, history, observedAt, fetcher)
    expect(result.status).toBe('estimated')
    expect(result.simulations).toBe(1000)
    expect(result.totals).toHaveLength(1000)
    expect(result.scores).toHaveLength(1000)
    expect(new Set(result.totals).size).toBeGreaterThan(20)
    expect(result.totalSd).toBeGreaterThan(0)
    expect(result.expectedTotal).toBeGreaterThan(100)
    expect(result.seed).toMatch(/^[a-f0-9]{8}$/)
    expect(result.sources).toHaveLength(2) // shared games fetched only once
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(result.inputs?.home.players[0]).toMatchObject({ id: 'H-0', meanMinutes: 40,
      threeAttemptsPerMinute: expect.any(Number), threePct: expect.any(Number), paintAttempts: null })
    expect(result.inputs?.home.rotationSamples[0].reduce((sum, p) => sum + p.minutes, 0)).toBeCloseTo(240)
    expect(result.inputs?.home.reboundsAllowed.forecastWeight).toBe(0)
    expect(result.unknowns.join(' ')).toMatch(/paint.*unknown/i)
    expect(result.unknowns.join(' ')).toMatch(/injur/i)
    expect(result.assumptions.join(' ')).toMatch(/rotation-conditional/i)
    expect(result.scores.every((s, i) => s.home !== s.away && s.home + s.away === result.totals[i])).toBe(true)
    const repeat = await collectNbaPlayerTotals(target, [...history].reverse(), observedAt, fixtureFetcher())
    expect(repeat.totals).toEqual(result.totals)
    expect(repeat.seed).toBe(result.seed)
  })
  it('returns empirical complementary probabilities only for finite positive half-point totals', async () => {
    const result = await collectNbaPlayerTotals(target, history, observedAt, fixtureFetcher())
    const over = playerTotalChance(result, 'over', 220.5)
    expect(over).toBe(result.totals.filter((n) => n > 220.5).length / 1000)
    expect(playerTotalChance(result, 'under', 220.5)).toBe(1 - over!)
    for (const line of [NaN, Infinity, 220, 220.25, -0.5, 0]) expect(playerTotalChance(result, 'over', line)).toBeNull()
    expect(playerTotalChance({ ...result, totals: result.totals.slice(1) }, 'over', 220.5)).toBeNull()
    expect(playerTotalChance({ ...result, totals: [NaN, ...result.totals.slice(1)] }, 'over', 220.5)).toBeNull()
  })
  it('deduplicates history before minimum-sample selection and rejects conflicting game identities', async () => {
    const fetcher = fixtureFetcher()
    const sparse = await collectNbaPlayerTotals(target, [history[0], history[0]], observedAt, fetcher)
    expect(sparse.status).toBe('unknown')
    expect(sparse.reason).toMatch(/two.*games/i)
    expect(fetcher).not.toHaveBeenCalled()
    const conflict = await collectNbaPlayerTotals(target, [...history, { ...history[0], homeScore: 119 }], observedAt, fetcher)
    expect(conflict.status).toBe('unknown')
    expect(conflict.reason).toMatch(/conflicting/i)
    const irrelevant = [
      { ...history[0], id: 'past-season', season: 2026, tip: '2026-06-01T23:00:00Z' },
      { ...history[0], id: 'same-day', tip: '2026-10-28T07:00:00Z' },
      { ...history[0], id: 'cutoff', tip: '2026-10-28T06:00:00Z' },
      { ...history[0], id: 'target', tip: target.tip },
    ]
    const clean = await collectNbaPlayerTotals(target, history, observedAt, fixtureFetcher())
    const filtered = await collectNbaPlayerTotals(target, [...irrelevant, ...history, history[0]], observedAt, fixtureFetcher())
    expect(filtered.sources).toEqual(clean.sources)
    expect(filtered.totals).toEqual(clean.totals)
    expect(filtered.asOfCutoff).toBe('2026-10-28T06:00:00.000Z')
  })
  it('rejects missing or contradictory rebound rows rather than silently fabricating them', async () => {
    const malformed = fixtureFetcher(history, (d) => { d.boxscore.players[0].statistics[0].names[5] = 'not-REB' })
    expect((await collectNbaPlayerTotals(target, history, observedAt, malformed)).status).toBe('unknown')
    const contradictory = fixtureFetcher(history, (d) => {
      const row = d.boxscore.players[0].statistics[0].athletes[0]
      row.stats[5] = '7'
    })
    expect((await collectNbaPlayerTotals(target, history, observedAt, contradictory)).status).toBe('unknown')
  })
  it('keeps the same seed and outcomes on unchanged-input rescans one minute apart', async () => {
    const first = await collectNbaPlayerTotals(target, history, observedAt, fixtureFetcher())
    const later = await collectNbaPlayerTotals(target, history, '2026-10-28T12:01:00Z', fixtureFetcher())
    expect(later.observedAt).not.toBe(first.observedAt)
    expect(later.asOfCutoff).not.toBe(first.asOfCutoff)
    expect(later.seed).toBe(first.seed)
    expect(later.totals).toEqual(first.totals)
  })
  it('limits each team to five games, fetches at most two concurrently, and scopes cache by observation', async () => {
    const games = Array.from({ length: 7 }, (_, i) => ({ ...history[0], id: `bounded-${i}`, tip: `2026-10-${10 + i}T23:00:00Z` }))
    let active = 0; let maximum = 0
    const read = fixtureFetcher(games)
    const fetcher = vi.fn(async (...args: Parameters<typeof fetch>) => {
      active++; maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 2))
      try { return await read(...args) } finally { active-- }
    }) as typeof fetch
    const cache = new Map<string, Promise<unknown>>()
    const result = await collectNbaPlayerTotals(target, games, observedAt, fetcher, cache)
    expect(result.status).toBe('estimated')
    expect(result.inputs?.home.gameIds).toEqual(['bounded-6', 'bounded-5', 'bounded-4', 'bounded-3', 'bounded-2'])
    expect(fetcher).toHaveBeenCalledTimes(5)
    expect(maximum).toBe(2)
    expect((await collectNbaPlayerTotals(target, games, observedAt, fetcher, cache)).totals).toEqual(result.totals)
    expect(fetcher).toHaveBeenCalledTimes(5)
    const next = await collectNbaPlayerTotals(target, games, '2026-10-28T12:01:00Z', fetcher, cache)
    expect(next.totals).toEqual(result.totals)
    expect(fetcher).toHaveBeenCalledTimes(10)
  })
  it('fails closed within eight seconds even when a transport or JSON reader ignores abort', async () => {
    vi.useFakeTimers()
    try {
      for (const mode of ['transport', 'json']) {
        const never = new Promise<never>(() => {})
        const fetcher = vi.fn(() => mode === 'transport' ? never : Promise.resolve({ ok: true, json: () => never })) as unknown as typeof fetch
        const result = collectNbaPlayerTotals(target, history, observedAt, fetcher)
        const deadline = new Promise<'unbounded'>((resolve) => setTimeout(() => resolve('unbounded'), 8100))
        const bounded = Promise.race([result, deadline])
        await vi.advanceTimersByTimeAsync(8100)
        expect(await bounded).toMatchObject({ status: 'unknown', simulations: 0, reason: expect.stringMatching(/timeout/i) })
      }
    } finally { vi.useRealTimers() }
  })
  it('reports actual reconciled opponent-allowed sample counts for defensive shrinkage', async () => {
    const result = await collectNbaPlayerTotals(target, history, observedAt, fixtureFetcher())
    expect(result.status).toBe('estimated')
    expect(result.inputs?.home.allowedShooting).toMatchObject({ twoPct: 0.6, threePct: 1 / 6, twoAttempts: 120, threeAttempts: 72 })
    expect(result.inputs?.away.allowedShooting).toMatchObject({ twoPct: 0.6, threePct: 1 / 3, twoAttempts: 120, threeAttempts: 72 })
  })
  it('keeps zero-weight rebounds and missing team paint as context, not forecast inputs', async () => {
    const baseline = await collectNbaPlayerTotals(target, history, observedAt, fixtureFetcher())
    const contextOnly = fixtureFetcher(history, (data) => {
      for (const team of data.boxscore.teams) {
        team.statistics = team.statistics.filter((stat) => stat.name !== 'pointsInPaint')
        team.statistics.find((stat) => stat.name === 'totalRebounds')!.displayValue = '42'
        team.statistics.find((stat) => stat.name === 'defensiveRebounds')!.displayValue = '36'
      }
    })
    const result = await collectNbaPlayerTotals(target, history, observedAt, contextOnly)
    expect(result.status).toBe('estimated')
    expect(result.inputs?.home.teamPaintPointsPerGame).toBeNull()
    expect(result.inputs?.home.reboundsAllowed).toMatchObject({ totalPerGame: 42, forecastWeight: 0 })
    expect(result.inputs?.home.players.every((p) => p.paintAttempts === null)).toBe(true)
    expect(result.seed).toBe(baseline.seed)
    expect(result.totals).toEqual(baseline.totals)
  })
  it('fails closed before fetching on non-pregame observations or insufficient current history', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    for (const observed of [target.tip, 'bad-date', observedAt]) {
      const result = await collectNbaPlayerTotals(target, [], observed, fetcher)
      expect(result).toMatchObject({ version: 'nba-player-totals-v2', status: 'unknown',
        simulations: 0, eligibleForPrimary: false, totals: [], expectedTotal: null, totalSd: null })
      expect(result.reasons.length).toBeGreaterThan(0)
      expect(playerTotalChance(result, 'over', 220.5)).toBeNull()
    }
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('changes projections when reconciled individual three-point shooting changes', async () => {
    const baseline = await collectNbaPlayerTotals(target, history, observedAt, fixtureFetcher())
    const changedGames = history.map((g) => ({ ...g, homeScore: 138 }))
    const improvedShooting = fixtureFetcher(changedGames, (data) => {
      for (const row of data.boxscore.players[0].statistics[0].athletes) {
        row.stats[1] = '23'; row.stats[2] = '9-16'; row.stats[3] = '3-6'
      }
      data.boxscore.teams[0].statistics.find((s) => s.name === 'fieldGoalsMade-fieldGoalsAttempted')!.displayValue = '54-96'
      data.boxscore.teams[0].statistics.find((s) => s.name === 'threePointFieldGoalsMade-threePointFieldGoalsAttempted')!.displayValue = '18-36'
    })
    const changed = await collectNbaPlayerTotals(target, changedGames, observedAt, improvedShooting)
    expect(changed.status).toBe('estimated')
    expect(changed.inputs!.home.players[0].threePct).toBeGreaterThan(baseline.inputs!.home.players[0].threePct)
    expect(changed.expectedTotal!).toBeGreaterThan(baseline.expectedTotal! + 5)
    expect(changed.totals).not.toEqual(baseline.totals)
  })
  it('uses individual minute allocation and normalizes historical overtime to regulation', async () => {
    const baseline = await collectNbaPlayerTotals(target, history, observedAt, fixtureFetcher())
    const changedMinutes = fixtureFetcher(history, (data) => {
      data.boxscore.players[0].statistics[0].athletes.forEach((row, i) => { row.stats[0] = i < 3 ? '48' : '32' })
    })
    const changed = await collectNbaPlayerTotals(target, history, observedAt, changedMinutes)
    expect(changed.status).toBe('estimated')
    expect(changed.inputs!.home.players[0].meanMinutes).toBe(48)
    expect(changed.inputs!.home.players[0].threeAttemptsPerMinute).not.toBe(baseline.inputs!.home.players[0].threeAttemptsPerMinute)
    expect(changed.totals).not.toEqual(baseline.totals)
    const overtime = fixtureFetcher(history, (data) => {
      data.header.competitions[0].status.period = 5
      for (const team of data.boxscore.players) for (const row of team.statistics[0].athletes) row.stats[0] = '44'
    })
    const ot = await collectNbaPlayerTotals(target, history, observedAt, overtime)
    expect(ot.status).toBe('estimated')
    expect(ot.inputs!.home.rotationSamples[0].reduce((sum, row) => sum + row.minutes, 0)).toBeCloseTo(240)
    expect(ot.scores).toHaveLength(1000)
    expect(ot.scores.every((score) => score.home !== score.away)).toBe(true)
  })
})
