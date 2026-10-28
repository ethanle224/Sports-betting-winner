import { render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import NbaHistoryBoard from './NbaHistoryBoard'

it('labels frozen model versions without relabeling old picks as v2', () => {
  // Presentation fixtures only; no quotes, settlement or model evidence is fetched.
  const entries = ['nba-primary-v4-player-totals-v2', 'nba-primary-v3-sides-paused'].map((selectionPolicy, i) => {
    const gameId = `g${i}`
    const selected = { ticker: `TOTAL-${i}`, market: 'total', side: 'no', line: 228.5,
      probability: .6, price: .5, feeEstimate: 0, allInCost: .5, estimatedNetEdge: .1,
      rules: 'Fixture rule', rulesSecondary: 'Fixture settlement' }
    return { freeze: { id: `freeze-${i}`, scan: { date: '2026-10-28', games: [{ gameId,
      home: 'Home', away: 'Away', selectionPolicy, studySide: selected }] } },
    decision: { gameId, selected, status: 'STUDY', shadow: null }, review: null }
  })
  render(<NbaHistoryBoard entries={JSON.parse(JSON.stringify(entries))} audits={[]} notices={{}} renderReview={() => null} />)
  expect(screen.getByRole('columnheader', { name: 'Model' })).toBeInTheDocument()
  const first = screen.getByText('Player Simulation v2').closest('tr')!
  const second = screen.getByText('Old score-only / legacy').closest('tr')!
  expect(within(first).getByText('Pending')).toBeInTheDocument()
  expect(within(second).getByText('Pending')).toBeInTheDocument()
  expect(screen.getAllByRole('row')).toHaveLength(3)
})
