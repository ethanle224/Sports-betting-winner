import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { captureNbaForward } from '../../scripts/capture-nba-forward'
import type { NbaScan } from '../../src/nba-paper'

const mock = vi.hoisted(() => ({ code: 200, throws: false, policyMode: 'v5' }))
vi.mock('../../api/nba-scan.js', () => ({ default: async (_request: unknown,
  response: { status: (code: number) => { json: (body: unknown) => void } }) => {
  if (mock.throws) throw new Error('source failure')
  const scan: NbaScan = {
    date: '2026-10-20', observedAt: '2026-10-19T19:55:00Z', marketObservedAt: '2026-10-19T19:54:00Z', quantity: 10,
    historyObservedAt: '2026-10-19T19:53:00Z', status: 'STUDY_ONLY_NO_QUALIFIED_PICKS', sources: { markets: 'https://kalshi.com' },
    marketInventory: [], series: [], games: [{ gameId: 'g1', home: 'Boston', away: 'Detroit', startsAt: '2026-10-20T23:00:00Z',
      coverage: { moneyline: 0, spread: 0, total: 0 }, studySide: null, forecast: null,
      inspected: [], qualifiedPaperPick: false, candidates: [],
      selectionPolicy: 'nba-primary-v5-player-markets-v2',
      abstentionReason: 'No valid positive-gap player v2 moneyline, spread or total; no fallback selection.',
      marketInspection: { mode: 'ALL_SUPPORTED_OPEN_MARKETS', listed: 0, inspected: 0, complete: true },
      playerTotals: {
        simulation: { version: 'nba-player-totals-v2', status: 'unknown', eligibleForPrimary: false,
          observedAt: '2026-10-19T19:55:00Z', asOfCutoff: null, simulations: 0, seed: null,
          sources: [], assumptions: [], unknowns: ['Missing source'], reason: 'Missing source', reasons: ['Missing source'],
          totals: [], scores: [], expectedTotal: null, totalSd: null, inputs: null },
        comparison: { status: 'PAPER_ONLY_EXPERIMENT', promotionGate: 'USER_APPROVED_PAPER_ONLY',
          candidates: [], baselineCandidates: [], baselineStudySide: null, studySide: null },
        marketComparison: { selectionPolicy: 'nba-primary-v5-player-markets-v2', candidates: [], studySide: null,
          abstentionReason: 'No valid positive-gap player v2 moneyline, spread or total; no fallback selection.',
          status: 'PAPER_ONLY_EXPERIMENT', promotionGate: 'USER_APPROVED_PAPER_ONLY',
          rankingRule: 'net gap descending; ticker ASCII ascending; YES before NO' },
      } }],
  }
  if (mock.policyMode === 'quoted') {
    const { applyNbaPlayerMarketsSelectionPolicy } = await import('../../server/nba-policy')
    const game = scan.games[0]
    const event_ticker = 'KXNBAGAME-26OCT20DETBOS'
    const raw = { ticker: `${event_ticker}-BOS`, event_ticker, title: 'Detroit vs Boston',
      rules_primary: 'If Boston wins in the Detroit vs Boston Pro Basketball game originally scheduled for Oct 20, 2026, then the market resolves to Yes.',
      rules_secondary: 'If postponed, this contract may resolve at fair price.' }
    const market = { ...raw, gameId: game.gameId, series: 'KXNBAGAME', kind: 'moneyline' as const, team: 'home' as const, raw }
    const book = { orderbook_fp: { yes_dollars: [['0.50', '100']], no_dollars: [['0.80', '100']] } }
    const simulation = { ...game.playerTotals!.simulation, status: 'estimated' as const, eligibleForPrimary: true,
      simulations: 1000, reason: null, reasons: [], unknowns: [], seed: 'quoted-v5-test',
      scores: Array.from({ length: 1000 }, () => ({ home: 120, away: 100, overtimePeriods: 0 })),
      totals: Array(1000).fill(220), expectedTotal: 220, totalSd: 0 }
    const selection = applyNbaPlayerMarketsSelectionPolicy([market], { [market.ticker]: book }, simulation, 10)
    scan.marketInventory = [market]
    Object.assign(game, selection, { coverage: { moneyline: 1, spread: 0, total: 0 },
      marketInspection: { mode: 'ALL_SUPPORTED_OPEN_MARKETS', listed: 1, inspected: 1, complete: true },
      inspected: [{ ticker: market.ticker, book, source: `https://kalshi.com/markets/${market.ticker}/orderbook`,
        observedAt: '2026-10-19T19:54:30Z' }] })
    game.playerTotals!.simulation = simulation
    game.playerTotals!.marketComparison = { ...selection, status: 'PAPER_ONLY_EXPERIMENT',
      promotionGate: 'USER_APPROVED_PAPER_ONLY', rankingRule: 'net gap descending; ticker ASCII ascending; YES before NO' }
  }
  if (mock.policyMode === 'legacy') scan.games[0].selectionPolicy = 'nba-primary-v4-player-totals-v2'
  if (mock.policyMode === 'missing') Reflect.deleteProperty(scan.games[0], 'selectionPolicy')
  if (mock.policyMode === 'mixed') scan.games.push({ ...scan.games[0], gameId: 'g2', home: 'Other home', away: 'Other away',
    selectionPolicy: 'nba-primary-v4-player-totals-v2' })
  response.status(mock.code).json(mock.code === 200 ? scan : { error: 'Source incomplete' })
} }))
let directory: string
let prior: string | undefined
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'nba-forward-test-'))
  prior = process.env.EDGEBOARD_SESSION_SECRET
  process.env.EDGEBOARD_SESSION_SECRET = 'unit-test-existing-session'
  mock.code = 200; mock.throws = false; mock.policyMode = 'v5'
  vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-10-19T20:00:00Z'))
})
afterEach(async () => {
  vi.useRealTimers()
  if (prior === undefined) delete process.env.EDGEBOARD_SESSION_SECRET
  else process.env.EDGEBOARD_SESSION_SECRET = prior
  await rm(directory, { recursive: true, force: true })
})
describe('explicit one-shot NBA forward capture', () => {
  it('writes a study-only snapshot with code provenance and never a tracker pick', async () => {
    const summary = await captureNbaForward('2026-10-20', directory)
    expect(summary).toMatchObject({ games: 1, primaries: 0, abstentions: 1, paperOnly: true, trackerWrites: 0, orders: 0,
      playerSimulatedGames: 0, playerUnknownGames: 1, playerTrials: 0, playerQuotedComparisons: 0 })
    const saved = JSON.parse(await readFile(summary.file, 'utf8'))
    expect(saved.schema).toBe('nba-forward-comparison-v6')
    expect(saved.codeSha256['server/nba-challenger-snapshot.ts']).toMatch(/^[a-f0-9]{64}$/)
    expect(saved.codeSha256['server/nba-player-totals.ts']).toMatch(/^[a-f0-9]{64}$/)
    expect(saved.codeSha256['vercel.json']).toMatch(/^[a-f0-9]{64}$/)
    expect(saved.codeSha256['server/nba-market-books.ts']).toMatch(/^[a-f0-9]{64}$/)
    expect(saved.codeSha256['server/nba-player-fetch.ts']).toMatch(/^[a-f0-9]{64}$/)
    expect(saved.codeSha256['src/nba-simulation-summary.ts']).toMatch(/^[a-f0-9]{64}$/)
    expect(saved.researchProtocol).toMatchObject({ version: 'nba-player-markets-forward-v4',
      modelVersion: 'nba-player-totals-v2', selectionPolicy: 'nba-primary-v5-player-markets-v2',
      userApprovedPaperSelector: true, historicalRecordsRewritten: false,
      checkpoint: '2026-11-01', automaticPromotion: false, onePrimaryPerGame: true,
      marketScope: 'ALL_SUPPORTED_OPEN_MARKETS', status: 'PAPER_ONLY_EXPERIMENT', promotionGate: 'USER_APPROVED_PAPER_ONLY',
      rankingRule: 'net gap descending; ticker ASCII ascending; YES before NO' })
    expect(saved.researchProtocol.cohorts).toEqual([
      'immutable v5 cross-market main paper selections and abstentions',
      'old score-only selection on the same scan',
      'old totals-only comparator on the same scan',
    ])
    expect(saved.researchProtocol.ranking).toMatch(/UNCALIBRATED.*paired score/)
    expect(saved.researchProtocol.evaluation).toMatch(/v5.*moneyline, spread and total/)
    expect(saved.codeSha256['server/data/nba-challenger-calibration.json']).toMatch(/^[a-f0-9]{64}$/)
    expect(saved.freeze.decisions[0]).toMatchObject({ selected: null, status: 'STUDY' })
    expect(Object.values(saved.codeSha256).every((hash) => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash))).toBe(true)
    expect(process.env.EDGEBOARD_SESSION_SECRET).toBe('unit-test-existing-session')
  })
  it('counts v5 cross-market comparisons even when the old totals-only comparator is empty', async () => {
    mock.policyMode = 'quoted'
    const summary = await captureNbaForward('2026-10-20', directory)
    expect(summary).toMatchObject({ games: 1, primaries: 1, abstentions: 0, playerSimulatedGames: 1,
      playerTrials: 1000, playerQuotedComparisons: 1, trackerWrites: 0, orders: 0 })
    const saved = JSON.parse(await readFile(summary.file, 'utf8'))
    expect(saved.freeze.scan.games[0].playerTotals.comparison.candidates).toEqual([])
    expect(saved.freeze.scan.games[0].playerTotals.marketComparison.candidates).toHaveLength(2)
    expect(saved.freeze.decisions[0]).toMatchObject({ status: 'STUDY', selected: { market: 'moneyline' } })
  })
  it.each(['legacy', 'missing', 'mixed'])('does not relabel %s-policy data as a v5 capture', async (mode) => {
    mock.policyMode = mode
    await expect(captureNbaForward('2026-10-20', directory)).rejects.toThrow('v5 cross-market')
    expect(await readdir(directory)).toEqual([])
    expect(process.env.EDGEBOARD_SESSION_SECRET).toBe('unit-test-existing-session')
  })
  it('preserves distinct observations rather than overwriting an earlier capture', async () => {
    const a = await captureNbaForward('2026-10-20', directory)
    const b = await captureNbaForward('2026-10-20', directory)
    expect(a.file).not.toBe(b.file)
    expect(await readdir(directory)).toHaveLength(2)
  })
  it('fails closed on source failure and restores the existing local session environment', async () => {
    for (const throws of [false, true]) {
      mock.code = 502; mock.throws = throws
      await expect(captureNbaForward('2026-10-20', directory)).rejects.toThrow(throws ? 'source failure' : 'Public scan failed')
      expect(process.env.EDGEBOARD_SESSION_SECRET).toBe('unit-test-existing-session')
      expect(await readdir(directory)).toEqual([])
    }
  })
  it('requires an explicit valid-format scan date', async () => {
    await expect(captureNbaForward('tomorrow', directory)).rejects.toThrow('explicit date')
    expect(await readdir(directory)).toEqual([])
  })
})
