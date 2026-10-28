import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NbaFreezePanel from './NbaFreezePanel'
import type { NbaCloudLedger } from './nba-cloud-ledger'
import { appendNbaFreeze, freezeNbaStudy, type NbaScan } from './nba-paper'

const now = new Date('2026-10-19T20:00:00Z')
const side = { ticker: 'KXNBAGAME-26OCT20BOSDET-BOS', market: 'moneyline', side: 'yes', line: null,
  probability: .63, price: .51, feeEstimate: .17, allInCost: .527, estimatedNetEdge: .103,
  rules: 'If Boston wins then Yes.', rulesSecondary: 'Postponement beyond 48h can settle fair price.' }
const scan: NbaScan = { date: '2026-10-20', observedAt: '2026-10-19T19:55:00Z', marketObservedAt: '2026-10-19T19:54:00Z', quantity: 10,
  historyObservedAt: '2026-10-06T04:11:37Z', status: 'STUDY_ONLY_NO_QUALIFIED_PICKS',
  sources: { markets: 'https://external-api.kalshi.com/trade-api/v2', schedule: 'https://site.api.espn.com/', feeSchedule: 'https://kalshi.com/docs/kalshi-fee-schedule.pdf' },
  series: [], marketInventory: [{ ticker: side.ticker, raw: { ticker: side.ticker } }],
  games: ['401909088', '401909089', '401909090'].map((gameId, i) => ({ gameId,
    away: ['Boston', 'Philadelphia', 'Oklahoma City'][i], home: ['Detroit', 'New York', 'San Antonio'][i],
    startsAt: '2026-10-20T19:00:00Z', qualifiedPaperPick: false,
    coverage: { moneyline: 2, spread: 0, total: 0 }, studySide: i ? null : side,
    forecast: { model: 'nba-scores-v1' },
    inspected: i ? [] : [{ ticker: side.ticker, observedAt: '2026-10-19T19:54:30Z', source: 'https://kalshi.com/book', book: { orderbook_fp: { no_dollars: [['0.49', '10']] } } }] })) }

describe('NBA opening-slate freeze UI', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(now); localStorage.clear() })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
  it('freezes all three study decisions with raw evidence without pretending they are bets', () => {
    render(<NbaFreezePanel scan={scan} />)
    fireEvent.click(screen.getByRole('button', { name: 'Freeze three-game NBA snapshot' }))
    const saved = JSON.parse(localStorage.getItem('edgeboard-nba-freezes-v1') || '[]')
    expect(saved).toHaveLength(1)
    expect(saved[0].scan.marketInventory[0].raw.ticker).toBe(side.ticker)
    expect(saved[0].scan.games[0].inspected[0].book).toBeTruthy()
    expect(saved[0].decisions.map((d: { status: string }) => d.status)).toEqual(['STUDY', 'STUDY', 'STUDY'])
    expect(screen.getByText(/Frozen NBA scans: 1/)).toBeInTheDocument()
  })
  it('promotes only a fully sourced, explicitly requested paper experiment and preserves other study decisions', () => {
    render(<NbaFreezePanel scan={scan} />)
    const form = screen.getByRole('group', { name: 'Boston @ Detroit paper evidence' })
    fireEvent.click(within(form).getByLabelText('Request paper experiment for Boston @ Detroit'))
    fireEvent.change(within(form).getByLabelText('Availability source URL'), { target: { value: 'https://official.nba.com/injury-report/' } })
    const local = new Date(now.getTime() - 15 * 60_000)
    const localInput = new Date(local.getTime() - local.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    fireEvent.change(within(form).getByLabelText('Availability observed at'), { target: { value: localInput } })
    fireEvent.change(within(form).getByLabelText('Lineup and injury notes'), { target: { value: 'Expected starters checked; no adjustment to score model.' } })
    fireEvent.change(within(form).getByLabelText('Exact contract rules source URL'), { target: { value: 'https://kalshi.com/markets/kxnbagame/' } })
    fireEvent.change(within(form).getByLabelText('Fee schedule source URL'), { target: { value: 'https://kalshi.com/docs/kalshi-fee-schedule.pdf' } })
    fireEvent.change(within(form).getByLabelText('Pregame thesis and risks'), { target: { value: 'Baseline looks favorable at this price, but roster effect remains unknown.' } })
    fireEvent.click(within(form).getByLabelText('I understand the score-only model and fee estimate are unvalidated'))
    fireEvent.click(screen.getByRole('button', { name: 'Freeze three-game NBA snapshot' }))
    const saved = JSON.parse(localStorage.getItem('edgeboard-nba-freezes-v1') || '[]')[0]
    expect(saved.decisions.map((d: { status: string }) => d.status)).toEqual(['PAPER_EXPERIMENT', 'STUDY', 'STUDY'])
    expect(saved.decisions[0].evidence.availabilitySource).toBe('https://official.nba.com/injury-report/')
    expect(screen.getByText(/PAPER EXPERIMENT · 1/)).toBeInTheDocument()
  })
  it('makes the full frozen audit JSON downloadable', () => {
    const create = vi.fn().mockReturnValue('blob:nba-test')
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<NbaFreezePanel scan={scan} />)
    fireEvent.click(screen.getByRole('button', { name: 'Freeze three-game NBA snapshot' }))
    fireEvent.click(screen.getByRole('button', { name: 'Download NBA audit JSON' }))
    expect(create).toHaveBeenCalledWith(expect.any(Blob))
    expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe('edgeboard-nba-paper-audit.json')
  })
  it('reviews an old frozen experiment after tip even when no new scan is available', () => {
    const freeze = freezeNbaStudy(scan, { '401909088': { requestedPaper: true,
      availabilitySource: 'https://official.nba.com/injury-report/', availabilityObservedAt: '2026-10-19T19:45:00Z',
      availabilityNotes: 'Expected starters checked; no numerical impact claimed.', rulesSource: 'https://kalshi.com/markets/kxnbagame/',
      feeSource: 'https://kalshi.com/docs/kalshi-fee-schedule.pdf', uncertaintyAccepted: true,
      rationale: 'Cost gap looks positive in the unvalidated score-only baseline.' } }, now.toISOString())
    appendNbaFreeze(localStorage, freeze)
    vi.setSystemTime(new Date('2026-10-21T04:05:00Z'))
    render(<NbaFreezePanel scan={null} view="history" />)
    fireEvent.click(screen.getByText('Contract & settlement'))
    const review = screen.getByRole('group', { name: 'Review frozen 401909088' })
    fireEvent.change(within(review).getByLabelText('Settlement outcome'), { target: { value: 'YES' } })
    fireEvent.change(within(review).getByLabelText('Settlement evidence notes'), { target: { value: 'Kalshi contract result shows YES after final score.' } })
    fireEvent.click(within(review).getByRole('button', { name: 'Save settlement review' }))
    expect(JSON.parse(localStorage.getItem('edgeboard-nba-reviews-v1') || '[]')).toHaveLength(1)
    expect(screen.getByText(/Net units: \+/)).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('edgeboard-nba-freezes-v1') || '[]')[0]).toEqual(freeze)
  })
  it('offers a winning payout for a frozen NO-side position when the contract resolves NO', () => {
    const noScan: NbaScan = { ...scan, games: scan.games.map((game, index) => index ? game :
      { ...game, studySide: { ...side, side: 'no' } }) }
    appendNbaFreeze(localStorage, freezeNbaStudy(noScan, { '401909088': { requestedPaper: true,
      availabilitySource: 'https://official.nba.com/injury-report/', availabilityObservedAt: '2026-10-19T19:45:00Z',
      availabilityNotes: 'Expected starters checked; no numerical impact claimed.', rulesSource: 'https://kalshi.com/markets/kxnbagame/',
      feeSource: 'https://kalshi.com/docs/kalshi-fee-schedule.pdf', uncertaintyAccepted: true,
      rationale: 'Cost gap looks positive in the unvalidated score-only baseline.' } }, now.toISOString()))
    vi.setSystemTime(new Date('2026-10-21T04:05:00Z'))
    render(<NbaFreezePanel scan={null} view="history" />)
    fireEvent.click(screen.getByText('Contract & settlement'))
    const review = screen.getByRole('group', { name: 'Review frozen 401909088' })
    fireEvent.change(within(review).getByLabelText('Settlement outcome'), { target: { value: 'NO' } })
    fireEvent.change(within(review).getByLabelText('Settlement evidence notes'), { target: { value: 'Contract settled NO, selected NO side wins.' } })
    fireEvent.click(within(review).getByRole('button', { name: 'Save settlement review' }))
    const result = JSON.parse(localStorage.getItem('edgeboard-nba-reviews-v1') || '[]')
    expect(result[0].payout).toBe(1)
    expect(result[0].simulatedNetUnits).toBeGreaterThan(0)
  })
  it('shows requested study in history as pending and lets it be reviewed without calling it qualified', () => {
    const forced = freezeNbaStudy(scan, { '401909088': { requestedPaper: true, availabilitySource: '', availabilityObservedAt: '',
      availabilityNotes: '', rulesSource: '', feeSource: '', uncertaintyAccepted: false, rationale: '' } }, now.toISOString())
    appendNbaFreeze(localStorage, forced)
    vi.setSystemTime(new Date('2026-10-21T04:05:00Z'))
    render(<NbaFreezePanel scan={null} view="history" />)
    expect(screen.getByText(/Pending: 1/)).toBeInTheDocument()
    expect(screen.getByText(/Wins: 0/)).toBeInTheDocument()
    expect(screen.getByText(/Losses: 0/)).toBeInTheDocument()
    expect(screen.getByText(/Study, not qualified/i)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Contract & settlement'))
    const review = screen.getByRole('group', { name: 'Review frozen 401909088' })
    fireEvent.change(within(review).getByLabelText('Settlement outcome'), { target: { value: 'NO' } })
    fireEvent.change(within(review).getByLabelText('Settlement evidence notes'), { target: { value: 'Verified contract resolved NO at settlement.' } })
    fireEvent.click(within(review).getByRole('button', { name: 'Save settlement review' }))
    expect(screen.getByText(/Losses: 1/)).toBeInTheDocument()
    expect(screen.getByText(/Pending: 0/)).toBeInTheDocument()
  })
  it('automatically audits the finalized paper pick with W/L and units, not model advice', async () => {
    const frozen = freezeNbaStudy({ ...scan, games: scan.games.map((game, index) => index ? game : { ...game,
      forecast: { model: 'nba-scores-v1', expectedMargin: -3, expectedTotal: 220 },
      factors: { starters: { status: 'unknown' as const, detail: 'Unconfirmed' } } }) },
    { '401909088': { requestedPaper: true, availabilitySource: '', availabilityObservedAt: '', availabilityNotes: '',
      rulesSource: '', feeSource: '', uncertaintyAccepted: false, rationale: '' } }, now.toISOString())
    appendNbaFreeze(localStorage, frozen)
    vi.setSystemTime(new Date('2026-10-21T04:05:00Z'))
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({
      state: 'finalized', date: '2026-10-20', gameId: '401909088', ticker: side.ticker, result: 'NO', payoutYes: 0,
      observedAt: '2026-10-21T04:00:00Z', scores: { home: 121, away: 113 },
      rulesPrimary: side.rules, rulesSecondary: side.rulesSecondary,
      marketSource: `https://external-api.kalshi.com/trade-api/v2/markets/${side.ticker}`,
      scheduleSource: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261020',
    }) } as Response)
    render(<NbaFreezePanel scan={null} view="history" />)
    fireEvent.click(screen.getByRole('button', { name: 'Audit finished picks' }))
    fireEvent.click(screen.getByText('Contract & settlement'))
    expect(await screen.findByText(/1 audited · 0 pending/)).toBeInTheDocument()
    expect(screen.getByText(/Losses: 1/)).toBeInTheDocument()
    expect(screen.getByText(/Net units: −1.00u/)).toBeInTheDocument()
    expect(screen.getByText(/Boston 113 · Detroit 121/)).toBeInTheDocument()
    expect(screen.queryByText(/Forecast check:|Next-slate learning|What to test next/)).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('edgeboard-nba-audits-v1') ?? '[]')).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem('edgeboard-nba-reviews-v1') ?? '[]')).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining(`/api/nba-audit?date=2026-10-20&gameId=401909088&ticker=${side.ticker}`), expect.objectContaining({ credentials: 'same-origin' }))
    expect(JSON.parse(localStorage.getItem('edgeboard-nba-freezes-v1') ?? '[]')[0]).toEqual(frozen)
  })
  it('keeps a live/unfinalized contract pending and tells the operator to retry', async () => {
    const frozen = freezeNbaStudy(scan, { '401909088': { requestedPaper: true, availabilitySource: '', availabilityObservedAt: '',
      availabilityNotes: '', rulesSource: '', feeSource: '', uncertaintyAccepted: false, rationale: '' } }, now.toISOString())
    appendNbaFreeze(localStorage, frozen)
    vi.setSystemTime(new Date('2026-10-21T04:05:00Z'))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ state: 'pending', reason: 'Kalshi contract not finalized' }) } as Response)
    render(<NbaFreezePanel scan={null} view="history" />)
    fireEvent.click(screen.getByRole('button', { name: 'Audit finished picks' }))
    expect(await screen.findByText(/1 pending.*retry/i)).toBeInTheDocument()
    expect(screen.getByText(/Pending: 1/)).toBeInTheDocument()
    expect(localStorage.getItem('edgeboard-nba-reviews-v1')).toBeNull()
  })
  it('audits baseline and shadow independently and shows paired W/L and net units', async () => {
    const shadow = { ...side, ticker: 'KXNBASPREAD-26OCT20BOSDET-BOS5', market: 'spread', side: 'no', line: 4.5,
      probability: .69, allInCost: .52, estimatedNetEdge: .17,
      rules: 'If Boston wins by more than 4.5 points in the Boston vs Detroit game, then Yes.' }
    const first = { ...scan.games[0], shadowSide: shadow, candidates: [side, shadow],
      inspected: [...scan.games[0].inspected, { ticker: shadow.ticker, observedAt: '2026-10-19T19:54:30Z',
        source: 'https://external-api.kalshi.com/trade-api/v2/markets/KXNBASPREAD-26OCT20BOSDET-BOS5/orderbook', book: {} }] }
    const frozen = freezeNbaStudy({ ...scan, games: [first] }, { [first.gameId]: { requestedPaper: true,
      availabilitySource: '', availabilityObservedAt: '', availabilityNotes: '', rulesSource: '', feeSource: '',
      uncertaintyAccepted: false, rationale: '' } }, now.toISOString())
    appendNbaFreeze(localStorage, frozen)
    vi.setSystemTime(new Date('2026-10-21T04:05:00Z'))
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const ticker = new URL(String(url), 'https://example.org').searchParams.get('ticker')!
      const picked = ticker === shadow.ticker ? shadow : side
      return { ok: true, json: async () => ({ state: 'finalized', date: scan.date, gameId: first.gameId,
        ticker, result: 'NO', payoutYes: 0, observedAt: '2026-10-21T04:00:00Z', scores: { home: 121, away: 113 },
        rulesPrimary: picked.rules, rulesSecondary: picked.rulesSecondary,
        marketSource: `https://external-api.kalshi.com/trade-api/v2/markets/${ticker}`,
        scheduleSource: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261020' }) } as Response
    })
    render(<NbaFreezePanel scan={null} view="history" />)
    fireEvent.click(screen.getByRole('button', { name: 'Audit finished picks' }))
    expect(await screen.findByText(/1 audited · 0 pending/)).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(screen.getByText(/Shadow wins: 1/)).toBeInTheDocument()
    expect(screen.getByText(/Shadow net units: \+0.92u/)).toBeInTheDocument()
    expect(screen.getByText(/Net units: −1.00u/)).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Shadow comparison' })).toBeInTheDocument()
    expect(screen.getByText(/Detroit \+4.5.*Win.*\+0.92u/)).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('edgeboard-nba-audits-v1') ?? '[]')).toHaveLength(2)
    expect(JSON.parse(localStorage.getItem('edgeboard-nba-reviews-v1') ?? '[]')).toHaveLength(1)
  })
  it('shows a grouped board with per-pick status and signed net units for three settled picks', () => {
    const chosen = { requestedPaper: true, availabilitySource: '', availabilityObservedAt: '', availabilityNotes: '',
      rulesSource: '', feeSource: '', uncertaintyAccepted: false, rationale: '' }
    const three = { ...scan, games: scan.games.map((game, index) => ({ ...game, studySide: { ...side,
      ticker: `KXNBAGAME-26OCT20BOSDET-${index}`, side: index === 2 ? 'yes' : 'no' } })) }
    const frozen = freezeNbaStudy(three, Object.fromEntries(three.games.map((game) => [game.gameId, chosen])), now.toISOString())
    const reviews = frozen.decisions.map((decision, index) => ({ id: `${frozen.id}:${decision.gameId}`, scanId: frozen.id,
      gameId: decision.gameId, observedAt: '2026-10-21T04:00:00Z', source: 'https://external-api.kalshi.com/',
      outcome: 'NO' as const, payout: index === 2 ? 0 : 1, note: 'Final settlement observed.',
      simulatedNetUnits: index === 2 ? -1 : (1 - side.allInCost) / side.allInCost,
      entryCostPerContract: side.allInCost, quantity: 10, label: 'SIMULATED_NO_FILL' as const }))
    render(<NbaFreezePanel scan={null} view="history" cloudLedger={{ freezes: [frozen], reviews, audits: [] }} />)
    expect(screen.getByRole('heading', { name: /october 20, 2026/i })).toBeInTheDocument()
    const board = screen.getByRole('table', { name: /paper picks for october 20/i })
    expect(within(board).getAllByRole('row')).toHaveLength(4)
    expect(within(board).getAllByText('Win')).toHaveLength(2)
    expect(within(board).getByText('Loss')).toBeInTheDocument()
    expect(within(board).getAllByText('+0.90u')).toHaveLength(2)
    expect(within(board).getByText('−1.00u')).toBeInTheDocument()
    expect(screen.getByText(/Net units: \+0.80u/)).toBeInTheDocument()
    expect(screen.getByText(/Wins: 2/)).toBeInTheDocument()
    expect(screen.getByText(/Losses: 1/)).toBeInTheDocument()
  })
  it('shows the frozen pregame reference separately from the selected spread and result', () => {
    const pelicans = { ...side, market: 'spread', line: 6.5, side: 'yes',
      ticker: 'KXNBASPREAD-26OCT20INDNOP-NOP7',
      rules: 'If New Orleans wins by more than 6.5 points in the Indiana vs New Orleans game, then Yes.' }
    const line = { homeSpread: 3.5, awaySpread: -3.5, total: 229.5, rawDetails: 'IND -3.5', provider: 'Draft Kings',
      observedAt: '2026-10-19T19:55:00Z', source: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=401909088' }
    const game = { ...scan.games[0], home: 'New Orleans', away: 'Indiana', studySide: pelicans, pregameLine: line }
    const frozen = freezeNbaStudy({ ...scan, games: [game] }, { '401909088': {
      requestedPaper: true, availabilitySource: '', availabilityObservedAt: '', availabilityNotes: '',
      rulesSource: '', feeSource: '', uncertaintyAccepted: false, rationale: '' } }, now.toISOString())
    const review = { id: `${frozen.id}:401909088`, scanId: frozen.id, gameId: '401909088',
      observedAt: '2026-10-21T04:00:00Z', source: 'https://external-api.kalshi.com/',
      outcome: 'NO' as const, payout: 0, note: 'Final settlement.', simulatedNetUnits: -1,
      entryCostPerContract: pelicans.allInCost, quantity: 10, label: 'SIMULATED_NO_FILL' as const }
    render(<NbaFreezePanel scan={null} view="history" cloudLedger={{ freezes: [frozen], reviews: [review], audits: [] }} />)
    const board = screen.getByRole('table', { name: /paper picks for october 20/i })
    expect(within(board).getByRole('columnheader', { name: 'Pregame reference' })).toBeInTheDocument()
    expect(within(board).getByText('New Orleans -6.5')).toBeInTheDocument()
    expect(within(board).getByText(/New Orleans \+3.5/)).toBeInTheDocument()
    expect(within(board).getByText('Draft Kings')).toBeInTheDocument()
    expect(within(board).getByText('−1.00u')).toBeInTheDocument()
  })
  it('labels old freezes with no pregame sportsbook snapshot as not captured', () => {
    const frozen = freezeNbaStudy({ ...scan, games: [scan.games[0]] }, { '401909088': {
      requestedPaper: true, availabilitySource: '', availabilityObservedAt: '', availabilityNotes: '',
      rulesSource: '', feeSource: '', uncertaintyAccepted: false, rationale: '' } }, now.toISOString())
    render(<NbaFreezePanel scan={null} view="history" cloudLedger={{ freezes: [frozen], reviews: [], audits: [] }} />)
    expect(screen.getByText('Not captured before tip')).toBeInTheDocument()
  })
  it('audits three finalized cloud picks and persists their six append-only records without browser writes', async () => {
    const chosen = { requestedPaper: true, availabilitySource: '', availabilityObservedAt: '', availabilityNotes: '',
      rulesSource: '', feeSource: '', uncertaintyAccepted: false, rationale: '' }
    const games = scan.games.map((game, index) => ({ ...game, studySide: { ...side,
      ticker: `KXNBAGAME-26OCT20BOSDET-${index}`, side: index === 2 ? 'yes' : 'no' },
      forecast: { model: 'nba-scores-v1', expectedMargin: -2, expectedTotal: 220 } }))
    const frozen = freezeNbaStudy({ ...scan, games }, Object.fromEntries(games.map((game) => [game.gameId, chosen])), now.toISOString())
    vi.setSystemTime(new Date('2026-10-21T04:05:00Z'))
    const posted: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      if (options?.method === 'POST') {
        const item = JSON.parse(String(options.body)) as { kind: string; record: unknown }
        posted.push(item.kind)
        return { ok: true, json: async () => ({ record: item.record }) } as Response
      }
      const ticker = new URL(String(url), 'https://example.org').searchParams.get('ticker')!
      const game = games.find((item) => item.studySide.ticker === ticker)!
      return { ok: true, json: async () => ({ state: 'finalized', date: scan.date, gameId: game.gameId, ticker,
        result: 'NO', payoutYes: 0, observedAt: '2026-10-21T04:00:00Z', scores: { home: 121, away: 113 },
        rulesPrimary: side.rules, rulesSecondary: side.rulesSecondary,
        marketSource: `https://external-api.kalshi.com/trade-api/v2/markets/${ticker}`,
        scheduleSource: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261020',
      }) } as Response
    })
    function Harness() {
      const [ledger, setLedger] = useState<NbaCloudLedger>({ freezes: [frozen], reviews: [], audits: [] })
      return <NbaFreezePanel scan={null} view="history" cloudLedger={ledger} onCloudChange={setLedger} />
    }
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Audit finished picks' }))
    expect(await screen.findByText(/3 audited · 0 pending/)).toBeInTheDocument()
    expect(posted).toEqual(['review', 'audit', 'review', 'audit', 'review', 'audit'])
    expect(screen.getByText(/Wins: 2/)).toBeInTheDocument()
    expect(screen.getByText(/Losses: 1/)).toBeInTheDocument()
    expect(screen.getByText(/Net units: \+0.80u/)).toBeInTheDocument()
    expect(localStorage.getItem('edgeboard-nba-reviews-v1')).toBeNull()
    expect(localStorage.getItem('edgeboard-nba-audits-v1')).toBeNull()
  })
})
