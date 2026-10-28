import { describe, expect, it } from 'vitest'
import { appendNbaFreeze, appendNbaReview, freezeNbaStudy, readNbaFreezes, readNbaReviews, summarizeNbaHistory, trackNbaPick, type NbaEvidence, type NbaScan } from './nba-paper'

const now = '2026-10-19T20:00:00Z'
const side = { ticker: 'KXNBAGAME-26OCT20BOSDET-BOS', market: 'moneyline', side: 'yes', line: null,
  probability: .63, price: .51, feeEstimate: .17, allInCost: .527, estimatedNetEdge: .103,
  rules: 'If Boston wins, Yes.', rulesSecondary: 'If postponed longer than 48 hours, fair price.' }
const scan: NbaScan = { date: '2026-10-20', observedAt: '2026-10-19T19:55:00Z', marketObservedAt: '2026-10-19T19:54:00Z', quantity: 10, historyObservedAt: '2026-10-06T04:11:37Z',
  status: 'STUDY_ONLY_NO_QUALIFIED_PICKS', sources: { schedule: 'https://site.api.espn.com/scoreboard', markets: 'https://external-api.kalshi.com/trade-api/v2', feeSchedule: 'https://kalshi.com/docs/kalshi-fee-schedule.pdf' },
  series: [], marketInventory: [{ ticker: side.ticker, rules_primary: side.rules }],
  games: ['401909088', '401909089', '401909090'].map((gameId, i) => ({ gameId, home: 'Detroit', away: 'Boston',
    startsAt: '2026-10-20T19:00:00Z', coverage: { moneyline: 2, spread: 0, total: 0 }, qualifiedPaperPick: false,
    forecast: { model: 'nba-scores-v1', expectedMargin: 3, expectedTotal: 220, homeWin: .63, awayWin: .37, marginSd: 14, totalSd: 19, homeAdvantage: 2, headToHeadCount: 2 },
    studySide: i === 0 ? side : null,
    inspected: i === 0 ? [{ ticker: side.ticker, observedAt: '2026-10-19T19:54:30Z', source: 'https://external-api.kalshi.com/trade-api/v2/markets/KXNBAGAME-26OCT20BOSDET-BOS/orderbook', book: { orderbook_fp: { no_dollars: [['0.49', '10.00']], yes_dollars: [] } } }] : [] })) }
const attestation: NbaEvidence = { requestedPaper: true, availabilitySource: 'https://official.nba.com/injury-report/',
  availabilityObservedAt: '2026-10-19T19:45:00Z', availabilityNotes: 'Confirmed starting five and questionable players; no adjustment claimed',
  rulesSource: 'https://kalshi.com/markets/kxnbagame/', feeSource: 'https://kalshi.com/docs/kalshi-fee-schedule.pdf',
  uncertaintyAccepted: true, rationale: 'Price is favorable only if the baseline remains calibrated.' }

describe('NBA paper-only opening-slate freeze', () => {
  it('tracks a selected-date single-game slate without requiring the October 20 trio', () => {
    const next = 'KXNBAGAME-26OCT21ATLORL-ORL'
    const one: NbaScan = { ...scan, date: '2026-10-21', observedAt: '2026-10-20T20:00:00Z', marketObservedAt: '2026-10-20T19:59:00Z',
      marketInventory: [{ ticker: next }], games: [{ ...scan.games[0], gameId: '401909834', away: 'Atlanta', home: 'Orlando',
        startsAt: '2026-10-21T23:00:00Z', studySide: { ...side, ticker: next },
        inspected: [{ ticker: next, observedAt: '2026-10-20T19:59:30Z', source: `https://external-api.kalshi.com/trade-api/v2/markets/${next}/orderbook`, book: {} }] }] }
    const memory = new Map<string, string>()
    const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value) } }
    const record = trackNbaPick(storage, one, '401909834', '2026-10-20T20:01:00Z')
    expect(record.scan.games).toHaveLength(1)
    expect(readNbaFreezes(storage)).toEqual([record])
    expect(() => trackNbaPick(storage, one, '401909834', '2026-10-20T20:01:00Z')).toThrow(/already tracking/i)
  })
  it('freezes an independently quoted shadow contract alongside the unchanged primary pick', () => {
    const shadow = { ...side, ticker: 'KXNBASPREAD-26OCT20BOSDET-DET5', market: 'spread', side: 'no', line: 4.5,
      probability: .68, price: .50, allInCost: .518, estimatedNetEdge: .162,
      rules: 'If Detroit wins by more than 4.5 points in the Boston vs Detroit game, then Yes.' }
    const game = { ...scan.games[0], shadowSide: shadow, candidates: [side, shadow], inspected: [
      ...scan.games[0].inspected, { ticker: shadow.ticker, observedAt: '2026-10-19T19:54:30Z', source: 'https://external-api.kalshi.com/trade-api/v2/markets/KXNBASPREAD-26OCT20BOSDET-DET5/orderbook',
        book: { orderbook_fp: { yes_dollars: [['0.50', '10']], no_dollars: [] } } }] }
    const storage = { getItem: () => null, setItem: () => {} }
    const frozen = trackNbaPick(storage, { ...scan, marketInventory: [...scan.marketInventory, { ticker: shadow.ticker }], games: [game] }, game.gameId, now)
    expect(frozen.decisions[0].selected).toEqual(side)
    expect(frozen.decisions[0].shadow).toEqual(shadow)
    expect(frozen.scan.marketInventory.map((item) => (item as { ticker: string }).ticker)).toContain(shadow.ticker)
    game.shadowSide.allInCost = .9
    expect(frozen.decisions[0].shadow?.allInCost).toBe(.518)
  })
  it('never freezes an uninspected shadow or treats it as the primary pick', () => {
    const shadow = { ...side, ticker: 'UNINSPECTED', probability: .8 }
    const frozen = freezeNbaStudy({ ...scan, games: [{ ...scan.games[0], shadowSide: shadow, candidates: [side, shadow] }] }, {}, now)
    expect(frozen.decisions[0].selected).toEqual(side)
    expect(frozen.decisions[0].shadow).toBeNull()
  })
  it('tracks a single clicked game immediately as an unqualified one-unit pending study, once per game', () => {
    const memory = new Map<string, string>()
    const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value) } }
    const first = trackNbaPick(storage, scan, '401909088', now)
    expect(first.id).toBe(`${scan.observedAt}:401909088`)
    expect(first.decisions[0]).toMatchObject({ status: 'STUDY', selected: side, evidence: { requestedPaper: true } })
    expect(summarizeNbaHistory(readNbaFreezes(storage), [])).toMatchObject({ pending: 1, wins: 0, losses: 0, simulatedNetUnits: 0 })
    expect(() => trackNbaPick(storage, scan, '401909088', now)).toThrow(/already tracking/i)
    expect(() => trackNbaPick(storage, scan, '401909089', now)).toThrow(/no priced/i)
    expect(() => trackNbaPick(storage, scan, '401909088', '2026-10-20T19:00:00Z')).toThrow(/tip|stale/i)
    const noBook = { ...scan, games: scan.games.map((game, index) => index ? game : { ...game, inspected: [] }) }
    expect(() => trackNbaPick({ getItem: () => null, setItem: () => {} }, noBook, '401909088', now)).toThrow(/priced|book/i)
  })
  it('keeps decision-time evidence for the clicked game without cloning the entire slate into every daily pick', () => {
    const storage = { getItem: () => null, setItem: () => {} }
    const long = { ...scan, marketInventory: [scan.marketInventory[0], { ticker: 'UNRELATED', filler: 'x'.repeat(100_000) }],
      games: scan.games.map((game, index) => index === 0 ? game : { ...game, inspected: [{ ticker: 'UNRELATED', observedAt: now, source: 'https://example.com', book: 'x'.repeat(100_000) }] }) }
    const record = trackNbaPick(storage, long, '401909088', now)
    expect(record.scan.games.map((game) => game.gameId)).toEqual(['401909088'])
    expect(record.scan.marketInventory).toEqual([scan.marketInventory[0]])
    expect(JSON.stringify(record)).not.toContain('UNRELATED')
  })
  it('preserves every game and the full raw scan, with rejected sides honestly marked', () => {
    const frozen = freezeNbaStudy(scan, {}, now)
    expect(frozen.scan).toEqual(scan)
    expect(frozen.decisions).toHaveLength(3)
    expect(frozen.decisions.every((d) => d.status === 'STUDY')).toBe(true)
    expect(frozen.decisions[1].reasons).toContain('No priced study side')
    expect(frozen.decisions[0].reasons).toContain('Availability and lineup evidence incomplete')
  })
  it('allows an explicitly attested positive-cost paper experiment, never a validated bet', () => {
    const frozen = freezeNbaStudy(scan, { '401909088': attestation }, now)
    expect(frozen.decisions[0].status).toBe('PAPER_EXPERIMENT')
    expect(frozen.decisions[0].selected).toEqual(side)
    expect(frozen.decisions.slice(1).every((d) => d.status === 'STUDY')).toBe(true)
    expect(frozen.decisions[0].evidence).toEqual(attestation)
  })
  it('rejects stale quotes, post-tip freezes, incomplete snapshots and stale injury evidence', () => {
    expect(() => freezeNbaStudy(scan, {}, '2026-10-19T20:30:01Z')).toThrow(/stale/i)
    expect(() => freezeNbaStudy(scan, {}, '2026-10-20T19:00:00Z')).toThrow(/tip|stale/i)
    expect(() => freezeNbaStudy({ ...scan, games: [] }, {}, now)).toThrow(/selected-date/i)
    const stale = { ...attestation, availabilityObservedAt: '2026-10-17T20:00:00Z' }
    expect(freezeNbaStudy(scan, { '401909088': stale }, now).decisions[0].status).toBe('STUDY')
  })
  it('blocks an old listing or selected book even when the response wrapper is fresh', () => {
    expect(() => freezeNbaStudy({ ...scan, marketObservedAt: '2026-10-19T19:20:00Z' }, {}, now)).toThrow(/listing/i)
    const games = scan.games.map((game, index) => index ? game : { ...game,
      inspected: game.inspected.map((book) => ({ ...book, observedAt: '2026-10-19T19:20:00Z' })) })
    const frozen = freezeNbaStudy({ ...scan, games }, { '401909088': attestation }, now)
    expect(frozen.decisions[0].status).toBe('STUDY')
    expect(frozen.decisions[0].reasons).toContain('Raw sized orderbook missing or stale')
  })
  it('append-only saves without erasing an earlier decision, and refuses corrupt storage', () => {
    const memory = new Map<string, string>()
    const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value) } }
    const first = freezeNbaStudy(scan, {}, now)
    appendNbaFreeze(storage, first)
    expect(readNbaFreezes(storage)).toHaveLength(1)
    expect(() => appendNbaFreeze(storage, first)).toThrow(/duplicate/i)
    const second = freezeNbaStudy({ ...scan, observedAt: '2026-10-19T19:56:00Z' }, { '401909088': attestation }, now)
    appendNbaFreeze(storage, second)
    expect(readNbaFreezes(storage)).toHaveLength(2)
    expect(readNbaFreezes(storage)[0].decisions[0].status).toBe('STUDY')
    memory.set('edgeboard-nba-freezes-v1', '{bad json')
    expect(() => appendNbaFreeze(storage, first)).toThrow(/corrupt/i)
  })
  it('settles only a previously frozen paper experiment after tip, with sourced payout and simulated post-cost units', () => {
    const memory = new Map<string, string>()
    const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value) } }
    const frozen = freezeNbaStudy(scan, { '401909088': attestation }, now)
    appendNbaFreeze(storage, frozen)
    const input = { scanId: frozen.id, gameId: '401909088', observedAt: '2026-10-21T04:00:00Z',
      source: 'https://external-api.kalshi.com/trade-api/v2/markets/KXNBAGAME-26OCT20BOSDET-BOS',
      outcome: 'YES' as const, payout: 1, note: 'Observed final contract settlement after game.' }
    const review = appendNbaReview(storage, input, '2026-10-21T04:05:00Z')
    expect(review.simulatedNetUnits).toBeCloseTo(1 / side.allInCost - 1)
    expect(review.stakeUnits).toBe(1)
    expect(readNbaReviews(storage)).toEqual([review])
    expect(readNbaFreezes(storage)[0]).toEqual(frozen)
    expect(() => appendNbaReview(storage, input, '2026-10-21T04:05:00Z')).toThrow(/duplicate/i)
    expect(() => appendNbaReview(storage, { ...input, gameId: '401909089' }, '2026-10-21T04:05:00Z')).toThrow(/paper experiment/i)
    expect(() => appendNbaReview(storage, { ...input, observedAt: '2026-10-20T18:00:00Z' }, '2026-10-21T04:05:00Z')).toThrow(/tip/i)
  })
  it('requires valid sourced nonstandard fair-price payout rather than assuming binary settlement', () => {
    const memory = new Map<string, string>()
    const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value) } }
    const frozen = freezeNbaStudy(scan, { '401909088': attestation }, now)
    appendNbaFreeze(storage, frozen)
    const input = { scanId: frozen.id, gameId: '401909088', observedAt: '2026-10-21T04:00:00Z',
      source: 'https://external-api.kalshi.com/trade-api/v2/markets/KXNBAGAME-26OCT20BOSDET-BOS',
      outcome: 'FAIR_PRICE' as const, payout: .42, note: 'Contract settled at a nonbinary fair price.' }
    expect(appendNbaReview(storage, input, '2026-10-21T04:05:00Z').simulatedNetUnits).toBeCloseTo(.42 / side.allInCost - 1)
    expect(() => appendNbaReview(storage, { ...input, scanId: 'not-a-scan' }, '2026-10-21T04:05:00Z')).toThrow(/frozen/i)
  })
  it('scores a selected NO side as a win when the contract settles NO', () => {
    const memory = new Map<string, string>()
    const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value) } }
    const noScan = { ...scan, games: scan.games.map((game, index) => index === 0 ? { ...game, studySide: { ...side, side: 'no' } } : game) }
    const frozen = freezeNbaStudy(noScan, { '401909088': attestation }, now)
    appendNbaFreeze(storage, frozen)
    const input = { scanId: frozen.id, gameId: '401909088', observedAt: '2026-10-21T04:00:00Z',
      source: 'https://external-api.kalshi.com/trade-api/v2/markets/KXNBAGAME-26OCT20BOSDET-BOS',
      outcome: 'NO' as const, payout: 1, note: 'NO contract settled and selected NO side paid out.' }
    expect(appendNbaReview(storage, input, '2026-10-21T04:05:00Z').simulatedNetUnits).toBeCloseTo(1 / side.allInCost - 1)
  })
  it('tracks requested forced studies as pending then wins or losses without counting unrequested research', () => {
    const memory = new Map<string, string>()
    const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value) } }
    const requested = { ...attestation, availabilitySource: '', availabilityNotes: '', rulesSource: '', feeSource: '' }
    const frozen = freezeNbaStudy(scan, { '401909088': requested }, now)
    expect(frozen.decisions[0].status).toBe('STUDY')
    appendNbaFreeze(storage, frozen)
    expect(summarizeNbaHistory(readNbaFreezes(storage), readNbaReviews(storage))).toMatchObject({ pending: 1, wins: 0, losses: 0 })
    appendNbaReview(storage, { scanId: frozen.id, gameId: '401909088', observedAt: '2026-10-21T04:00:00Z',
      source: 'https://external-api.kalshi.com/trade-api/v2/markets/KXNBAGAME-26OCT20BOSDET-BOS',
      outcome: 'NO', payout: 0, note: 'Verified NO settlement; YES paper side lost.' }, '2026-10-21T04:05:00Z')
    expect(summarizeNbaHistory(readNbaFreezes(storage), readNbaReviews(storage))).toMatchObject({ pending: 0, wins: 0, losses: 1, simulatedNetUnits: -1 })
    expect(readNbaFreezes(storage)[0]).toEqual(frozen)
  })
  it('does not call a fair-price payout a binary win/loss', () => {
    const frozen = freezeNbaStudy(scan, { '401909088': attestation }, now)
    const review = { id: `${frozen.id}:401909088`, scanId: frozen.id, gameId: '401909088', observedAt: '2026-10-21T04:00:00Z',
      source: 'https://external-api.kalshi.com/trade-api/v2/markets/KXNBAGAME-26OCT20BOSDET-BOS', outcome: 'FAIR_PRICE' as const,
      payout: .42, note: 'Fair-price settlement verified.', simulatedNetUnits: -.0428, unitDollars: 25 as const,
      entryCostPerContract: .527, quantity: 10, label: 'SIMULATED_NO_FILL' as const }
    expect(summarizeNbaHistory([frozen], [review])).toMatchObject({ pending: 0, wins: 0, losses: 0, fairPrice: 1 })
    expect(summarizeNbaHistory([frozen], [review]).simulatedNetUnits).toBeCloseTo(.42 / .527 - 1)
  })
})
