import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  return { ...item, studySide: choice,
    inspected: [{ ticker: choice.ticker, observedAt: '2026-10-07T02:29:30Z', source: 'https://kalshi.com/book', book: { orderbook_fp: { no_dollars: [['0.49', '10']] } } }],
    candidates: [choice, { ...choice, ticker: `${choice.ticker}-ALT`, side: choice.side === 'yes' ? 'no' : 'yes', estimatedNetEdge: -.02 }] }
}) }

describe('October 20 NBA Kalshi checklist', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear() })
  it('shows an opt-in read-only scan with three study sides, missing spread/total markets and pending gates', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true, json: async () => String(url).includes('nba-scan') ? scan : research }) as Response)
    render(<NbaResearch onLogout={vi.fn()} />)
    const button = await screen.findByRole('button', { name: 'Scan Kalshi opening slate' })
    fireEvent.click(button)
    const panel = await screen.findByRole('region', { name: 'October 20 Kalshi study checklist' })
    expect(within(panel).getAllByText(/Study side · not a qualified bet/)).toHaveLength(3)
    expect(within(panel).getAllByText(/Spread: 0.*Total: 0/)).toHaveLength(3)
    expect(within(panel).getAllByText(/injury.*lineup.*unverified/i)).toHaveLength(3)
    expect(within(panel).getAllByText(/fee.*unverified/i)).toHaveLength(3)
    expect(within(panel).getByText('KXNBAGAME-26OCT20BOSDET-BOS')).toBeInTheDocument()
    expect(within(panel).getAllByRole('button', { name: /Track .* as paper pick · 1u/ })).toHaveLength(3)
    expect(fetcher).toHaveBeenCalledWith('/api/nba-scan?date=2026-10-20&quantity=10', expect.objectContaining({ credentials: 'same-origin' }))
    expect(screen.queryByRole('heading', { name: /No qualified NBA picks yet/i })).not.toBeInTheDocument()
  })
  it('does not show a stale study side when the Kalshi scan fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => String(url).includes('nba-scan') ? { ok: false, status: 502 } as Response :
      { ok: true, json: async () => research } as Response)
    render(<NbaResearch onLogout={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Scan Kalshi opening slate' }))
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
    fireEvent.click(await screen.findByRole('button', { name: 'Scan Kalshi opening slate' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Track Detroit +1.5 as paper pick · 1u' }))
    fireEvent.click(screen.getByRole('button', { name: 'Scan Kalshi opening slate' }))
    expect(await screen.findByRole('button', { name: 'Detroit +1.5 tracked · see history' })).toBeDisabled()
    expect(JSON.parse(localStorage.getItem('edgeboard-nba-freezes-v1') || '[]')).toHaveLength(1)
  })
  it('shows each inspected priced option in plain language with expandable reasoning and honest qualification', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true, json: async () => String(url).includes('nba-scan') ? pricedScan : research }) as Response)
    render(<NbaResearch onLogout={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Scan Kalshi opening slate' }))
    const panel = await screen.findByRole('region', { name: 'October 20 Kalshi study checklist' })
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
  it('switches to an NBA-only bet history tab even without a current scan', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => research } as Response)
    render(<NbaResearch onLogout={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Bet history' }))
    expect(screen.getByText(/No paper picks tracked yet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Scan Kalshi opening slate' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Scan & choices' }))
    expect(await screen.findByRole('button', { name: 'Scan Kalshi opening slate' })).toBeInTheDocument()
  })
  it('puts scan and history controls before the long research desk instead of burying them', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => research } as Response)
    render(<NbaResearch onLogout={vi.fn()} />)
    const scanButton = screen.getByRole('button', { name: 'Scan Kalshi opening slate' })
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
    fireEvent.click(await screen.findByRole('button', { name: 'Scan Kalshi opening slate' }))
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
