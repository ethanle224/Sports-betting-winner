import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { captureNbaForward } from '../../scripts/capture-nba-forward'

const mock = vi.hoisted(() => ({ code: 200, throws: false }))
vi.mock('../../api/nba-scan.js', () => ({ default: async (_request: unknown,
  response: { status: (code: number) => { json: (body: unknown) => void } }) => {
  if (mock.throws) throw new Error('source failure')
  response.status(mock.code).json(mock.code === 200 ? {
    date: '2026-10-20', observedAt: '2026-10-19T19:55:00Z', marketObservedAt: '2026-10-19T19:54:00Z', quantity: 10,
    historyObservedAt: '2026-10-19T19:53:00Z', status: 'STUDY_ONLY_NO_QUALIFIED_PICKS', sources: { markets: 'https://kalshi.com' },
    marketInventory: [], series: [], games: [{ gameId: 'g1', home: 'Boston', away: 'Detroit', startsAt: '2026-10-20T23:00:00Z',
      coverage: { moneyline: 0, spread: 0, total: 0 }, studySide: null, forecast: null,
      inspected: [], qualifiedPaperPick: false }],
  } : { error: 'Source incomplete' })
} }))
let directory: string
let prior: string | undefined
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'nba-forward-test-'))
  prior = process.env.EDGEBOARD_SESSION_SECRET
  process.env.EDGEBOARD_SESSION_SECRET = 'unit-test-existing-session'
  mock.code = 200; mock.throws = false
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
      playerSimulatedGames: 0, playerUnknownGames: 0, playerTrials: 0, playerQuotedComparisons: 0 })
    const saved = JSON.parse(await readFile(summary.file, 'utf8'))
    expect(saved.schema).toBe('nba-forward-comparison-v5')
    expect(saved.codeSha256['server/nba-challenger-snapshot.ts']).toMatch(/^[a-f0-9]{64}$/)
    expect(saved.codeSha256['server/nba-player-totals.ts']).toMatch(/^[a-f0-9]{64}$/)
    expect(saved.codeSha256['server/nba-player-fetch.ts']).toMatch(/^[a-f0-9]{64}$/)
    expect(saved.codeSha256['src/nba-simulation-summary.ts']).toMatch(/^[a-f0-9]{64}$/)
    expect(saved.researchProtocol).toMatchObject({ version: 'nba-player-totals-forward-v3',
      modelVersion: 'nba-player-totals-v2', selectionPolicy: 'nba-primary-v4-player-totals-v2',
      userApprovedPaperSelector: true, historicalRecordsRewritten: false,
      checkpoint: '2026-11-01', automaticPromotion: false, onePrimaryPerGame: true })
    expect(saved.codeSha256['server/data/nba-challenger-calibration.json']).toMatch(/^[a-f0-9]{64}$/)
    expect(saved.freeze.decisions[0]).toMatchObject({ selected: null, status: 'STUDY' })
    expect(Object.values(saved.codeSha256).every((hash) => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash))).toBe(true)
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
