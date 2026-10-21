import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NbaResearch from './NbaResearch'

const research = { date: '2026-10-20', observedAt: '2026-10-06T04:00:00Z', priorSeason: '2025-26', teams: [], games: [],
  sources: { standings: 'https://site.api.espn.com/standings', schedule: 'https://site.api.espn.com/scoreboard' },
  ratingsStatus: 'unavailable', forecastStatus: 'not modeled' }
const game = (id: string, away: string, home: string, ticker: string) => ({ gameId: id, away, home,
  startsAt: '2026-10-20T19:00:00Z', forecast: { model: 'nba-scores-v1' }, inspected: [],
  coverage: { moneyline: 2, spread: 0, total: 0 }, pricedSides: 4, qualifiedPaperPick: false,
  studySide: { ticker, market: 'moneyline', side: 'yes', probability: 0.56, price: 0.51,
    feeEstimate: 0.17, allInCost: 0.527, estimatedNetEdge: 0.033, rules: 'If Boston wins, YES.',
    rulesSecondary: 'Otherwise fair price.', line: null },
  checklist: { mappedGame: true, modelScoreOnly: true, injuryLineupVerified: false,
    rulesVerified: false, feeVerified: false, executableDepthInspected: true, settlementFairPriceRisk: true } })
const scan = { date: '2026-10-20', quantity: 10, observedAt: '2026-10-07T02:30:00Z', historyObservedAt: '2026-10-06T04:11:37Z',
  marketObservedAt: '2026-10-07T02:29:00Z',
  marketInventory: [], status: 'STUDY_ONLY_NO_QUALIFIED_PICKS',
  sources: { markets: 'https://external-api.kalshi.com/trade-api/v2', schedule: 'https://site.api.espn.com/scoreboard', feeSchedule: 'https://kalshi.com/docs/kalshi-fee-schedule.pdf' },
  series: [], games: [game('401909088', 'Boston', 'Detroit', 'KXNBAGAME-26OCT20BOSDET-BOS'),
    game('401909089', 'Philadelphia', 'New York', 'KXNBAGAME-26OCT20PHINYK-PHI'),
    game('401909090', 'Oklahoma City', 'San Antonio', 'KXNBAGAME-26OCT20OKCSAS-SAS')] }

const pricedScan = { ...scan, games: scan.games.map((item, index) => {
  const choice = index === 0 ? { ticker: 'KXNBASPREAD-26OCT20BOSDET-BOS2', market: 'spread', side: 'no', line: 1.5,
    probability: .603, price: .51, feeEstimate: .175, allInCost: .5275, estimatedNetEdge: .0755,
    rules: 'If Boston wins by more than 1.5 points in the Boston vs Detroit game, then Yes.', rulesSecondary: 'Postponed games may settle fair price.' }
    : index === 1 ? { ticker: 'KXNBATOTAL-26OCT20PHINYK-229', market: 'total', side: 'no', line: 228.5,
      probability: .551, price: .42, feeEstimate: .1706, allInCost: .43706, estimatedNetEdge: .11394,
      rules: 'If over 228.5 total points are scored in the Philadelphia vs New York game, then Yes.', rulesSecondary: 'Postponed games may settle fair price.' }
      : { ticker: 'KXNBASPREAD-26OCT20OKCSAS-SAS5', market: 'spread', side: 'yes', line: 4.5,
        probability: .502, price: .41, feeEstimate: .1694, allInCost: .42694, estimatedNetEdge: .07506,
        rules: 'If San Antonio wins by more than 4.5 points in the Oklahoma City vs San Antonio game, then Yes.', rulesSecondary: 'Postponed games may settle fair price.' }
  return { ...item, studySide: choice, ...(index === 0 ? { factors: {
    injuries: { status: 'reported', detail: '1 dated ESPN listing; not official clearance.', source: 'https://site.api.espn.com/injuries', observedAt: scan.observedAt,
      players: [{ team: 'Detroit', name: 'Player A', status: 'Out', reportedAt: scan.observedAt }] },
    starters: { status: 'unknown', detail: 'Confirmed starters unavailable.' },
    pace: { status: 'estimated', detail: 'Rough 2025–26 possessions per game.' },
    threes: { status: 'verified', detail: '2025–26 threes per game.' },
    fees: { status: 'estimated', detail: 'General taker fee formula, not confirmed.' },
    fillability: { status: 'unknown', detail: 'No guaranteed fill.' },
  } } : {}),
    inspected: [{ ticker: choice.ticker, observedAt: '2026-10-07T02:29:30Z', source: 'https://kalshi.com/book', book: { orderbook_fp: { no_dollars: [['0.49', '10']] } } }],
    candidates: [choice, { ...choice, ticker: `${choice.ticker}-ALT`, side: choice.side === 'yes' ? 'no' : 'yes', estimatedNetEdge: -.02 }] }
}) }

describe('October 20 NBA Kalshi checklist', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-10-19T12:00:00-07:00')) })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear() })
  it('defaults the scan date to tomorrow and sends the chosen date to the same scan route', async () => {
    vi.setSystemTime(new Date('2026-10-20T12:00:00-07:00'))
    const next = { ...scan, date: '2026-10-21', games: [{ ...scan.games[0], gameId: '401909834', startsAt: '2026-10-21T23:00:00Z', away: 'Atlanta', home: 'Orlando', studySide: null }] }
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true, json: async () =>
      String(url).includes('nba-scan') ? next : research }) as Response)
    render(<NbaResearch onLogout={vi.fn()} />)
    const picker = screen.getByLabelText('Scan game date') as HTMLInputElement
    expect(picker.value).toBe('2026-10-21')
    fireEvent.click(screen.getByRole('button', { name: 'Scan slate' }))
    expect(await screen.findByRole('heading', { name: 'Atlanta @ Orlando' })).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledWith('/api/nba-scan?date=2026-10-21&quantity=10', expect.objectContaining({ credentials: 'same-origin' }))
    fireEvent.change(picker, { target: { value: '2026-10-22' } })
    expect(screen.queryByRole('heading', { name: 'Atlanta @ Orlando' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Scan slate' }))
    expect(fetcher).toHaveBeenCalledWith('/api/nba-scan?date=2026-10-22&quantity=10', expect.objectContaining({ credentials: 'same-origin' }))
  })
  it('discards an in-flight scan when its date is changed and changed back', async () => {
    let resolveScan!: (response: Response) => void
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => String(url).includes('nba-scan') ?
      new Promise<Response>((resolve) => { resolveScan = resolve }) : { ok: true, json: async () => research } as Response)
    render(<NbaResearch onLogout={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Scan slate' }))
    const picker = screen.getByLabelText('Scan game date')
    fireEvent.change(picker, { target: { value: '2026-10-21' } })
    fireEvent.change(picker, { target: { value: '2026-10-20' } })
    await act(async () => resolveScan({ ok: true, json: async () => scan } as Response))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Scan slate' })).toBeEnabled())
    expect(screen.queryByRole('heading', { name: 'Boston @ Detroit' })).not.toBeInTheDocument()
  })
  it('shows an opt-in read-only scan with three study sides, missing spread/total markets and pending gates', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true, json: async () => String(url).includes('nba-scan') ? scan : research }) as Response)
    render(<NbaResearch onLogout={vi.fn()} />)
    const button = await screen.findByRole('button', { name: 'Scan slate' })
    fireEvent.click(button)
    const panel = await screen.findByRole('region', { name: 'NBA slate study checklist' })
    expect(within(panel).getAllByText(/Study side · not a qualified bet/)).toHaveLength(3)
    expect(within(panel).getAllByText(/Spread: 0.*Total: 0/)).toHaveLength(3)
    expect(within(panel).getAllByText(/Evidence: 0 of 13 checks/)).toHaveLength(3)
    expect(within(panel).getAllByText(/Evidence & gaps/).length).toBeGreaterThanOrEqual(3)
    expect(within(panel).getByText('KXNBAGAME-26OCT20BOSDET-BOS')).toBeInTheDocument()
    expect(within(panel).getAllByRole('button', { name: /Track .* as paper pick · 1u/ })).toHaveLength(3)
    expect(fetcher).toHaveBeenCalledWith('/api/nba-scan?date=2026-10-20&quantity=10', expect.objectContaining({ credentials: 'same-origin' }))
    expect(screen.queryByRole('heading', { name: /No qualified NBA picks yet/i })).not.toBeInTheDocument()
  })
  it('does not show a stale study side when the Kalshi scan fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => String(url).includes('nba-scan') ? { ok: false, status: 502 } as Response :
      { ok: true, json: async () => research } as Response)
    render(<NbaResearch onLogout={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Scan slate' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Kalshi scan unavailable/)
    expect(screen.queryByText(/Study side · not a qualified bet/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Track .* as paper pick/ })).not.toBeInTheDocument()
  })
  it('keeps an already-tracked game disabled across rescans without an extra freeze step', async () => {
    let scans = 0
    vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-10-07T02:31:00Z'))
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true,
      json: async () => String(url).includes('nba-scan') ? { ...pricedScan, observedAt: scans++ ? '2026-10-07T02:30:30Z' : pricedScan.observedAt } : research }) as Response)
    render(<NbaResearch onLogout={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Scan slate' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Track Detroit +1.5 as paper pick · 1u' }))
    fireEvent.click(screen.getByRole('button', { name: 'Scan slate' }))
    expect(await screen.findByRole('button', { name: 'Detroit +1.5 tracked · see history' })).toBeDisabled()
    expect(JSON.parse(localStorage.getItem('edgeboard-nba-freezes-v1') || '[]')).toHaveLength(1)
  })
  it('shows each inspected priced option in plain language with expandable reasoning and honest qualification', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true, json: async () => String(url).includes('nba-scan') ? pricedScan : research }) as Response)
    render(<NbaResearch onLogout={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Scan slate' }))
    const panel = await screen.findByRole('region', { name: 'NBA slate study checklist' })
    expect(within(panel).getByText('Detroit +1.5')).toBeInTheDocument()
    expect(within(panel).getByText('Under 228.5')).toBeInTheDocument()
    expect(within(panel).getByText('San Antonio -4.5')).toBeInTheDocument()
    expect(within(panel).getAllByText(/2 priced options inspected/)).toHaveLength(3)
    expect(within(panel).getAllByText(/Not qualified/i).length).toBeGreaterThan(0)
    const details = within(panel).getAllByText(/Why this side|Reasoning & risks/i)[0]
    fireEvent.click(details)
    expect(within(panel).getAllByText(/score-only probability minus estimated all-in cost/i).length).toBeGreaterThan(0)
    expect(within(panel).getAllByText(/Other priced options/)).toHaveLength(3)
    expect(within(panel).getByRole('button', { name: 'Track Detroit +1.5 as paper pick · 1u' })).toBeEnabled()
  })
  it('shows sourced per-game reported, verified, estimated and unknown factors without calling the study qualified', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true, json: async () => String(url).includes('nba-scan') ? pricedScan : research }) as Response)
    render(<NbaResearch onLogout={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Scan slate' }))
    const panel = await screen.findByRole('region', { name: 'NBA slate study checklist' })
    const firstCard = within(panel).getByText('Detroit +1.5').closest('article')!
    fireEvent.click(within(firstCard).getByText('Evidence & gaps'))
    expect(within(firstCard).getByText(/Player A — Out/)).toBeInTheDocument()
    expect(within(firstCard).getByText(/Three-point profile.*Verified/i)).toBeInTheDocument()
    expect(within(firstCard).getByText(/Pace proxy.*Estimated/i)).toBeInTheDocument()
    expect(within(firstCard).getByText(/Final fillability.*Unknown/i)).toBeInTheDocument()
    expect(within(firstCard).getByRole('link', { name: 'Injury source' })).toHaveAttribute('href', 'https://site.api.espn.com/injuries')
    expect(within(panel).getAllByText(/not a qualified bet/i).length).toBeGreaterThan(0)
    expect(within(panel).queryByText(/Still unverified: injuries, starters, roster-adjusted matchup/)).not.toBeInTheDocument()
  })
  it('still shows matchup evidence when no priced side is available', async () => {
    const unpriced = { ...pricedScan, games: pricedScan.games.map((item, index) => index === 0 ? { ...item, studySide: null } : item) }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true,
      json: async () => String(url).includes('nba-scan') ? unpriced : research }) as Response)
    render(<NbaResearch onLogout={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Scan slate' }))
    const first = (await screen.findByRole('heading', { name: 'Boston @ Detroit' })).closest('article')!
    expect(within(first).getByText('Evidence & gaps')).toBeInTheDocument()
    expect(within(first).getByText(/No sized book\/model comparison available/)).toBeInTheDocument()
    expect(within(first).queryByRole('button', { name: /Track .* paper pick/ })).not.toBeInTheDocument()
  })
  it('switches to an NBA-only bet history tab even without a current scan', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => research } as Response)
    render(<NbaResearch onLogout={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Bet history' }))
    expect(screen.getByText(/No paper picks tracked yet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Scan slate' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Scan & choices' }))
    expect(await screen.findByRole('button', { name: 'Scan slate' })).toBeInTheDocument()
  })
  it('puts scan and history controls before the long research desk instead of burying them', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => research } as Response)
    render(<NbaResearch onLogout={vi.fn()} />)
    const scanButton = screen.getByRole('button', { name: 'Scan slate' })
    const historyTab = screen.getByRole('tab', { name: 'Bet history' })
    const desk = screen.getByRole('heading', { name: 'Upcoming regular-season slate' })
    const brand = screen.getByRole('link', { name: 'Edgeboard NBA home' })
    expect(historyTab.compareDocumentPosition(brand) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(scanButton.compareDocumentPosition(desk) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(historyTab.compareDocumentPosition(desk) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('No qualified NBA picks yet')).not.toBeInTheDocument()
  })
  it('tracks a top side with one click and immediately lists one pending 1u pick in history', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-10-07T02:31:00Z'))
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true, json: async () => String(url).includes('nba-scan') ? pricedScan : research }) as Response)
    render(<NbaResearch onLogout={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Scan slate' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Track Detroit +1.5 as paper pick · 1u' }))
    const stored = JSON.parse(localStorage.getItem('edgeboard-nba-freezes-v1') || '[]')
    expect(stored).toHaveLength(1)
    expect(stored[0].decisions.filter((decision: { evidence: { requestedPaper: boolean } | null }) => decision.evidence?.requestedPaper)).toHaveLength(1)
    expect(stored[0].decisions[0].selected.ticker).toBe('KXNBASPREAD-26OCT20BOSDET-BOS2')
    expect(screen.getByRole('button', { name: 'Detroit +1.5 tracked · see history' })).toBeDisabled()
    fireEvent.click(screen.getByRole('tab', { name: 'Bet history' }))
    expect(screen.getByText('Pending: 1')).toBeInTheDocument()
    expect(screen.getByText('Simulated net units: 0.000')).toBeInTheDocument()
  })
})
