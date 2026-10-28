import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NbaResearch from './NbaResearch'
import type { NbaFreeze } from './nba-paper'
const cloudStore = vi.hoisted(() => ({ freezes: [] as NbaFreeze[] }))
vi.mock('./nba-cloud-ledger', async (importOriginal) => {
  const original = await importOriginal<typeof import('./nba-cloud-ledger')>()
  return { ...original, loadNbaCloudLedger: async () => ({ freezes: [...cloudStore.freezes], reviews: [], audits: [] }),
    saveNbaCloudRecord: async (kind: string, record: NbaFreeze) => { if (kind === 'freeze') cloudStore.freezes.push(record); return record } }
})

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
  beforeEach(() => { cloudStore.freezes = []; vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-10-19T12:00:00-07:00')) })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear() })
  it('labels v2 as the main paper selector and shows the old model separately without a second track control', async () => {
    const baseline = pricedScan.games[1].studySide
    const chosen = { ...baseline, probability: 1, estimatedNetEdge: 1 - baseline.allInCost }
    const scores = Array.from({ length: 1000 }, () => ({ home: 110, away: 100, overtimePeriods: 0 }))
    const active = { ...scan, games: [{ ...pricedScan.games[1], selectionPolicy: 'nba-primary-v4-player-totals-v2',
      baselineStudySide: baseline, studySide: chosen, candidates: [chosen], playerTotals: {
        simulation: { version: 'nba-player-totals-v2', status: 'estimated', eligibleForPrimary: true,
          simulations: 1000, scores, totals: scores.map((s) => s.home + s.away), expectedTotal: 210,
          totalSd: 0, inputs: null, assumptions: [], unknowns: [], sources: [] },
        comparison: { status: 'PAPER_ONLY_EXPERIMENT', studySide: chosen, candidates: [chosen],
          baselineCandidates: [baseline], baselineStudySide: baseline } } }] }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true,
      json: async () => String(url).includes('nba-scan') ? active : research }) as Response)
    render(<NbaResearch onLogout={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Scan slate' }))
    expect(await screen.findByText('Player Simulation v2 · main paper model')).toBeInTheDocument()
    expect(screen.getByText('Old score-only model · frozen comparison')).toBeInTheDocument()
    expect(screen.getByText(/v2 simulation chance 100.0%/)).toBeInTheDocument()
    expect(screen.getByText(/New scans use Player Simulation v2/)).toBeInTheDocument()
    expect(screen.getByText(/Old score-only matchup desk: comparison only/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Track .* as paper pick/ })).toHaveLength(1)
    expect(screen.queryByText(/Not promoted to a pick/)).not.toBeInTheDocument()
  })
  it('shows missing player-simulation inputs as unknown without adding a trackable pick', async () => {
    const paused = { ...scan, games: [{ ...scan.games[0], studySide: null,
      playerTotals: { simulation: { status: 'unknown', simulations: 0, reason: 'Need two reconciled box scores per team.',
        unknowns: ['Player paint attempts unavailable.'], assumptions: [], sources: [] },
        comparison: { status: 'SHADOW_ONLY', studySide: null, candidates: [], baselineCandidates: [], baselineStudySide: null } } }] }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true,
      json: async () => String(url).includes('nba-scan') ? paused : research }) as Response)
    render(<NbaResearch onLogout={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Scan slate' }))
    expect(await screen.findByText('Player totals · shadow only')).toBeInTheDocument()
    expect(screen.getByText(/Need two reconciled box scores per team/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Track .* as paper pick/ })).not.toBeInTheDocument()
  })
  it('labels a successful player totals comparison as uncalibrated and keeps it out of tracker controls', async () => {
    const side = { ...pricedScan.games[1].studySide, probability: .64, estimatedNetEdge: .64 - pricedScan.games[1].studySide.allInCost }
    const playerScan = { ...scan, games: [{ ...scan.games[1], studySide: null,
      playerTotals: { simulation: { status: 'estimated', simulations: 1000, expectedTotal: 223.4, totalSd: 19.2,
        seed: 'frozen-input-hash', reason: null, assumptions: ['Recent rotations repeat; injuries not adjusted.'],
        unknowns: ['Player paint attempts unavailable.'], sources: ['https://site.api.espn.com/summary?event=prior'] },
        comparison: { status: 'SHADOW_ONLY', studySide: side, candidates: [side], baselineCandidates: [pricedScan.games[1].studySide], baselineStudySide: pricedScan.games[1].studySide } } }] }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true,
      json: async () => String(url).includes('nba-scan') ? playerScan : research }) as Response)
    render(<NbaResearch onLogout={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Scan slate' }))
    expect(await screen.findByText(/1,000 simulations/)).toBeInTheDocument()
    expect(screen.getByText(/uncalibrated/i)).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Same-quote total estimates' })).toBeInTheDocument()
    expect(screen.getByText(/Player paint attempts unavailable/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Track .* as paper pick/ })).not.toBeInTheDocument()
  })
  it('shows paired score trends and separates highest probability from largest cost gap', async () => {
    const gapSide = { ...pricedScan.games[1].studySide, probability: .64, estimatedNetEdge: .20 }
    const probabilitySide = { ...gapSide, ticker: 'KXNBATOTAL-TEST-239', line: 238.5,
      probability: .80, allInCost: .77, estimatedNetEdge: .03 }
    const scores = Array.from({ length: 1000 }, (_, i) => i < 500
      ? { home: 110, away: 100, overtimePeriods: 0 } : { home: 100, away: 120, overtimePeriods: 0 })
    const expanded = { ...scan, games: [{ ...scan.games[1], studySide: null, playerTotals: {
      simulation: { version: 'nba-player-totals-shadow-v2', status: 'estimated', simulations: 1000,
        expectedTotal: 215, totalSd: 5, scores, totals: scores.map((s) => s.home + s.away),
        inputs: { home: { gameIds: ['h1', 'h2'], scoring: { pointsForPer48: 112.4, pointsAllowedPer48: 109.6 },
          possessions: { per48: 99.1 }, drivers: { mode: 'pace-and-efficiency' },
          players: [{ id: 'p1', name: 'Known Player', meanMinutes: 30, plusMinus: { perGame: 3.5, observedGames: 2 } },
            { id: 'p2', name: 'Unknown Player', meanMinutes: 18, plusMinus: { perGame: null, observedGames: 0 } }] },
        away: { gameIds: ['a1', 'a2'], scoring: { pointsForPer48: 110.2, pointsAllowedPer48: 113.8 },
          possessions: { per48: null }, drivers: { mode: 'scoring-rate-fallback' }, players: [] } },
        assumptions: [], unknowns: [], sources: [] },
      comparison: { status: 'SHADOW_ONLY', studySide: gapSide, candidates: [gapSide, probabilitySide],
        baselineCandidates: [], baselineStudySide: null } } }] }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true,
      json: async () => String(url).includes('nba-scan') ? expanded : research }) as Response)
    render(<NbaResearch onLogout={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Scan slate' }))
    expect(await screen.findByText(/Paired score means: New York 105.0 · Philadelphia 110.0/)).toBeInTheDocument()
    expect(screen.getByText(/Median total 215.0 · central 80% of simulated totals 210.0–220.0/)).toBeInTheDocument()
    expect(screen.getByText(/Highest simulated chance on inspected totals: Under 238.5 · 80.0%/)).toBeInTheDocument()
    expect(screen.getByText('nba-player-totals-shadow-v2')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Current-season simulation inputs' })).toHaveTextContent('112.4')
    expect(screen.getByRole('table', { name: 'Player plus-minus context' })).toHaveTextContent('Known Player')
    const unknownRow = screen.getByText('Unknown Player').closest('tr')!
    expect(within(unknownRow).getByText('unknown')).toBeInTheDocument()
    expect(screen.getByText(/Plus-minus is not individual points allowed/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Track .* as paper pick/ })).not.toBeInTheDocument()
  })
  it('explains a policy abstention without inventing missing books or offering a track button', async () => {
    const paused = { ...scan, games: [{ ...scan.games[0], selectionPolicy: 'nba-primary-v3-sides-paused',
      studySide: null, baselineStudySide: scan.games[0].studySide,
      abstentionReason: 'Primary side-model picks paused pending independent forward validation.' }] }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true,
      json: async () => String(url).includes('nba-scan') ? paused : research }) as Response)
    render(<NbaResearch onLogout={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Scan slate' }))
    expect(await screen.findByText(/Primary side-model picks paused/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Track .* as paper pick/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/No sized book\/model comparison available/)).not.toBeInTheDocument()
  })
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
    expect(within(panel).getAllByText(/Evidence: 0 of 15 checks/)).toHaveLength(3)
    expect(within(panel).getAllByText(/Evidence & gaps/).length).toBeGreaterThanOrEqual(3)
    expect(within(panel).getByText('KXNBAGAME-26OCT20BOSDET-BOS')).toBeInTheDocument()
    expect(within(panel).getAllByRole('button', { name: /Track .* as paper pick · 1u/ })).toHaveLength(3)
    expect(fetcher).toHaveBeenCalledWith('/api/nba-scan?date=2026-10-20&quantity=10', expect.objectContaining({ credentials: 'same-origin' }))
    expect(screen.queryByRole('heading', { name: /No qualified NBA picks yet/i })).not.toBeInTheDocument()
  })
  it('retains a top-study under while showing a separate higher-hit-rate ML shadow, never replacing the track button', async () => {
    const under = pricedScan.games[1].studySide
    const challenger = { ...under, ticker: 'KXNBAGAME-26OCT20PHINYK-NYK',
      market: 'moneyline', line: null, side: 'yes', probability: .68, allInCost: .54, estimatedNetEdge: .14,
      rules: 'If New York wins the Philadelphia vs New York game, then Yes.' }
    const next = { ...pricedScan, games: pricedScan.games.map((item, index) => index === 1 ?
      { ...item, shadowSide: challenger, candidates: [under, challenger] } : item) }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true,
      json: async () => String(url).includes('nba-scan') ? next : research }) as Response)
    render(<NbaResearch onLogout={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Scan slate' }))
    expect(await screen.findByRole('button', { name: 'Track Under 228.5 as paper pick · 1u' })).toBeInTheDocument()
    expect(screen.getByText(/Shadow comparison · New York winner/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Track New York winner/ })).not.toBeInTheDocument()
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
  it('identifies an expired scan session and offers sign-in without showing stale picks', async () => {
    const onLogout = vi.fn(async () => {})
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => String(url).includes('nba-scan') ? { ok: false, status: 401 } as Response :
      { ok: true, json: async () => research } as Response)
    render(<NbaResearch onLogout={onLogout} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Scan slate' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/session expired.*sign in again/i)
    expect(screen.queryByText(/Kalshi scan unavailable/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Track .* as paper pick/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }))
    expect(onLogout).toHaveBeenCalledOnce()
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
    expect(cloudStore.freezes).toHaveLength(1)
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
    expect(await screen.findByText(/No paper picks tracked here/)).toBeInTheDocument()
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
  it('keeps scan evidence while hiding the all-team prior-season and offseason panels', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => research } as Response)
    render(<NbaResearch onLogout={vi.fn()} />)
    expect(await screen.findByRole('button', { name: 'Scan slate' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Upcoming regular-season slate' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'All teams · prior season' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Offseason & availability' })).not.toBeInTheDocument()
    expect(screen.queryByRole('searchbox', { name: 'Find team' })).not.toBeInTheDocument()
  })
  it('tracks a top side with one click and immediately lists one pending 1u pick in history', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-10-07T02:31:00Z'))
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true, json: async () => String(url).includes('nba-scan') ? pricedScan : research }) as Response)
    render(<NbaResearch onLogout={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Scan slate' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Track Detroit +1.5 as paper pick · 1u' }))
    const stored = cloudStore.freezes
    expect(stored).toHaveLength(1)
    expect(stored[0].decisions.filter((decision: { evidence: { requestedPaper: boolean } | null }) => decision.evidence?.requestedPaper)).toHaveLength(1)
    expect(stored[0].decisions[0].selected?.ticker).toBe('KXNBASPREAD-26OCT20BOSDET-BOS2')
    expect(await screen.findByRole('button', { name: 'Detroit +1.5 tracked · see history' })).toBeDisabled()
    fireEvent.click(screen.getByRole('tab', { name: 'Bet history' }))
    expect(screen.getByText('Pending: 1')).toBeInTheDocument()
    expect(screen.getByText('Net units: 0.00u')).toBeInTheDocument()
  })
  it('tracks another paper pick even when legacy localStorage is already at quota', async () => {
    vi.setSystemTime(new Date('2026-10-07T02:31:00Z'))
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true,
      json: async () => String(url).includes('nba-scan') ? pricedScan : research }) as Response)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError') })
    render(<NbaResearch onLogout={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Scan slate' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Track Detroit +1.5 as paper pick · 1u' }))
    expect(await screen.findByRole('button', { name: 'Detroit +1.5 tracked · see history' })).toBeDisabled()
    expect(cloudStore.freezes).toHaveLength(1)
    expect(localStorage.getItem('edgeboard-nba-freezes-v1')).toBeNull()
  })
})
