import { describe, expect, it } from 'vitest'
import { appendNbaFreeze, appendNbaReview, freezeNbaStudy, readNbaFreezes, readNbaReviews, type NbaScan } from './nba-paper'
import { auditTrackedPick, auditShadowPick, NBA_AUDIT_KEY, readNbaAudits } from './nba-audit'

const ticker = 'KXNBAGAME-26OCT20BOSDET-BOS'
const rules = 'If Boston wins the Boston vs Detroit Pro Basketball game originally scheduled for Oct 20, 2026, then the market resolves to Yes.'
const secondary = 'If postponed more than 48h, resolve to fair price.'
const scan: NbaScan = { date: '2026-10-20', observedAt: '2026-10-19T19:55:00Z', marketObservedAt: '2026-10-19T19:54:00Z',
  quantity: 10, historyObservedAt: '2026-10-06T04:11:37Z', status: 'STUDY_ONLY_NO_QUALIFIED_PICKS',
  sources: { markets: 'https://external-api.kalshi.com/trade-api/v2' }, series: [], marketInventory: [],
  games: [{ gameId: '401909088', home: 'Detroit', away: 'Boston', startsAt: '2026-10-20T23:00:00Z',
    coverage: { moneyline: 2, spread: 0, total: 0 }, qualifiedPaperPick: false,
    studySide: { ticker, market: 'moneyline', side: 'yes', line: null, probability: .63, price: .51, feeEstimate: .017,
      allInCost: .527, estimatedNetEdge: .103, rules, rulesSecondary: secondary },
    forecast: { model: 'nba-scores-v1', expectedMargin: 3, expectedTotal: 220, homeWin: .37, awayWin: .63 },
    factors: { starters: { status: 'unknown', detail: 'Not confirmed' }, rosterMatchup: { status: 'unknown', detail: 'Not adjusted' },
      fees: { status: 'estimated', detail: 'Fee estimate' } }, inspected: [] }] }
const response = { state: 'finalized' as const, date: scan.date, gameId: '401909088', ticker, result: 'NO' as const,
  payoutYes: 0, observedAt: '2026-10-21T04:00:00Z', scores: { home: 121, away: 113 }, rulesPrimary: rules, rulesSecondary: secondary,
  marketSource: `https://external-api.kalshi.com/trade-api/v2/markets/${ticker}`,
  scheduleSource: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261020' }
function fixture(override?: NbaScan) {
  const memory = new Map<string, string>()
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value) } }
  const frozen = freezeNbaStudy(override ?? scan, { '401909088': { requestedPaper: true, availabilitySource: '', availabilityObservedAt: '',
    availabilityNotes: '', rulesSource: '', feeSource: '', uncertaintyAccepted: false, rationale: '' } }, '2026-10-19T20:00:00Z')
  appendNbaFreeze(storage, frozen)
  return { storage, frozen, memory }
}
describe('source-backed append-only NBA paper audit', () => {
  it('settles a separately frozen shadow contract from its own exact public payout without altering primary results', () => {
    const challenger = { ...scan.games[0].studySide!, ticker: 'KXNBASPREAD-26OCT20BOSDET-BOS5',
      market: 'spread', side: 'no', line: 4.5, probability: .68, allInCost: .52, estimatedNetEdge: .16,
      rules: 'If Boston wins by more than 4.5 points in the Boston vs Detroit game, then Yes.' }
    const withShadow: NbaScan = { ...scan, games: [{ ...scan.games[0], shadowSide: challenger,
      candidates: [scan.games[0].studySide!, challenger], inspected: [{ ticker: challenger.ticker, observedAt: '2026-10-19T19:54:30Z',
        source: 'https://external-api.kalshi.com/trade-api/v2/markets/KXNBASPREAD-26OCT20BOSDET-BOS5/orderbook', book: {} }] }] }
    const { storage, frozen } = fixture(withShadow)
    const primary = auditTrackedPick(storage, frozen, '401909088', response, '2026-10-21T04:05:00Z')
    const separate = { ...response, ticker: challenger.ticker, rulesPrimary: challenger.rules,
      marketSource: `https://external-api.kalshi.com/trade-api/v2/markets/${challenger.ticker}` }
    expect(() => auditShadowPick(storage, frozen, '401909088', { ...separate, rulesPrimary: 'wrong rule' }, '2026-10-21T04:05:00Z')).toThrow()
    const shadow = auditShadowPick(storage, frozen, '401909088', separate, '2026-10-21T04:05:00Z')
    expect(shadow).toMatchObject({ id: `${primary.id}:shadow`, variant: 'shadow', outcome: 'WIN', payout: 1, ticker: challenger.ticker })
    expect(readNbaReviews(storage)[0]).toMatchObject({ payout: 0, simulatedNetUnits: -1 })
    expect(readNbaAudits(storage)).toEqual([primary, shadow])
    expect(() => auditShadowPick(storage, frozen, '401909088', separate, '2026-10-21T04:05:00Z')).toThrow(/already audited/i)
  })
  it('auto-reviews only a previously tracked exact settled contract and retains scored model diagnostics', () => {
    const { storage, frozen } = fixture()
    const report = auditTrackedPick(storage, frozen, '401909088', response, '2026-10-21T04:05:00Z')
    expect(report).toMatchObject({ classification: 'CAUSE_UNDETERMINED', outcome: 'LOSS', result: 'NO',
      actual: { home: 121, away: 113, total: 234, homeMargin: 8 }, model: { expectedTotal: 220, expectedMargin: 3, totalResidual: 14, marginResidual: 5 } })
    expect(report.gaps).toContain('starters')
    expect(report.recommendations.join(' ')).toMatch(/walk-forward|calibration/i)
    expect(report.recommendations.join(' ')).toMatch(/lineup|roster/i)
    expect(report.explanation).toMatch(/cannot establish.*cause/i)
    expect(readNbaReviews(storage)[0]).toMatchObject({ outcome: 'NO', payout: 0, simulatedNetUnits: -1 })
    expect(readNbaAudits(storage)).toEqual([report])
    expect(readNbaFreezes(storage)[0]).toEqual(frozen)
    expect(() => auditTrackedPick(storage, frozen, '401909088', response, '2026-10-21T04:05:00Z')).toThrow(/already audited/i)
  })
  it('accepts a trusted final observation within a small server/browser clock skew', () => {
    const { storage, frozen } = fixture()
    const report = auditTrackedPick(storage, frozen, '401909088', response, '2026-10-21T03:59:30Z')
    expect(report.outcome).toBe('LOSS')
    expect(readNbaReviews(storage)[0].observedAt).toBe(response.observedAt)
    expect(readNbaAudits(storage)).toHaveLength(1)
  })
  it('rejects a purported final observation too far ahead of the browser clock', () => {
    const { storage, frozen } = fixture()
    expect(() => auditTrackedPick(storage, frozen, '401909088', response, '2026-10-21T03:54:00Z')).toThrow(/finalized contract/i)
    expect(readNbaReviews(storage)).toHaveLength(0)
  })
  it('handles a winning NO position and a nonbinary fair-price payout without inventing a basketball cause', () => {
    const noSide: NbaScan = { ...scan, games: scan.games.map((game) => ({ ...game, studySide: { ...game.studySide!, side: 'no' } })) }
    const { storage, frozen } = fixture(noSide)
    const report = auditTrackedPick(storage, frozen, '401909088', response, '2026-10-21T04:05:00Z')
    expect(report.outcome).toBe('WIN')
    expect(readNbaReviews(storage)[0].simulatedNetUnits).toBeGreaterThan(0)
    const second = fixture(noSide)
    const fair = auditTrackedPick(second.storage, second.frozen, '401909088', { ...response, result: 'FAIR_PRICE', payoutYes: .42, scores: null }, '2026-10-21T04:05:00Z')
    expect(fair.outcome).toBe('FAIR_PRICE')
    expect(fair.actual).toBeNull()
    expect(readNbaReviews(second.storage)[0].payout).toBeCloseTo(.58)
  })
  it('refuses changed rules, spoofed sources, mismatched results and unfinished responses without writing either ledger', () => {
    const { storage, frozen } = fixture()
    for (const bad of [
      { ...response, rulesPrimary: 'Changed after selection' },
      { ...response, ticker: 'KXNBAGAME-26OCT20PHINYK-PHI' },
      { ...response, marketSource: 'https://example.org/fake-market' },
      { ...response, result: 'YES' as const, payoutYes: 0 },
      { ...response, observedAt: '2026-10-20T22:59:00Z' },
      { ...response, state: 'pending' as const },
    ]) expect(() => auditTrackedPick(storage, frozen, '401909088', bad, '2026-10-21T04:05:00Z')).toThrow()
    expect(readNbaAudits(storage)).toEqual([])
    expect(readNbaReviews(storage)).toEqual([])
  })
  it('does not overwrite an inconsistent operator-entered settlement', () => {
    const { storage, frozen } = fixture()
    appendNbaReview(storage, { scanId: frozen.id, gameId: '401909088', observedAt: '2026-10-21T04:00:00Z', source: response.marketSource,
      outcome: 'YES', payout: 1, note: 'Manually recorded settlement from market page.' }, '2026-10-21T04:05:00Z')
    expect(() => auditTrackedPick(storage, frozen, '401909088', response, '2026-10-21T04:05:00Z')).toThrow(/conflicts/i)
    expect(readNbaAudits(storage)).toEqual([])
    expect(readNbaReviews(storage)[0].outcome).toBe('YES')
  })
  it('fails closed on corrupt audit storage and never replaces it with empty history', () => {
    const { storage, memory, frozen } = fixture()
    memory.set(NBA_AUDIT_KEY, '{bad')
    expect(() => auditTrackedPick(storage, frozen, '401909088', response, '2026-10-21T04:05:00Z')).toThrow(/corrupt/i)
    expect(readNbaReviews(storage)).toEqual([])
  })
})
