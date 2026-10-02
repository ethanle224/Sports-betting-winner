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

  it('logs out through the server and returns to the login screen', async () => {
    render(<App />)
    await screen.findByText('A · Value baseline')

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))

    expect(logout).toHaveBeenCalledOnce()
    expect(await screen.findByRole('heading', { name: 'Paper research, locked down.' })).toBeInTheDocument()
  })
})
