import { describe, expect, it, vi } from 'vitest'
import { gzipSync } from 'node:zlib'
import { createSessionToken } from './auth-core'
import handler from './nfl-scan'

const token = createSessionToken('Admin', 'test-secret')
function response() {
  const state: { code: number; payload: unknown } = { code: 0, payload: null }
  return { state, setHeader: vi.fn(), status(code: number) { state.code = code; return { json(payload: unknown) { state.payload = payload } } } }
}

describe('NFL scan endpoint', () => {
  it('denies missing session without fetching markets', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
    const res = response()
    await handler({ method: 'GET', query: { date: '2026-10-04' }, headers: {} }, res)
    expect(res.state.code).toBe(401)
    expect(fetcher).not.toHaveBeenCalled()
    fetcher.mockRestore()
  })
  it('rejects invalid dates before any API request', async () => {
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    const fetcher = vi.spyOn(globalThis, 'fetch')
    const res = response()
    await handler({ method: 'GET', query: { date: 'yesterday' }, headers: { cookie: `edgeboard_session=${token}` } }, res)
    expect(res.state.code).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
    fetcher.mockRestore()
    delete process.env.EDGEBOARD_SESSION_SECRET
  })
  it('quotes the requested whole-share quantity rather than a fixed ten', async () => {
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ orderbook_fp: { no_dollars: [['0.45', '20'], ['0.40', '30']], yes_dollars: [] } }) } as Response)
    const res = response()
    await handler({ method: 'GET', query: { ticker: 'KXNFLGAME-26OCT04INDWAS-IND', quantity: '40' }, headers: { cookie: `edgeboard_session=${token}` } }, res)
    expect(res.state.code).toBe(200)
    expect(res.state.payload).toMatchObject({ quantity: 40, yes: { quantity: 40 }, no: null })
    fetcher.mockRestore()
    delete process.env.EDGEBOARD_SESSION_SECRET
  })
  it('rejects invalid or excessive share counts before querying Kalshi', async () => {
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    const fetcher = vi.spyOn(globalThis, 'fetch')
    for (const quantity of ['0', '1.5', '1001', 'Infinity', '-1']) {
      const res = response()
      await handler({ method: 'GET', query: { ticker: 'KXNFLGAME-26OCT04INDWAS-IND', quantity }, headers: { cookie: `edgeboard_session=${token}` } }, res)
      expect(res.state.code).toBe(400)
    }
    expect(fetcher).not.toHaveBeenCalled()
    fetcher.mockRestore()
    delete process.env.EDGEBOARD_SESSION_SECRET
  })
  it('returns exact-line experimental forecasts separately from the market inventory', async () => {
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    const schedule = 'game_type,gameday,home_team,away_team,home_score,away_score\n' +
      Array.from({ length: 32 }, (_, i) => `REG,2025-09-${String(1 + i % 28).padStart(2, '0')},CIN,JAX,${20 + i % 8},${17 + i % 6}`).join('\n') +
      '\nREG,2026-10-04,CIN,JAX,,\n'
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => String(input).includes('site.api.espn.com')
      ? ({ ok: true, json: async () => ({ events: [] }) } as Response)
      : String(input).includes('raw.githubusercontent.com')
      ? ({ ok: true, text: async () => schedule } as Response)
      : ({ ok: true, json: async () => ({ markets: String(input).includes('KXNFLTOTAL') ? [{ event_ticker: 'KXNFLTOTAL-26OCT04JACCIN', ticker: 'KXNFLTOTAL-26OCT04JACCIN-43', title: 'Full Game: over 42.5 points scored?', rules_primary: 'More than 42.5 points', yes_ask_dollars: '0.45' }] : [], cursor: '' }) } as Response))
    const res = response()
    await handler({ method: 'GET', query: { date: '2026-10-04', forecast: '1' }, headers: { cookie: `edgeboard_session=${token}` } }, res)
    expect(res.state.code).toBe(200)
    expect(res.state.payload).toMatchObject({ forecasts: [{ status: 'MODELED', modelVersion: 'pregame-score-v1' }] })
    fetcher.mockRestore()
    delete process.env.EDGEBOARD_SESSION_SECRET
  })
  it('matches an independent sportsbook line to the exact scanned game without Kalshi as its model', async () => {
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    const schedule = 'game_type,gameday,home_team,away_team,home_score,away_score,spread_line,total_line\n' +
      Array.from({ length: 32 }, (_, i) => `REG,2025-09-${String(1 + i % 28).padStart(2, '0')},CIN,JAX,${20 + i % 8},${17 + i % 6},3.5,45.5`).join('\n') +
      '\nREG,2026-10-04,CIN,JAX,,,,\n'
    const events = [{ id: '401', date: '2026-10-04T17:00:00Z', status: { type: { state: 'pre' } }, competitions: [{ competitors: [
      { homeAway: 'home', team: { abbreviation: 'CIN' } }, { homeAway: 'away', team: { abbreviation: 'JAX' } }],
    odds: [{ provider: { name: 'Draft Kings' }, spread: -5.5, overUnder: 51.5, homeTeamOdds: { favorite: true }, awayTeamOdds: { favorite: false } }] }] }]
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => String(input).includes('site.api.espn.com')
      ? ({ ok: true, json: async () => ({ events }) } as Response)
      : String(input).includes('raw.githubusercontent.com')
      ? ({ ok: true, text: async () => schedule } as Response)
      : ({ ok: true, json: async () => ({ markets: String(input).includes('KXNFLTOTAL') ? [{ event_ticker: 'KXNFLTOTAL-26OCT04JACCIN', ticker: 'KXNFLTOTAL-26OCT04JACCIN-43', title: 'Full Game: over 42.5 points scored?', rules_primary: 'More than 42.5 points' }] : [], cursor: '' }) } as Response))
    const res = response()
    await handler({ method: 'GET', query: { date: '2026-10-04', forecast: '1' }, headers: { cookie: `edgeboard_session=${token}` } }, res)
    expect(res.state.code).toBe(200)
    expect(res.state.payload).toMatchObject({ forecasts: [{ modelVersion: 'sportsbook-score-v2', modelSource: 'Draft Kings via ESPN' }], bookmakerLines: [{ home: 'CIN', away: 'JAX' }] })
    fetcher.mockRestore()
    delete process.env.EDGEBOARD_SESSION_SECRET
  })
  it('refreshes efficiency when completed regular-season games post after the bundled snapshot', async () => {
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    const schedule = 'game_type,gameday,home_team,away_team,home_score,away_score,spread_line,total_line\n' +
      Array.from({ length: 32 }, (_, i) => `REG,2025-09-${String(1 + i % 28).padStart(2, '0')},CIN,JAX,${20 + i % 8},${17 + i % 6},3.5,45.5`).join('\n') +
      '\nREG,2026-10-08,CIN,JAX,24,21,3.5,45.5\nREG,2026-10-11,CIN,JAX,,,,\n'
    const pbp = 'game_id,game_date,season_type,play_type,posteam,defteam,home_team,away_team,drive,epa,success,first_down,qb_spike,qb_kneel\n' +
      ['CIN', 'JAX'].flatMap((team) => Array.from({ length: 20 }, (_, i) =>
        `2026_05_JAX_CIN,2026-10-08,REG,pass,${team},${team === 'CIN' ? 'JAX' : 'CIN'},CIN,JAX,${Math.floor(i / 5) + 1},0.2,1,1,0,0`)).join('\n') + '\n'
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => String(input).includes('play_by_play_2026.csv.gz')
      ? ({ ok: true, arrayBuffer: async () => Uint8Array.from(gzipSync(pbp)).buffer } as Response)
      : String(input).includes('site.api.espn.com') ? ({ ok: true, json: async () => ({ events: [] }) } as Response)
      : String(input).includes('raw.githubusercontent.com') ? ({ ok: true, text: async () => schedule } as Response)
      : ({ ok: true, json: async () => ({ markets: [], cursor: '' }) } as Response))
    const res = response()
    await handler({ method: 'GET', query: { date: '2026-10-11', forecast: '1' }, headers: { cookie: `edgeboard_session=${token}` } }, res)
    expect(res.state.code).toBe(200)
    expect(res.state.payload).toMatchObject({ efficiencyStatus: 'refreshed', efficiencySnapshotThrough: '2026-10-08', contexts: [{ context: { snapshotThrough: '2026-10-08' } }] })
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('play_by_play_2026.csv.gz'), expect.anything())
    fetcher.mockRestore()
    delete process.env.EDGEBOARD_SESSION_SECRET
  })
  it('includes completed preseason games as low-weight context without modifying probabilities', async () => {
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    const schedule = 'game_type,gameday,home_team,away_team,home_score,away_score\n' +
      Array.from({ length: 32 }, (_, i) => `REG,2025-09-${String(1 + i % 28).padStart(2, '0')},WAS,IND,${20 + i % 8},${17 + i % 6}`).join('\n') +
      '\nREG,2026-10-04,WAS,IND,,\n'
    const warmup = { id: '401', date: '2026-08-13T23:00:00Z', season: { year: 2026, type: 1 },
      status: { type: { completed: true } }, competitions: [{ competitors: [
        { homeAway: 'home', team: { abbreviation: 'WSH' }, score: '16' },
        { homeAway: 'away', team: { abbreviation: 'IND' }, score: '14' },
      ] }] }
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => String(input).includes('seasontype=1')
      ? ({ ok: true, json: async () => ({ events: [warmup] }) } as Response)
      : String(input).includes('site.api.espn.com') ? ({ ok: true, json: async () => ({ events: [] }) } as Response)
      : String(input).includes('raw.githubusercontent.com') ? ({ ok: true, text: async () => schedule } as Response)
      : ({ ok: true, json: async () => ({ markets: [], cursor: '' }) } as Response))
    const res = response()
    await handler({ method: 'GET', query: { date: '2026-10-04', forecast: '1' }, headers: { cookie: `edgeboard_session=${token}` } }, res)
    expect(res.state.code).toBe(200)
    expect(res.state.payload).toMatchObject({ preseasonStatus: 'observed', contexts: [{
      homeForm: { preseasonGames: 1, weights: { currentRegular: 4, previousRegular: 1, currentPreseason: 0.5 }, probabilityAdjustment: false },
      awayForm: { preseasonGames: 1 },
    }] })
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('seasontype=1'))).toHaveLength(4)
    fetcher.mockRestore()
    delete process.env.EDGEBOARD_SESSION_SECRET
  })
})
