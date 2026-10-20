import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NbaFreezePanel from './NbaFreezePanel'
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
    render(<NbaFreezePanel scan={null} />)
    const review = screen.getByRole('group', { name: 'Review frozen 401909088' })
    fireEvent.change(within(review).getByLabelText('Settlement outcome'), { target: { value: 'YES' } })
    fireEvent.change(within(review).getByLabelText('Settlement evidence notes'), { target: { value: 'Kalshi contract result shows YES after final score.' } })
    fireEvent.click(within(review).getByRole('button', { name: 'Save settlement review' }))
    expect(JSON.parse(localStorage.getItem('edgeboard-nba-reviews-v1') || '[]')).toHaveLength(1)
    expect(screen.getByText(/simulated net units/)).toBeInTheDocument()
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
    render(<NbaFreezePanel scan={null} />)
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
    expect(screen.getByText(/forced study/i)).toBeInTheDocument()
    const review = screen.getByRole('group', { name: 'Review frozen 401909088' })
    fireEvent.change(within(review).getByLabelText('Settlement outcome'), { target: { value: 'NO' } })
    fireEvent.change(within(review).getByLabelText('Settlement evidence notes'), { target: { value: 'Verified contract resolved NO at settlement.' } })
    fireEvent.click(within(review).getByRole('button', { name: 'Save settlement review' }))
    expect(screen.getByText(/Losses: 1/)).toBeInTheDocument()
    expect(screen.getByText(/Pending: 0/)).toBeInTheDocument()
  })
})
