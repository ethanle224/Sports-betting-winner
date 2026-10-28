import { describe, expect, it } from 'vitest'
import { freezeNbaStudy, trackNbaPick, type NbaEvidence, type NbaScan, type NbaStudySide } from './nba-paper'
import type { NbaPlayerTotalsResult } from '../server/nba-player-totals'
import { compareNbaPlayerTotals, type NbaPricedCandidate } from '../server/nba-kalshi'
import { applyNbaPlayerSelectionPolicy, NBA_PLAYER_SELECTION_POLICY, NBA_SELECTION_POLICY } from '../server/nba-policy'
import { pricedNbaSide } from '../server/nba-kalshi'

const side = { ticker: 'TOTAL-229', market: 'total', side: 'no', line: 228.5,
  probability: .6, price: .5, feeEstimate: .175, allInCost: .5175, estimatedNetEdge: .0825,
  rules: 'If over 228.5 total points then Yes.', rulesSecondary: 'Postponed game may settle fair price.' }
function scan(): NbaScan {
  return { date: '2026-10-20', observedAt: '2026-10-19T19:55:00Z', marketObservedAt: '2026-10-19T19:54:00Z',
    quantity: 10, historyObservedAt: '2026-10-19T19:53:00Z', status: 'STUDY_ONLY_NO_QUALIFIED_PICKS',
    sources: { markets: 'https://kalshi.com' }, marketInventory: [], series: [], games: [{
      gameId: 'g1', home: 'Boston', away: 'Detroit', startsAt: '2026-10-20T23:00:00Z',
      selectionPolicy: NBA_SELECTION_POLICY, baselineStudySide: { ...side }, studySide: { ...side }, qualifiedPaperPick: false,
      coverage: { moneyline: 0, spread: 0, total: 1 }, forecast: { model: 'nba-scores-v2' },
      inspected: [{ ticker: side.ticker, book: { observed: true }, source: 'https://kalshi.com', observedAt: '2026-10-19T19:54:30Z' }] }] }
}
const now = '2026-10-19T20:00:00Z'
const evidence: NbaEvidence = { requestedPaper: true, availabilitySource: 'https://nba.com/injuries',
  availabilityObservedAt: '2026-10-19T19:50:00Z', availabilityNotes: 'Verified pregame availability and lineup reports.',
  rulesSource: 'https://kalshi.com/rules', feeSource: 'https://kalshi.com/fees', uncertaintyAccepted: true,
  rationale: 'Forward paper research only; score model uncertainty accepted.' }
const invalidTotals: { label: string; changed: Partial<NbaStudySide> }[] = [
  { label: 'null line', changed: { line: null } },
  { label: 'integer line', changed: { line: 228 } },
  { label: 'NaN line', changed: { line: NaN } },
  { label: 'infinite line', changed: { line: Infinity } },
  { label: 'inconsistent probability/cost edge', changed: { estimatedNetEdge: .2 } },
  { label: 'invalid probability', changed: { probability: NaN } },
  { label: 'missing rule text', changed: { rulesSecondary: '' } },
  { label: 'invalid contract side', changed: { side: 'maybe' } },
  { label: 'zero price', changed: { price: 0 } },
  { label: 'unit price', changed: { price: 1 } },
  { label: 'NaN price', changed: { price: NaN } },
  { label: 'infinite price', changed: { price: Infinity } },
  { label: 'negative fee', changed: { feeEstimate: -.01 } },
  { label: 'NaN fee', changed: { feeEstimate: NaN } },
  { label: 'infinite fee', changed: { feeEstimate: Infinity } },
  { label: 'zero fee inconsistent with all-in cost', changed: { feeEstimate: 0 } },
  { label: 'higher fee inconsistent with all-in cost', changed: { feeEstimate: 2 } },
  { label: 'higher price inconsistent with all-in cost', changed: { price: .9 } },
  { label: 'all-in cost inconsistent with quote despite a matching edge', changed: { allInCost: .5275, estimatedNetEdge: .0725 } },
]

const playerScan = (): NbaScan => {
  const input = scan(); const game = input.games[0]
  const simulation: NbaPlayerTotalsResult = { version: 'nba-player-totals-v2', status: 'estimated', eligibleForPrimary: true,
    simulations: 1000, totals: Array(1000).fill(220), scores: Array.from({ length: 1000 }, () => ({ home: 120, away: 100, overtimePeriods: 0 })),
    observedAt: input.observedAt, asOfCutoff: null, seed: 'frozen-test', sources: [], assumptions: [], unknowns: [], reason: null,
    reasons: [], expectedTotal: 220, totalSd: 0, inputs: null }
  const policy = applyNbaPlayerSelectionPolicy([side], simulation, 10)
  game.selectionPolicy = NBA_PLAYER_SELECTION_POLICY
  game.forecast = null
  game.studySide = policy.studySide
  game.candidates = policy.candidates
  game.baselinePolicyStudySide = { ...side }
  game.playerTotals = { simulation, comparison: { ...compareNbaPlayerTotals([side as NbaPricedCandidate], () => 1, 'main'),
    candidates: policy.candidates as NbaPricedCandidate[], studySide: policy.studySide as NbaPricedCandidate } }
  game.inspected[0].book = { orderbook_fp: { yes_dollars: [['0.50', '100.00']] } }
  input.marketInventory = [{ ticker: side.ticker, gameId: 'g1', kind: 'total', line: side.line,
    rules_primary: side.rules, rules_secondary: side.rulesSecondary }]
  return input
}

describe('player v2 primary freeze and tracking', () => {
  it('tracks the recomputed v2 total without a baseline forecast and freezes full comparison immutably', () => {
    const input = playerScan()
    const frozen = freezeNbaStudy(input, { g1: evidence }, now)
    expect(frozen.decisions[0]).toMatchObject({ status: 'PAPER_EXPERIMENT', selected: { probability: 1 }, shadow: null })
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
    const tracked = trackNbaPick(storage, input, 'g1', now)
    expect(tracked.decisions[0].selected).toEqual(input.games[0].studySide)
    expect(() => trackNbaPick(storage, input, 'g1', now)).toThrow(/Already tracking/)
    input.games[0].playerTotals!.simulation.totals[0] = 999
    input.games[0].playerTotals!.comparison.baselineCandidates[0].probability = .1
    expect(frozen.scan.games[0].playerTotals!.simulation.totals[0]).toBe(220)
    expect(tracked.scan.games[0].playerTotals!.comparison.baselineCandidates[0].probability).toBe(.6)
  })
  it('rejects deleting an executable baseline total to turn a positive main pick into abstention', () => {
    const input = playerScan(); const game = input.games[0]
    game.studySide = null; game.candidates = []
    game.playerTotals!.comparison.baselineCandidates = []
    game.playerTotals!.comparison.candidates = []
    game.playerTotals!.comparison.studySide = null
    expect(() => freezeNbaStudy(input, {}, now)).toThrow(/selection policy/)
  })
  it.each(['probability', 'cost', 'model', 'missing evidence', 'zero gap', 'candidate', 'rules', 'book', 'stale model'])('rejects %s tampering before freeze or storage writes', (kind) => {
    const input = playerScan(); const game = input.games[0]
    if (kind === 'probability') { game.studySide!.probability = .9; game.studySide!.estimatedNetEdge = .9 - game.studySide!.allInCost }
    if (kind === 'cost') { game.studySide!.price = .4; game.studySide!.allInCost = .4175; game.studySide!.estimatedNetEdge = 1 - .4175 }
    if (kind === 'model') game.playerTotals!.simulation.version = 'nba-player-totals-shadow-v2'
    if (kind === 'missing evidence') game.playerTotals = null
    if (kind === 'zero gap') { game.playerTotals!.simulation.totals.fill(230); game.playerTotals!.simulation.scores.fill({ home: 120, away: 110, overtimePeriods: 0 }) }
    if (kind === 'candidate') game.candidates = []
    if (kind === 'rules') game.playerTotals!.comparison.baselineCandidates[0].rules = 'Forged rules'
    if (kind === 'book') game.inspected[0].book = { orderbook_fp: { yes_dollars: [['0.60', '100']] } }
    if (kind === 'stale model') game.playerTotals!.simulation.observedAt = '2026-10-19T18:00:00Z'
    expect(() => freezeNbaStudy(input, {}, now)).toThrow(/selection policy|stale/)
    expect(() => trackNbaPick({ getItem: () => null, setItem: () => { throw new Error('unexpected write') } }, input, 'g1', now)).toThrow(/selection policy|stale/)
  })
})

describe('frozen NBA selection policy boundary', () => {
  it.each(invalidTotals)('rejects a $label even when selection and baseline match', ({ changed }) => {
    const input = scan()
    input.games[0].studySide = { ...side, ...changed }
    input.games[0].baselineStudySide = { ...side, ...changed }
    expect(() => freezeNbaStudy(input, { g1: evidence }, now)).toThrow(/selection policy/)
  })
  it.each(invalidTotals)('refuses tracking a matching invalid baseline with $label before storage writes', ({ changed }) => {
    const input = scan()
    input.games[0].studySide = { ...side, ...changed }
    input.games[0].baselineStudySide = { ...side, ...changed }
    const storage = { getItem: () => null, setItem: () => { throw new Error('unexpected write') } }
    expect(() => trackNbaPick(storage, input, 'g1', now)).toThrow(/selection policy/)
  })
  it.each(['price', 'feeEstimate', 'allInCost'].flatMap((component) =>
    [NaN, Infinity, -Infinity, undefined, null, '0.5'].map((value) => ({ component, value }))))(
    'rejects matching JSON round-tripped malformed $component=$value', ({ component, value }) => {
      const input = scan()
      input.games[0].studySide = JSON.parse(JSON.stringify({ ...side, [component]: value }))
      input.games[0].baselineStudySide = { ...input.games[0].studySide! }
      const roundTripped: NbaScan = JSON.parse(JSON.stringify(input))
      expect(() => freezeNbaStudy(roundTripped, { g1: evidence }, now)).toThrow(/selection policy/)
    })
  it('requires a selected total to match the complete policy result', () => {
    const input = scan()
    Reflect.deleteProperty(input.games[0].studySide!, 'price')
    expect(() => freezeNbaStudy(input, { g1: evidence }, now)).toThrow(/selection policy/)
  })
  it('rejects a missing primary when the shared policy selects a valid baseline total', () => {
    const input = scan(); input.games[0].studySide = null
    expect(() => freezeNbaStudy(input, {}, now)).toThrow(/selection policy/)
  })
  it('still freezes valid totals as paper experiments and tracks the same selection', () => {
    const input = scan()
    expect(freezeNbaStudy(input, { g1: evidence }, now).decisions[0].status).toBe('PAPER_EXPERIMENT')
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) } }
    const tracked = trackNbaPick(storage, input, 'g1', now)
    expect(tracked.decisions[0].selected).toEqual(side)
    expect(JSON.parse([...values.values()][0])[0]).toEqual(tracked)
  })
  it('keeps new totals and their unchanged baseline comparison frozen', () => {
    const input = scan()
    const frozen = freezeNbaStudy(input, {}, now)
    expect(frozen.decisions[0].selected).toEqual(side)
    expect(frozen.scan.games[0].baselineStudySide).toEqual(side)
    input.games[0].baselineStudySide!.probability = 0
    expect(frozen.scan.games[0].baselineStudySide!.probability).toBe(.6)
  })
  it('freezes real multi-level pricing with its unchanged raw evidence at the supported freeze quantity', () => {
    const input = scan()
    const book = { orderbook_fp: { yes_dollars: [['0.51', '3'], ['0.48', '100']] } }
    const quote = pricedNbaSide(book, 'no', input.quantity)!
    const selected = { ...side, price: quote.price, feeEstimate: quote.feeEstimate,
      allInCost: quote.allInCost, estimatedNetEdge: side.probability - quote.allInCost }
    input.games[0].studySide = selected
    input.games[0].baselineStudySide = selected
    input.games[0].inspected[0].book = book
    const roundTripped: NbaScan = JSON.parse(JSON.stringify(input))
    const frozen = freezeNbaStudy(roundTripped, { g1: evidence }, now)
    expect(frozen.decisions[0]).toMatchObject({ selected, status: 'PAPER_EXPERIMENT' })
    expect(frozen.scan).toEqual(input)
  })
  it('retains an inconsistent baseline only as an abstention, never substituting a valid candidate', () => {
    const input = scan()
    input.games[0].studySide = null
    input.games[0].baselineStudySide = { ...side, feeEstimate: 0 }
    input.games[0].candidates = [{ ...side, ticker: 'VALID-ALTERNATIVE' }]
    const before = JSON.stringify(input)
    const frozen = freezeNbaStudy(input, {}, now)
    expect(frozen.decisions[0]).toMatchObject({ selected: null, status: 'STUDY' })
    expect(frozen.scan).toEqual(input)
    expect(JSON.stringify(input)).toBe(before)
    const storage = { getItem: () => null, setItem: () => { throw new Error('unexpected write') } }
    expect(() => trackNbaPick(storage, input, 'g1', now)).toThrow('No priced paper pick')
  })
  it('rejects a side primary relabeled into a paused-policy scan', () => {
    for (const market of ['spread', 'moneyline']) {
      const input = scan(); input.games[0].studySide = { ...side, market }
      expect(() => freezeNbaStudy(input, {}, now)).toThrow(/selection policy/)
    }
  })
  it('does not rewrite legacy frozen-study behavior when no new policy was recorded', () => {
    const input = scan(); delete input.games[0].selectionPolicy
    input.games[0].studySide = { ...side, market: 'spread' }
    expect(freezeNbaStudy(input, {}, now).decisions[0].selected?.market).toBe('spread')
  })
  it('leaves legacy totals without a selection policy outside the new reconciliation check', () => {
    const input = scan(); delete input.games[0].selectionPolicy
    input.games[0].studySide = { ...side, feeEstimate: 0 }
    const frozen = freezeNbaStudy(input, { g1: evidence }, now)
    expect(frozen.decisions[0]).toMatchObject({ selected: input.games[0].studySide, status: 'PAPER_EXPERIMENT' })
    expect(frozen.scan).toEqual(input)
  })
  it('records abstention and refuses to track the quarantined baseline as the primary', () => {
    const input = scan(); input.games[0].studySide = null
    input.games[0].baselineStudySide = { ...side, market: 'spread' }
    input.games[0].abstentionReason = 'Primary side-model picks paused.'
    expect(freezeNbaStudy(input, {}, now).decisions[0].selected).toBeNull()
    const storage = { getItem: () => null, setItem: () => { throw new Error('unexpected write') } }
    expect(() => trackNbaPick(storage, input, 'g1', now)).toThrow('No priced paper pick')
  })
})
