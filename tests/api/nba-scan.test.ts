import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSessionToken } from '../../server/auth-core'
import handler from '../../api/nba-scan'
import { freezeNbaStudy, type NbaScan } from '../../src/nba-paper'
import { pricedNbaSide } from '../../server/nba-kalshi'
import * as playerTotalsModule from '../../server/nba-player-totals'

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
const mockFetch = (schedule = events, rateLimitFirstBook = false, withPregameLine = false) => {
  let bookAttempts = 0
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
  const u = String(url)
  if (u.includes('/orderbook') && rateLimitFirstBook && bookAttempts++ === 0) return { ok: false, status: 429 } as Response
  return { ok: true, json: async () => u.includes('scoreboard') ? { events: schedule } :
    u.includes('/summary?') && withPregameLine ? { pickcenter: [{ provider: { name: 'Draft Kings' }, details: 'BOS -3.5', spread: 3.5 }] } :
    u.includes('/orderbook') ? { orderbook_fp: { no_dollars: [['0.50', '100.00']], yes_dollars: [['0.49', '100.00']] } } :
      { markets: u.includes('series_ticker=KXNBAGAME') ? markets : [], cursor: '' } } as Response
  })
}

describe('NBA Kalshi opening-slate scanner', () => {
  it('includes an observed sportsbook reference in the pre-tip scan without replacing the selected Kalshi contract', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-10-19T20:00:00Z'))
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    mockFetch(events, false, true)
    const res = response()
    await handler({ method: 'GET', query: { date: '2026-10-20' }, headers: { cookie } }, res)
    expect(res.state.code).toBe(200)
    const body = res.state.payload as NbaScan
    expect(body.games[0].pregameLine).toMatchObject({ homeSpread: 3.5, awaySpread: -3.5,
      provider: 'Draft Kings', source: expect.stringContaining('summary?event=401909088') })
    const frozen = freezeNbaStudy(body, { '401909088': { requestedPaper: true, availabilitySource: '', availabilityObservedAt: '',
      availabilityNotes: '', rulesSource: '', feeSource: '', uncertaintyAccepted: false, rationale: '' } }, new Date().toISOString())
    expect(frozen.scan.games[0].pregameLine).toEqual(body.games[0].pregameLine)
  })
  it('freezes player-shadow unknowns without replacing the baseline or primary when history is sparse', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-10-19T20:00:00Z'))
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    mockFetch()
    const res = response()
    await handler({ method: 'GET', query: { date: '2026-10-20' }, headers: { cookie } }, res)
    expect(res.state.code).toBe(200)
    const body = res.state.payload as NbaScan
    expect(body.games[0].playerTotals?.simulation).toMatchObject({ status: 'unknown', simulations: 0 })
    expect(body.games[0].playerTotals?.comparison).toMatchObject({ status: 'PAPER_ONLY_EXPERIMENT', studySide: null })
    expect(body.games[0].studySide).toBeNull()
    expect(body.games[0].baselineStudySide?.market).toBe('moneyline')
    const freeze = freezeNbaStudy(body, {}, new Date().toISOString())
    expect(freeze.scan.games[0].playerTotals).toEqual(body.games[0].playerTotals)
    expect(freeze.decisions[0]).toMatchObject({ selected: null, shadow: null })
  })
  it('inspects a sportsbook-near spread for shadow comparison without adding it to baseline ranking', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-10-19T20:00:00Z'))
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    const spreads = [1.5, 2.5, 3.5, 4.5, 25.5].map((line) => ({
      ticker: `KXNBASPREAD-26OCT20BOSDET-BOS${line + 0.5}`, event_ticker: 'KXNBASPREAD-26OCT20BOSDET',
      title: `Boston wins by over ${line} points`,
      rules_primary: `If Boston wins by more than ${line} points in the Boston vs Detroit Pro Basketball game originally scheduled for Oct 20, 2026, then the market resolves to Yes.`,
      rules_secondary: 'If postponed by more than 48 hours, resolves to a fair price.',
    }))
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      return { ok: true, json: async () => u.includes('scoreboard') ? { events: [events[0]] } :
        u.includes('/summary?') ? { pickcenter: [{ provider: { name: 'Draft Kings' }, details: 'BOS -25.5', spread: -25.5, overUnder: 222.5 }] } :
        u.includes('/orderbook') ? { orderbook_fp: { no_dollars: [['0.50', '100']], yes_dollars: [['0.49', '100']] } } :
          { markets: u.includes('KXNBASPREAD') ? spreads : u.includes('KXNBAGAME') ? markets.slice(0, 2) : [], cursor: '' } } as Response
    })
    const res = response()
    await handler({ method: 'GET', query: { date: '2026-10-20', quantity: '10' }, headers: { cookie } }, res)
    expect(res.state.code).toBe(200)
    const game = (res.state.payload as NbaScan).games[0]
    expect(game.pregameLine?.homeSpread).toBe(25.5)
    expect(fetcher.mock.calls.some(([url]) => String(url).includes(`${spreads[4].ticker}/orderbook`))).toBe(true)
    expect(game.inspected.some((book) => book.ticker === spreads[4].ticker)).toBe(true)
    expect(game.studySide?.ticker).not.toBe(spreads[4].ticker)
  })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); delete process.env.EDGEBOARD_SESSION_SECRET })
  it.each([1, 10, 100])('retains the same priced total at requested quantity %s without assuming ten contracts', async (quantity) => {
    vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-10-19T20:00:00Z'))
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    const simulation = { version: 'nba-player-totals-v2' as const, status: 'estimated' as const, eligibleForPrimary: true as const,
      observedAt: '2026-10-19T20:00:00Z', asOfCutoff: '2026-10-19T14:00:00Z', simulations: 1000,
      seed: 'unit-test-inputs', sources: [], assumptions: [], unknowns: [], reason: null, reasons: [],
      totals: Array.from({ length: 1000 }, () => 310), scores: Array(1000).fill({ home: 160, away: 150, overtimePeriods: 0 }), expectedTotal: 310, totalSd: 0, inputs: null }
    const collect = vi.spyOn(playerTotalsModule, 'collectNbaPlayerTotals').mockResolvedValue(simulation)
    const total = { ticker: 'KXNBATOTAL-26OCT20BOSDET-T300', event_ticker: 'KXNBATOTAL-26OCT20BOSDET',
      title: 'Over 299.5 total points',
      rules_primary: 'If over 299.5 total points are scored in the Boston vs Detroit Pro Basketball game originally scheduled for Oct 20, 2026, then the market resolves to Yes.',
      rules_secondary: 'If postponed by more than 48 hours, resolves to a fair price.' }
    const book = { orderbook_fp: { no_dollars: [['0.53', '2'], ['0.49', '100']],
      yes_dollars: [['0.51', '3'], ['0.48', '100']] } }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      return { ok: true, json: async () => u.includes('scoreboard') ? { events: [events[0]] } :
        u.includes('/orderbook') ? book : { markets: u.includes('series_ticker=KXNBATOTAL') ? [total] : [], cursor: '' } } as Response
    })
    const res = response()
    await handler({ method: 'GET', query: { date: '2026-10-20', quantity: String(quantity) }, headers: { cookie } }, res)
    expect(res.state.code).toBe(200)
    const body = res.state.payload as NbaScan
    const game = body.games[0]
    const quote = pricedNbaSide(book, 'no', quantity)!
    expect(body.quantity).toBe(quantity)
    expect(game.baselineStudySide).toMatchObject({ ticker: total.ticker, side: 'no',
      price: quote.price, feeEstimate: quote.feeEstimate, allInCost: quote.allInCost })
    expect(game.selectionPolicy).toBe('nba-primary-v4-player-totals-v2')
    expect(game.studySide).toEqual(game.playerTotals?.comparison.studySide)
    expect(game.studySide?.probability).toBe(1)
    expect(game.candidates).toEqual(game.playerTotals?.comparison.candidates)
    expect(game.shadowSide).toBeNull()
    expect(game.playerTotals?.comparison.baselineCandidates).toEqual(expect.arrayContaining([game.baselineStudySide]))
    expect(game.baselinePolicyStudySide).toEqual(game.baselineStudySide)
    expect(game.legacySelection?.selectionPolicy).toBe('nba-primary-v3-sides-paused')
    expect(game.playerTotals?.comparison.status).toBe('PAPER_ONLY_EXPERIMENT')
    expect(game.playerTotals?.comparison.promotionGate).toBe('USER_APPROVED_PAPER_ONLY')
    expect(game.abstentionReason).toBeNull()
    expect(game.inspected[0].book).toEqual(book)
    expect(collect).toHaveBeenCalledWith(expect.objectContaining({ home: '8', away: '2', tip: events[0].date }),
      expect.any(Array), expect.any(String), expect.any(Function), expect.any(Map))
    expect(game.playerTotals?.simulation).toEqual(simulation)
    expect(game.playerTotals?.comparison.candidates).toHaveLength(2)
    expect(game.playerTotals?.comparison.studySide).toMatchObject({ ticker: total.ticker, side: 'yes', probability: 1 })
    expect(game.studySide?.side).toBe('yes')
    const playerQuote = pricedNbaSide(book, 'yes', quantity)!
    expect(game.playerTotals?.comparison.studySide).toMatchObject({ allInCost: playerQuote.allInCost,
      price: playerQuote.price, feeEstimate: playerQuote.feeEstimate })
    expect(body.marketInventory[0]).toMatchObject({ raw: total })
  })
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
  it('pauses unvalidated ML primaries but retains baseline prices and honest coverage', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-10-19T20:00:00Z'))
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    const fetcher = mockFetch()
    const res = response()
    await handler({ method: 'GET', query: { date: '2026-10-20', quantity: '10' }, headers: { cookie } }, res)
    expect(res.state.code).toBe(200)
    const body = res.state.payload as { games: { studySide: { ticker: string } | null; baselineStudySide: { ticker: string } | null;
      selectionPolicy: string; abstentionReason: string | null; coverage: { spread: number; total: number };
      qualifiedPaperPick: boolean; inspected: { observedAt: string }[]; candidates: { ticker: string }[];
      factors: Record<string, { status: string; detail: string; source?: string }> }[];
      sources: unknown; marketObservedAt: string; marketInventory: { ticker: string; raw: { ticker: string } }[] }
    expect(body.games).toHaveLength(3)
    expect(body.games.every((g) => g.studySide === null && g.baselineStudySide?.ticker.startsWith('KXNBAGAME-26OCT20') &&
      g.selectionPolicy === 'nba-primary-v4-player-totals-v2' && g.abstentionReason?.includes('no fallback') &&
      !g.qualifiedPaperPick && g.coverage.spread === 0 && g.coverage.total === 0)).toBe(true)
    expect(body.sources).toBeTruthy()
    expect(body.marketInventory).toHaveLength(6)
    expect(body.marketInventory[0].raw.ticker).toBe(body.marketInventory[0].ticker)
    const comparison = res.state.payload as { modelEvidence: { snapshotSha256: string; currentGames: unknown[] };
      games: { challenger: { status: string; forecast: { model: string; expectedTotal: number; totalSd: number };
        comparisonBaseline: { candidates: { ticker: string; side: string; price: number; allInCost: number }[] };
        candidates: { ticker: string; side: string; price: number; allInCost: number }[] };
        forecast: { expectedTotal: number; totalSd: number } }[] }
    expect(comparison.modelEvidence.snapshotSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(comparison.modelEvidence.currentGames).toEqual([])
    for (const game of comparison.games) {
      expect(game.challenger.status).toBe('SHADOW_ONLY')
      expect(game.challenger.forecast.model).toBe('nba-sides-v3')
      expect(game.challenger.forecast.expectedTotal).toBe(game.forecast.expectedTotal)
      expect(game.challenger.forecast.totalSd).toBe(game.forecast.totalSd)
      const quoteKeys = (sides: { ticker: string; side: string; price: number; allInCost: number }[]) =>
        sides.map((side) => [side.ticker, side.side, side.price, side.allInCost]).sort()
      expect(quoteKeys(game.challenger.candidates)).toEqual(quoteKeys(game.challenger.comparisonBaseline.candidates))
    }
    expect(Number.isFinite(Date.parse(body.marketObservedAt))).toBe(true)
    expect(body.games.every((g) => g.inspected.every((item) => Number.isFinite(Date.parse(item.observedAt))) &&
      g.candidates.length === 0)).toBe(true)
    expect(body.games[0].factors).toMatchObject({ injuries: { status: 'unknown' }, starters: { status: 'unknown' },
      contractRules: { status: 'unknown' }, fees: { status: 'unknown' }, depth: { status: 'unknown' }, fillability: { status: 'unknown' } })
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
    vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-10-20T20:00:00Z'))
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
    const body = res.state.payload as { date: string; games: { gameId: string; studySide: { ticker: string } | null; baselineStudySide: { ticker: string } | null }[]; marketInventory: { ticker: string }[] }
    expect(body.date).toBe('2026-10-21')
    expect(body.games.map((g) => g.gameId)).toEqual(['401909834'])
    expect(body.games[0].baselineStudySide?.ticker).toContain('26OCT21ATLORL')
    expect(body.games[0].studySide).toBeNull()
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
  it.skipIf(!/^20\d\d-\d\d-\d\d$/.test(process.env.EDGEBOARD_LIVE_NBA_SCAN ?? ''))('reads a selected future slate without authentication to Kalshi', async () => {
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    const res = response()
    const selectedDate = process.env.EDGEBOARD_LIVE_NBA_SCAN!
    await handler({ method: 'GET', query: { date: selectedDate, quantity: '10' }, headers: { cookie } }, res)
    expect(res.state.code).toBe(200)
    const body = res.state.payload as { currentSeasonFinals: number; historySources: string[]; games: { gameId: string; studySide: { ticker: string } | null;
      coverage: { moneyline: number; spread: number; total: number }; qualifiedPaperPick: boolean;
      forecast: { model: string } | null; factors: Record<string, { status: string }> }[] }
    expect(body.games.length).toBeGreaterThan(0)
    expect(body.currentSeasonFinals).toBeGreaterThan(0)
    expect(body.historySources.some((source) => source.includes('scoreboard?dates=202610&limit=500'))).toBe(true)
    expect(body.games.some((g) => g.forecast?.model === 'nba-scores-v2')).toBe(true)
    const month = new Date(`${selectedDate}T12:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase()
    expect(body.games.every((g) => !g.studySide || g.studySide.ticker.includes(`${selectedDate.slice(2, 4)}${month}${selectedDate.slice(8)}`))).toBe(true)
    expect(body.games.every((g) => !g.qualifiedPaperPick)).toBe(true)
    expect(body.games.every((g) => ['estimated', 'unknown'].includes(g.factors.shotZones.status))).toBe(true)
    const frozen = freezeNbaStudy(res.state.payload as NbaScan, {}, new Date().toISOString())
    expect(frozen.decisions).toHaveLength(body.games.length)
    expect(frozen.decisions.every((decision) => decision.status === 'STUDY')).toBe(true)
    expect(frozen.scan.marketInventory.length).toBeGreaterThan(0)
    console.log('Live read-only NBA selected-date coverage:', body.games.map((g) => ({ id: g.gameId, coverage: g.coverage,
      study: g.studySide?.ticker ?? null })))
  }, 180000)
})
