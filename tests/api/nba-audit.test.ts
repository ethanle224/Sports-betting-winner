import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSessionToken } from '../../server/auth-core.js'
import handler from '../../api/nba-audit.js'

const date = '2026-10-20'
const gameId = '401909088'
const ticker = 'KXNBAGAME-26OCT20BOSDET-BOS'
const rules = 'If Boston wins the Boston vs Detroit Pro Basketball game originally scheduled for Oct 20, 2026, then the market resolves to Yes.'
const terms = 'If the game is postponed for 48 hours, it may resolve to a fair price.'
const event = { id: gameId, date: '2026-10-20T23:00:00Z', season: { type: 2 }, status: { type: { state: 'post', completed: true } },
  competitions: [{ neutralSite: false, competitors: [
    { homeAway: 'home', score: '121', team: { id: '8', location: 'Detroit', name: 'Pistons', abbreviation: 'DET' } },
    { homeAway: 'away', score: '113', team: { id: '2', location: 'Boston', name: 'Celtics', abbreviation: 'BOS' } },
  ] }] }
const market = { ticker, event_ticker: 'KXNBAGAME-26OCT20BOSDET', market_type: 'binary', status: 'finalized', result: 'no',
  settlement_value_dollars: '0.0000', rules_primary: rules, rules_secondary: terms }
const cookie = `edgeboard_session=${createSessionToken('Admin', 'test-secret')}`
const response = () => {
  const state: { code: number; payload?: unknown; headers: Record<string, string> } = { code: 0, headers: {} }
  return { state, setHeader: (key: string, value: string) => { state.headers[key] = value },
    status: (code: number) => { state.code = code; return { json: (value: unknown) => { state.payload = value } } } }
}
const request = { method: 'GET', headers: { cookie }, query: { date, gameId, ticker } }
function mockSources(match = market, scheduled = event) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true,
    json: async () => String(url).includes('scoreboard') ? { events: [scheduled] } : { market: match } }) as Response)
}
describe('read-only NBA paper outcome audit', () => {
  afterEach(() => { vi.restoreAllMocks(); delete process.env.EDGEBOARD_SESSION_SECRET })
  it('uses final ESPN scores and exact finalized Kalshi settlement for a losing YES pick', async () => {
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    const fetcher = mockSources()
    const res = response()
    await handler(request, res)
    expect(res.state.code).toBe(200)
    expect(res.state.payload).toMatchObject({ state: 'finalized', result: 'NO', payoutYes: 0,
      scores: { home: 121, away: 113 }, rulesPrimary: rules, rulesSecondary: terms, ticker, gameId, date })
    expect(fetcher.mock.calls).toHaveLength(2)
    expect(fetcher.mock.calls.every(([url]) => String(url).startsWith('https://') && !String(url).includes('/orders'))).toBe(true)
  })
  it('leaves active contracts pending even after the game is final', async () => {
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'; mockSources({ ...market, status: 'active', result: '', settlement_value_dollars: null })
    const res = response(); await handler(request, res)
    expect(res.state.code).toBe(200)
    expect(res.state.payload).toMatchObject({ state: 'pending', reason: 'Kalshi contract not finalized' })
  })
  it('refuses a binary market result that contradicts the official final score', async () => {
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'; mockSources({ ...market, result: 'yes', settlement_value_dollars: '1.0000' })
    const res = response(); await handler(request, res)
    expect(res.state.code).toBe(200)
    expect(res.state.payload).toMatchObject({ state: 'needs_review' })
  })
  it('does not settle while the NBA game is still live', async () => {
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'; mockSources(market, { ...event, status: { type: { state: 'in', completed: false } } })
    const res = response(); await handler(request, res)
    expect(res.state.payload).toMatchObject({ state: 'pending', reason: 'Official NBA final score not available' })
  })
  it('handles a finalized nonbinary fair-price payout without claiming a win/loss', async () => {
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'; mockSources({ ...market, result: 'scalar', settlement_value_dollars: '0.4200' },
      { ...event, status: { type: { state: 'pre', completed: false } } })
    const res = response(); await handler(request, res)
    expect(res.state.payload).toMatchObject({ state: 'finalized', result: 'FAIR_PRICE', payoutYes: .42, scores: null })
  })
  it('rejects auth, malformed inputs and mismatched game tickers before requesting public sources', async () => {
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    const fetcher = mockSources()
    const unauth = response(); await handler({ ...request, headers: {} }, unauth)
    expect(unauth.state.code).toBe(401)
    const malformed = response(); await handler({ ...request, query: { ...request.query, ticker: 'KXNBAGAME-26OCT21ATLORL-ORL' } }, malformed)
    expect(malformed.state.code).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('fails closed if the Kalshi market changes its contract terms or event mapping', async () => {
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    mockSources({ ...market, event_ticker: 'KXNBAGAME-26OCT20PHINYK' })
    const res = response(); await handler(request, res)
    expect(res.state.code).toBe(200)
    expect(res.state.payload).toMatchObject({ state: 'needs_review' })
  })
  it.skipIf(!process.env.EDGEBOARD_LIVE_NBA_AUDIT)('reads an actual finalized game and contract through public endpoints', async () => {
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    const res = response()
    await handler(request, res)
    expect(res.state.code).toBe(200)
    expect(res.state.payload).toMatchObject({ state: 'finalized', result: 'NO', payoutYes: 0,
      scores: { home: 121, away: 113 }, ticker, gameId })
  })
})
