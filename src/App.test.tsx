import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { getSession, login, logout } from './auth'

vi.mock('./auth', () => ({
  getSession: vi.fn().mockResolvedValue({ authenticated: true, username: 'Admin' }),
  login: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
}))

describe('Edgeboard dashboard', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(getSession).mockResolvedValue({ authenticated: true, username: 'Admin' })
    vi.mocked(login).mockResolvedValue({ ok: true })
    vi.mocked(logout).mockResolvedValue(undefined)
  })

  it('shows three predeclared checklists without fabricated picks', async () => {
    render(<App />)
    expect(await screen.findByText('A · Value baseline')).toBeInTheDocument()
    expect(screen.getByText('B · Independent consensus')).toBeInTheDocument()
    expect(screen.getByText('C · Crowd caution')).toBeInTheDocument()
    expect(screen.getByText('No candidates logged yet.')).toBeInTheDocument()
    expect(screen.getByLabelText('Independent model source / method')).toBeInTheDocument()
    expect(screen.getByLabelText('Model calculated at')).toBeInTheDocument()
  })

  it('scans an NFL day across nine series without inventing a pick', async () => {
    const kinds = ['Game winner', 'Game spread', 'Game total', 'First-half winner', 'First-half spread', 'First-half total', 'Second-half winner', 'Second-half spread', 'Second-half total']
    const payload = { date: '2026-10-04', collectedAt: '2026-10-04T10:00:00Z', coverage: { complete: true, count: 1 },
      series: kinds.map((kind) => ({ ticker: kind.replaceAll(' ', ''), kind, phase: kind.startsWith('Second') ? 'halftime' : 'pregame', count: kind === 'Game winner' ? 1 : 0 })),
      markets: [{ series: 'KXNFLGAME', kind: 'Game winner', phase: 'pregame', gameDate: '2026-10-04', eventTicker: 'KXNFLGAME-26OCT04INDWAS', ticker: 'KXNFLGAME-26OCT04INDWAS-IND', title: 'Indianapolis wins', rules: 'Tie pays $0.50', indicativeAsk: 0.55, indicativeSize: 20 }],
      forecasts: [{ ticker: 'KXNFLGAME-26OCT04INDWAS-IND', status: 'MODELED', reason: 'Experimental only', probabilityYes: 0.58, probabilityNo: 0.4, tieProbability: 0.02, modelVersion: 'sportsbook-score-v2', modelSource: 'Draft Kings via ESPN', trainingGames: 500 }],
      bookmakerLines: [{ home: 'WAS', away: 'IND', homeSpread: 4.5, total: 47.5, provider: 'Draft Kings', eventId: '401', kickoff: '2026-10-04T17:00:00Z', observedAt: '2026-10-02T12:00:00Z' }],
      bookmakerStatus: 'observed', efficiencyStatus: 'refreshed', efficiencySnapshotThrough: '2026-10-01', preseasonStatus: 'observed',
      contexts: [{ event: '26OCT04INDWAS', home: 'WAS', away: 'IND',
        homeForm: { team: 'WAS', currentGames: 3, previousGames: 8, preseasonGames: 2, pointsFor: 25.5, pointsAgainst: 20, weights: { currentRegular: 4, previousRegular: 1, currentPreseason: 0.5 }, probabilityAdjustment: false },
        awayForm: { team: 'IND', currentGames: 3, previousGames: 8, preseasonGames: 2, pointsFor: 28, pointsAgainst: 18, weights: { currentRegular: 4, previousRegular: 1, currentPreseason: 0.5 }, probabilityAdjustment: false },
        context: { snapshotThrough: '2026-10-01', probabilityAdjustment: false,
        home: { team: 'WAS', offense: { epaPerPlay: 0.1, successRate: 0.45, firstDownsPerGame: 20, playsPerGame: 60 }, opposingDefense: { epaPerPlay: -0.02, successRate: 0.43, firstDownsPerGame: 18 } },
        away: { team: 'IND', offense: { epaPerPlay: 0.12, successRate: 0.47, firstDownsPerGame: 21, playsPerGame: 62 }, opposingDefense: { epaPerPlay: 0.03, successRate: 0.42, firstDownsPerGame: 19 } } } }] }
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => payload } as Response)
    render(<App />)
    await screen.findByText('A · Value baseline')
    fireEvent.change(screen.getByLabelText('NFL game date'), { target: { value: '2026-10-04' } })
    fireEvent.click(screen.getByRole('button', { name: 'Scan NFL day' }))
    expect(await screen.findByText(/1 listed contracts/)).toBeInTheDocument()
    fireEvent.click(screen.getByText(/26OCT04INDWAS · 1 contracts/))
    expect(screen.getByText(/Game winner: Indianapolis wins/)).toBeInTheDocument()
    expect(screen.getByText(/experimental YES 58.0%/i)).toBeInTheDocument()
    expect(screen.getByText(/Draft Kings.*47.5/)).toBeInTheDocument()
    expect(screen.getByText(/IND offense.*WAS defense/)).toBeInTheDocument()
    expect(screen.getByText(/first downs\/game/i)).toBeInTheDocument()
    expect(screen.getByText(/success rate.*IND 47%.*WAS allows 42%/i)).toBeInTheDocument()
    expect(screen.getByText(/Efficiency.*refreshed.*2026-10-01/i)).toBeInTheDocument()
    expect(screen.getByText(/current-season-first form.*4×.*0.5× preseason/i)).toBeInTheDocument()
    expect(screen.getByText(/WAS.*3 current.*2 preseason/i)).toBeInTheDocument()
    expect(screen.getByText('Second-half total')).toBeInTheDocument()
    expect(screen.getByText('No candidates logged yet.')).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledWith('/api/nfl-scan?date=2026-10-04&forecast=1', expect.objectContaining({ credentials: 'same-origin' }))
    expect(JSON.parse(localStorage.getItem('edgeboard-nfl-scan-v1') || '[]')).toHaveLength(1)
    fetcher.mockRestore()
  })

  it('records the observed raw orderbook when inspecting a contract', async () => {
    const payload = { date: '2026-10-04', collectedAt: '2026-10-04T10:00:00Z', coverage: { complete: true, count: 1 },
      series: Array.from({ length: 9 }, (_, n) => ({ ticker: `S${n}`, kind: `Market ${n}`, phase: 'pregame', count: n === 0 ? 1 : 0 })),
      markets: [{ series: 'KXNFLGAME', kind: 'Game winner', phase: 'pregame', gameDate: '2026-10-04', eventTicker: 'KXNFLGAME-26OCT04INDWAS', ticker: 'KXNFLGAME-26OCT04INDWAS-IND', title: 'Indianapolis wins', rules: 'Game win', indicativeAsk: 0.55, indicativeSize: 20 }],
      forecasts: [{ ticker: 'KXNFLGAME-26OCT04INDWAS-IND', status: 'UNRATED', reason: 'Insufficient data' }] }
    const book = { ticker: payload.markets[0].ticker, quantity: 40, observedAt: '2026-10-04T10:01:00Z', source: 'Kalshi', raw: { orderbook_fp: { no_dollars: [['0.45', '40.00']] } }, yes: { price: 0.55, estimatedAllIn: 0.57, estimatedFee: 0.2 }, no: null }
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => ({ ok: true, json: async () => String(input).includes('ticker=') ? book : payload }) as Response)
    render(<App />)
    await screen.findByText('A · Value baseline')
    fireEvent.change(screen.getByLabelText('NFL game date'), { target: { value: '2026-10-04' } })
    fireEvent.click(screen.getByRole('button', { name: 'Scan NFL day' }))
    await screen.findByText(/1 listed contracts/)
    fireEvent.click(screen.getByText(/26OCT04INDWAS · 1 contracts/))
    fireEvent.change(screen.getByLabelText('Quote size (whole contracts)'), { target: { value: '40' } })
    fireEvent.click(screen.getByRole('button', { name: 'Inspect book' }))
    expect(await screen.findByText(/57.00¢ estimated all-in/)).toBeInTheDocument()
    expect(screen.getByText(/40 contracts/)).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('quantity=40'), expect.anything())
    expect(JSON.parse(localStorage.getItem('edgeboard-nfl-quotes-v1') || '[]')[0].raw).toEqual(book.raw)
    fetcher.mockRestore()
  })

  it('records one snapshot across all strategies and settles without counting rejected picks', async () => {
    render(<App />)
    await screen.findByText('A · Value baseline')
    fireEvent.change(screen.getByLabelText('Matchup'), { target: { value: 'Blue @ Red' } })
    fireEvent.change(screen.getByLabelText('Exact contract'), { target: { value: 'TEST-GAME' } })
    fireEvent.change(screen.getByLabelText('Side'), { target: { value: 'Red YES' } })
    const quote = new Date(Date.now() - 60_000)
    fireEvent.change(screen.getByLabelText('Quote observed at'), { target: { value: new Date(quote.getTime() - quote.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) } })
    fireEvent.change(screen.getByLabelText('All-in cost per contract (¢)'), { target: { value: '55' } })
    fireEvent.change(screen.getByLabelText('Model win probability (%)'), { target: { value: '64' } })
    fireEvent.change(screen.getByLabelText('Independent model source / method'), { target: { value: 'Independent injury-adjusted forecast v1' } })
    fireEvent.change(screen.getByLabelText('Model calculated at'), { target: { value: new Date(quote.getTime() - quote.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) } })
    fireEvent.change(screen.getByLabelText('Independent probability (%)'), { target: { value: '62' } })
    fireEvent.change(screen.getByLabelText('Independent source'), { target: { value: 'Sharp quote' } })
    fireEvent.change(screen.getByLabelText('Dollar share on our side (%)'), { target: { value: '80' } })
    fireEvent.change(screen.getByLabelText('Dollar split source'), { target: { value: 'Book sample' } })
    for (const label of ['Contract rules checked', 'News checked', 'Depth and fees checked']) {
      fireEvent.click(screen.getByLabelText(label))
    }
    fireEvent.click(screen.getByRole('button', { name: 'Log paper snapshot' }))
    const row = screen.getByRole('row', { name: /Blue @ Red/ })
    expect(within(row).getAllByText('PAPER')).toHaveLength(2)
    expect(within(row).getByText('REJECT')).toBeInTheDocument()
    fireEvent.click(within(row).getByRole('button', { name: 'Mark win' }))
    expect(screen.getByText(/2 eligible strategies/)).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('edgeboard-paper-v1') || '[]')).toHaveLength(1)
  })

  it('restores saved paper snapshots after remount', async () => {
    localStorage.setItem('edgeboard-paper-v1', JSON.stringify([{ id: 'saved', outcome: 'pending', candidate: {
      matchup: 'Saved match', contract: 'SAVED-1', side: 'YES', observedAt: new Date().toISOString(),
      allInCost: 0.55, modelProbability: 0.64, consensusProbability: null, consensusSource: '',
      crowdMoneyPercent: null, crowdSource: '', rulesChecked: true, newsChecked: true, depthChecked: true,
    }, results: [] }]))
    render(<App />)
    expect(await screen.findByText('Saved match')).toBeInTheDocument()
  })

  it('stakes half a unit, freezes 22 whole contracts and accounts for the real paper exposure', async () => {
    render(<App />)
    await screen.findByText('A · Value baseline')
    fireEvent.change(screen.getByLabelText('Matchup'), { target: { value: 'Blue @ Red' } })
    fireEvent.change(screen.getByLabelText('Exact contract'), { target: { value: 'TEST-GAME' } })
    fireEvent.change(screen.getByLabelText('Side'), { target: { value: 'Red YES' } })
    const quote = new Date(Date.now() - 60_000)
    fireEvent.change(screen.getByLabelText('Quote observed at'), { target: { value: new Date(quote.getTime() - quote.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) } })
    fireEvent.change(screen.getByLabelText('All-in cost per contract (¢)'), { target: { value: '55' } })
    fireEvent.change(screen.getByLabelText('Model win probability (%)'), { target: { value: '64' } })
    fireEvent.change(screen.getByLabelText('Independent model source / method'), { target: { value: 'Independent injury-adjusted forecast v1' } })
    fireEvent.change(screen.getByLabelText('Model calculated at'), { target: { value: new Date(quote.getTime() - quote.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) } })
    fireEvent.change(screen.getByLabelText('Units (0.00–2.00)'), { target: { value: '0.50' } })
    for (const label of ['Contract rules checked', 'News checked', 'Depth and fees checked']) fireEvent.click(screen.getByLabelText(label))
    fireEvent.click(screen.getByRole('button', { name: 'Log paper snapshot' }))
    const row = screen.getByRole('row', { name: /Blue @ Red/ })
    expect(within(row).getByText(/0.50 units · 22 contracts · \$12.10 staked/)).toBeInTheDocument()
    fireEvent.click(within(row).getByRole('button', { name: 'Mark win' }))
    expect(screen.getByText('+$9.90')).toBeInTheDocument()
    const saved = JSON.parse(localStorage.getItem('edgeboard-paper-v1') || '[]')
    expect(saved[0].contracts).toBe(22)
    expect(saved[0].candidate.units).toBe(0.5)
  })

  it('preserves ten-contract accounting for previously saved paper entries', async () => {
    localStorage.setItem('edgeboard-paper-v1', JSON.stringify([{ id: 'old', outcome: 'win', candidate: {
      matchup: 'Legacy match', contract: 'OLD-1', side: 'YES', observedAt: new Date().toISOString(),
      allInCost: 0.55, modelProbability: 0.64, consensusProbability: null, consensusSource: '',
      crowdMoneyPercent: null, crowdSource: '', rulesChecked: true, newsChecked: true, depthChecked: true,
    }, results: [{ id: 'value', status: 'PAPER', reasons: [], payoutMultiple: 1 / 0.55 }] }]))
    render(<App />)
    expect(await screen.findByText('Legacy match')).toBeInTheDocument()
    expect(screen.getByText('+$4.50')).toBeInTheDocument()
  })

  it('logs out through the server and returns to the login screen', async () => {
    render(<App />)
    await screen.findByText('A · Value baseline')

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))

    expect(logout).toHaveBeenCalledOnce()
    expect(await screen.findByRole('heading', { name: 'Paper research, locked down.' })).toBeInTheDocument()
  })
})
