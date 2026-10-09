import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSessionToken } from '../../server/auth-core'
import handler from '../../api/nba-scan'
import { freezeNbaStudy, type NbaScan } from '../../src/nba-paper'

function response() {
  const state: { code: number; payload: unknown } = { code: 0, payload: null }
  return { state, setHeader: vi.fn(), status(code: number) { state.code = code; return { json(payload: unknown) { state.payload = payload } } } }
}
const cookie = `edgeboard_session=${createSessionToken('Admin', 'test-secret')}`
const events = [
  ['401909088', '2026-10-20T19:00:00Z', '8', '2'], ['401909089', '2026-10-20T23:00:00Z', '18', '20'],
  ['401909090', '2026-10-21T01:30:00Z', '24', '25'],
].map(([id, date, home, away]) => ({ id, date, season: { type: 2 }, status: { type: { state: 'pre' } },
  competitions: [{ neutralSite: false, competitors: [{ homeAway: 'home', team: { id: home } }, { homeAway: 'away', team: { id: away } }] }] }))
const winner = (event: string, city: string, side: string) => ({ ticker: `${event}-${side}`, event_ticker: event, title: `${city} wins`,
  rules_primary: `If ${city} wins the Pro Basketball game originally scheduled for Oct 20, 2026, then the market resolves to Yes.`,
  rules_secondary: 'If postponed by more than 48 hours, resolves to a fair price.' })
const markets = [winner('KXNBAGAME-26OCT20BOSDET', 'Boston', 'BOS'), winner('KXNBAGAME-26OCT20BOSDET', 'Detroit', 'DET'),
  winner('KXNBAGAME-26OCT20PHINYK', 'Philadelphia', 'PHI'), winner('KXNBAGAME-26OCT20PHINYK', 'New York', 'NYK'),
  winner('KXNBAGAME-26OCT20OKCSAS', 'Oklahoma City', 'OKC'), winner('KXNBAGAME-26OCT20OKCSAS', 'San Antonio', 'SAS')]
const mockFetch = (schedule = events) => vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
  const u = String(url)
  return { ok: true, json: async () => u.includes('scoreboard') ? { events: schedule } :
    u.includes('/orderbook') ? { orderbook_fp: { no_dollars: [['0.50', '100.00']], yes_dollars: [['0.49', '100.00']] } } :
      { markets: u.includes('series_ticker=KXNBAGAME') ? markets : [], cursor: '' } } as Response
})

describe('NBA Kalshi opening-slate scanner', () => {
  afterEach(() => { vi.restoreAllMocks(); delete process.env.EDGEBOARD_SESSION_SECRET })
  it('rejects unauthorized and unsupported requests without touching public markets', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
    const res = response()
    await handler({ method: 'GET', query: { date: '2026-10-20' }, headers: {} }, res)
    expect(res.state.code).toBe(401)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('returns one unqualified Kalshi study side per mapped game and honest ML-only coverage', async () => {
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    const fetcher = mockFetch()
    const res = response()
    await handler({ method: 'GET', query: { date: '2026-10-20', quantity: '10' }, headers: { cookie } }, res)
    expect(res.state.code).toBe(200)
    const body = res.state.payload as { games: { studySide: { ticker: string } | null; coverage: { spread: number; total: number };
      qualifiedPaperPick: boolean; inspected: { observedAt: string }[]; candidates: { ticker: string }[] }[];
      sources: unknown; marketObservedAt: string; marketInventory: { ticker: string; raw: { ticker: string } }[] }
    expect(body.games).toHaveLength(3)
    expect(body.games.every((g) => g.studySide?.ticker.startsWith('KXNBAGAME-26OCT20') && !g.qualifiedPaperPick && g.coverage.spread === 0 && g.coverage.total === 0)).toBe(true)
    expect(body.sources).toBeTruthy()
    expect(body.marketInventory).toHaveLength(6)
    expect(body.marketInventory[0].raw.ticker).toBe(body.marketInventory[0].ticker)
    expect(Number.isFinite(Date.parse(body.marketObservedAt))).toBe(true)
    expect(body.games.every((g) => g.inspected.every((item) => Number.isFinite(Date.parse(item.observedAt))) &&
      g.candidates.length === g.coverage.spread + 4)).toBe(true)
    expect(fetcher.mock.calls.every(([, init]) => !JSON.stringify(init ?? {}).includes('KALSHI-ACCESS-KEY'))).toBe(true)
  })
  it('fails closed if the independent schedule no longer matches mapped teams', async () => {
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    mockFetch(events.map((e, index) => index ? e : { ...e, competitions: [{ competitors: [{ homeAway: 'home', team: { id: '999' } }] }] }))
    const res = response()
    await handler({ method: 'GET', query: { date: '2026-10-20' }, headers: { cookie } }, res)
    expect(res.state.code).toBe(502)
  })
  it.skipIf(!process.env.EDGEBOARD_LIVE_NBA_SCAN)('reads the real opening slate without authentication to Kalshi', async () => {
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    const res = response()
    await handler({ method: 'GET', query: { date: '2026-10-20', quantity: '10' }, headers: { cookie } }, res)
    expect(res.state.code).toBe(200)
    const body = res.state.payload as { games: { gameId: string; studySide: { ticker: string } | null;
      coverage: { moneyline: number; spread: number; total: number }; qualifiedPaperPick: boolean }[] }
    expect(body.games.map((g) => g.gameId)).toEqual(['401909088', '401909089', '401909090'])
    expect(body.games.every((g) => !g.qualifiedPaperPick)).toBe(true)
    const frozen = freezeNbaStudy(res.state.payload as NbaScan, {}, new Date().toISOString())
    expect(frozen.decisions).toHaveLength(3)
    expect(frozen.decisions.every((decision) => decision.status === 'STUDY')).toBe(true)
    expect(frozen.scan.marketInventory.length).toBeGreaterThan(0)
    console.log('Live read-only NBA coverage:', body.games.map((g) => ({ id: g.gameId, coverage: g.coverage, study: g.studySide?.ticker ?? null })))
  }, 30000)
})
