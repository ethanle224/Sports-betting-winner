import { describe, expect, it, vi } from 'vitest'
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
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => String(input).includes('raw.githubusercontent.com')
      ? ({ ok: true, text: async () => schedule } as Response)
      : ({ ok: true, json: async () => ({ markets: String(input).includes('KXNFLTOTAL') ? [{ event_ticker: 'KXNFLTOTAL-26OCT04JACCIN', ticker: 'KXNFLTOTAL-26OCT04JACCIN-43', title: 'Full Game: over 42.5 points scored?', rules_primary: 'More than 42.5 points', yes_ask_dollars: '0.45' }] : [], cursor: '' }) } as Response))
    const res = response()
    await handler({ method: 'GET', query: { date: '2026-10-04', forecast: '1' }, headers: { cookie: `edgeboard_session=${token}` } }, res)
    expect(res.state.code).toBe(200)
    expect(res.state.payload).toMatchObject({ forecasts: [{ status: 'MODELED', modelVersion: 'pregame-score-v1' }] })
    fetcher.mockRestore()
    delete process.env.EDGEBOARD_SESSION_SECRET
  })
})
