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
  competitions: [{ neutralSite: false, competitors: [{ homeAway: 'home', team: { id: home, ...({ '8': { location: 'Detroit', abbreviation: 'DET', name: 'Pistons' }, '18': { location: 'New York', abbreviation: 'NY', name: 'Knicks' }, '24': { location: 'San Antonio', abbreviation: 'SA', name: 'Spurs' } } as Record<string, object>)[home] } },
    { homeAway: 'away', team: { id: away, ...({ '2': { location: 'Boston', abbreviation: 'BOS', name: 'Celtics' }, '20': { location: 'Philadelphia', abbreviation: 'PHI', name: '76ers' }, '25': { location: 'Oklahoma City', abbreviation: 'OKC', name: 'Thunder' } } as Record<string, object>)[away] } }] }] }))
const winner = (event: string, city: string, side: string) => ({ ticker: `${event}-${side}`, event_ticker: event, title: `${city} wins`,
  rules_primary: `If ${city} wins the ${({ BOSDET: 'Boston vs Detroit', PHINYK: 'Philadelphia vs New York', OKCSAS: 'Oklahoma City vs San Antonio', ATLORL: 'Atlanta vs Orlando' } as Record<string, string>)[event.slice(-6)]} Pro Basketball game originally scheduled for Oct ${event.includes('OCT21') ? '21' : '20'}, 2026, then the market resolves to Yes.`,
  rules_secondary: 'If postponed by more than 48 hours, resolves to a fair price.' })
const markets = [winner('KXNBAGAME-26OCT20BOSDET', 'Boston', 'BOS'), winner('KXNBAGAME-26OCT20BOSDET', 'Detroit', 'DET'),
  winner('KXNBAGAME-26OCT20PHINYK', 'Philadelphia', 'PHI'), winner('KXNBAGAME-26OCT20PHINYK', 'New York', 'NYK'),
  winner('KXNBAGAME-26OCT20OKCSAS', 'Oklahoma City', 'OKC'), winner('KXNBAGAME-26OCT20OKCSAS', 'San Antonio', 'SAS')]
const mockFetch = (schedule = events, rateLimitFirstBook = false) => {
  let bookAttempts = 0
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
  const u = String(url)
  if (u.includes('/orderbook') && rateLimitFirstBook && bookAttempts++ === 0) return { ok: false, status: 429 } as Response
  return { ok: true, json: async () => u.includes('scoreboard') ? { events: schedule } :
    u.includes('/orderbook') ? { orderbook_fp: { no_dollars: [['0.50', '100.00']], yes_dollars: [['0.49', '100.00']] } } :
      { markets: u.includes('series_ticker=KXNBAGAME') ? markets : [], cursor: '' } } as Response
  })
}

describe('NBA Kalshi opening-slate scanner', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); delete process.env.EDGEBOARD_SESSION_SECRET })
  it('rejects unauthorized and unsupported requests without touching public markets', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
    const res = response()
    await handler({ method: 'GET', query: { date: '2026-10-20' }, headers: {} }, res)
    expect(res.state.code).toBe(401)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('rejects malformed selected dates before touching public sources', async () => {
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    const fetcher = vi.spyOn(globalThis, 'fetch')
    const res = response()
    await handler({ method: 'GET', query: { date: '2026-99-99' }, headers: { cookie } }, res)
    expect(res.state.code).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('returns one unqualified Kalshi study side per mapped game and honest ML-only coverage', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-10-19T20:00:00Z'))
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    const fetcher = mockFetch()
    const res = response()
    await handler({ method: 'GET', query: { date: '2026-10-20', quantity: '10' }, headers: { cookie } }, res)
    expect(res.state.code).toBe(200)
    const body = res.state.payload as { games: { studySide: { ticker: string } | null; coverage: { spread: number; total: number };
      qualifiedPaperPick: boolean; inspected: { observedAt: string }[]; candidates: { ticker: string }[];
      factors: Record<string, { status: string; detail: string; source?: string }> }[];
      sources: unknown; marketObservedAt: string; marketInventory: { ticker: string; raw: { ticker: string } }[] }
    expect(body.games).toHaveLength(3)
    expect(body.games.every((g) => g.studySide?.ticker.startsWith('KXNBAGAME-26OCT20') && !g.qualifiedPaperPick && g.coverage.spread === 0 && g.coverage.total === 0)).toBe(true)
    expect(body.sources).toBeTruthy()
    expect(body.marketInventory).toHaveLength(6)
    expect(body.marketInventory[0].raw.ticker).toBe(body.marketInventory[0].ticker)
    expect(Number.isFinite(Date.parse(body.marketObservedAt))).toBe(true)
    expect(body.games.every((g) => g.inspected.every((item) => Number.isFinite(Date.parse(item.observedAt))) &&
      g.candidates.length === g.coverage.spread + 4)).toBe(true)
    expect(body.games[0].factors).toMatchObject({ injuries: { status: 'unknown' }, starters: { status: 'unknown' },
      contractRules: { status: 'verified' }, fees: { status: 'estimated' }, depth: { status: 'verified' }, fillability: { status: 'unknown' } })
    expect(body.games[0].factors.contractRules.source).toContain(body.games[0].studySide!.ticker)
    expect(fetcher.mock.calls.every(([, init]) => !JSON.stringify(init ?? {}).includes('KALSHI-ACCESS-KEY'))).toBe(true)
  })
  it('recovers from a bounded public book rate limit rather than discarding the whole slate', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-10-19T20:00:00Z'))
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    const fetcher = mockFetch(events, true)
    const res = response()
    await handler({ method: 'GET', query: { date: '2026-10-20', quantity: '10' }, headers: { cookie } }, res)
    expect(res.state.code).toBe(200)
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/orderbook')).length).toBeGreaterThan(6)
  })
  it('fails closed if the independent schedule no longer matches mapped teams', async () => {
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    mockFetch(events.map((e, index) => index ? e : { ...e, competitions: [{ competitors: [{ homeAway: 'home', team: { id: '999' } }] }] }))
    const res = response()
    await handler({ method: 'GET', query: { date: '2026-10-20' }, headers: { cookie } }, res)
    expect(res.state.code).toBe(502)
  })
  it('scans the selected next-day schedule rather than reusing opening-night contracts', async () => {
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    const tomorrow = [{ id: '401909834', date: '2026-10-21T23:00:00Z', season: { type: 2 }, status: { type: { state: 'pre' } },
      competitions: [{ neutralSite: false, competitors: [
        { homeAway: 'home', team: { id: '19', location: 'Orlando', abbreviation: 'ORL', name: 'Magic' } },
        { homeAway: 'away', team: { id: '1', location: 'Atlanta', abbreviation: 'ATL', name: 'Hawks' } },
      ] }] }]
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true, json: async () =>
      String(url).includes('scoreboard') ? { events: tomorrow } : String(url).includes('/orderbook') ?
        { orderbook_fp: { no_dollars: [['0.50', '100.00']], yes_dollars: [['0.49', '100.00']] } } :
        { markets: String(url).includes('series_ticker=KXNBAGAME') ? [
          { ...winner('KXNBAGAME-26OCT21ATLORL', 'Atlanta', 'ATL'), rules_primary: 'If Atlanta wins the Atlanta vs Orlando Pro Basketball game originally scheduled for Oct 21, 2026, then the market resolves to Yes.' },
          { ...winner('KXNBAGAME-26OCT21ATLORL', 'Orlando', 'ORL'), rules_primary: 'If Orlando wins the Atlanta vs Orlando Pro Basketball game originally scheduled for Oct 21, 2026, then the market resolves to Yes.' },
          ...markets,
        ] : [], cursor: '' } }) as Response)
    const res = response()
    await handler({ method: 'GET', query: { date: '2026-10-21', quantity: '10' }, headers: { cookie } }, res)
    expect(res.state.code).toBe(200)
    const body = res.state.payload as { date: string; games: { gameId: string; studySide: { ticker: string } | null }[]; marketInventory: { ticker: string }[] }
    expect(body.date).toBe('2026-10-21')
    expect(body.games.map((g) => g.gameId)).toEqual(['401909834'])
    expect(body.games[0].studySide?.ticker).toContain('26OCT21ATLORL')
    expect(body.marketInventory.every((m) => m.ticker.includes('26OCT21ATLORL'))).toBe(true)
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('dates=20261021'))).toBe(true)
  })
  it('shows unpriced games rather than borrowing contracts from a different date', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-10-19T20:00:00Z'))
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true, json: async () =>
      String(url).includes('scoreboard') ? { events } : { markets: String(url).includes('series_ticker=KXNBAGAME') ?
        [winner('KXNBAGAME-26OCT21ATLORL', 'Atlanta', 'ATL')] : [], cursor: '' } }) as Response)
    const res = response()
    await handler({ method: 'GET', query: { date: '2026-10-20', quantity: '10' }, headers: { cookie } }, res)
    expect(res.state.code).toBe(200)
    const body = res.state.payload as { games: { studySide: unknown }[]; marketInventory: unknown[] }
    expect(body.games).toHaveLength(3)
    expect(body.marketInventory).toEqual([])
    expect(body.games.every((g) => g.studySide === null)).toBe(true)
  })
  it('does not enumerate stale games on a date without an NBA slate', async () => {
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ events: [] }) } as Response)
    const res = response()
    await handler({ method: 'GET', query: { date: '2026-10-22', quantity: '10' }, headers: { cookie } }, res)
    expect(res.state.code).toBe(200)
    expect((res.state.payload as { games: unknown[] }).games).toEqual([])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.skipIf(!process.env.EDGEBOARD_LIVE_NBA_SCAN)('reads the selected next-day slate without authentication to Kalshi', async () => {
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    const res = response()
    await handler({ method: 'GET', query: { date: '2026-10-21', quantity: '10' }, headers: { cookie } }, res)
    expect(res.state.code).toBe(200)
    const body = res.state.payload as { games: { gameId: string; studySide: { ticker: string } | null;
      coverage: { moneyline: number; spread: number; total: number }; qualifiedPaperPick: boolean;
      factors: Record<string, { status: string }> }[] }
    expect(body.games).toHaveLength(11)
    expect(body.games.every((g) => g.studySide?.ticker.includes('26OCT21'))).toBe(true)
    expect(body.games.every((g) => !g.qualifiedPaperPick)).toBe(true)
    expect(body.games.every((g) => g.factors.threes.status === 'verified' && g.factors.pace.status === 'estimated')).toBe(true)
    const frozen = freezeNbaStudy(res.state.payload as NbaScan, {}, new Date().toISOString())
    expect(frozen.decisions).toHaveLength(11)
    expect(frozen.decisions.every((decision) => decision.status === 'STUDY')).toBe(true)
    expect(frozen.scan.marketInventory.length).toBeGreaterThan(0)
    console.log('Live read-only NBA selected-date coverage:', body.games.map((g) => ({ id: g.gameId, coverage: g.coverage,
      study: g.studySide?.ticker ?? null })))
  }, 90000)
})
