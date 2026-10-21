import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionToken } from '../../server/auth-core.js'

const query = vi.hoisted(() => vi.fn())
vi.mock('pg', () => ({ default: { Pool: class { query = query } } }))
import handler from '../../api/nba-ledger.js'

const secret = 'test-only-session-secret'
const cookie = (owner: string) => `other=1; edgeboard_session=${createSessionToken(owner, secret)}`
const response = () => {
  const state: { code: number; payload?: unknown; headers: Record<string, string> } = { code: 0, headers: {} }
  return { state, setHeader: (key: string, value: string) => { state.headers[key] = value },
    status: (code: number) => { state.code = code; return { json: (value: unknown) => { state.payload = value } } } }
}
const freeze = { id: '2026-10-21T12:00:00Z', frozenAt: '2026-10-21T12:01:00Z',
  scan: { games: [{ gameId: '401909088' }] }, decisions: [{ gameId: '401909088' }] }
const review = { id: 'scan:game', scanId: 'scan', gameId: 'game', label: 'SIMULATED_NO_FILL', payout: 1 }
const audit = { id: 'scan:game', scanId: 'scan', gameId: 'game', classification: 'CAUSE_UNDETERMINED', recommendations: [] }
const call = async (method: string, body?: unknown, owner = 'Admin', token = cookie(owner)) => {
  const res = response()
  await handler({ method, headers: { cookie: token }, body }, res)
  return res.state
}
function dbReplies(...replies: unknown[]) {
  query.mockImplementation(async (sql: string) => sql.startsWith('CREATE TABLE') ? { rows: [] } : replies.shift())
}
function dataQueries() { return query.mock.calls.filter(([sql]) => !String(sql).startsWith('CREATE TABLE')) }

describe('owner-scoped NBA ledger', () => {
  beforeEach(() => { process.env.EDGEBOARD_SESSION_SECRET = secret; process.env.DATABASE_URL = 'postgresql://mock.invalid/test'; query.mockReset() })
  afterEach(() => { delete process.env.EDGEBOARD_SESSION_SECRET; delete process.env.DATABASE_URL; vi.restoreAllMocks() })

  it('rejects unauthenticated reads before contacting the database', async () => {
    expect((await call('GET', undefined, 'Admin', '')).code).toBe(401)
    expect(query).not.toHaveBeenCalled()
  })

  it('returns the three ledgers for the authenticated owner only', async () => {
    dbReplies({ rows: [
      { kind: 'freeze', record: freeze }, { kind: 'review', record: review }, { kind: 'audit', record: audit },
    ] })
    const result = await call('GET', undefined, 'Alice')
    expect(result).toMatchObject({ code: 200, payload: { freezes: [freeze], reviews: [review], audits: [audit] } })
    expect(dataQueries()[0][1]).toEqual(['Alice'])
    expect(dataQueries()[0][0]).toMatch(/WHERE owner = \$1/)
    expect(result.headers['Cache-Control']).toBe('private, no-store')
  })

  it('inserts an immutable freeze with parameterized owner and JSON', async () => {
    dbReplies({ rowCount: 1, rows: [{ record: freeze }] })
    const result = await call('POST', { kind: 'freeze', record: freeze })
    expect(result).toMatchObject({ code: 201, payload: { record: freeze } })
    expect(dataQueries()[0][0]).toMatch(/ON CONFLICT.*DO NOTHING/i)
    expect(dataQueries()[0][1]).toEqual(['Admin', 'freeze', freeze.id, JSON.stringify(freeze)])
  })

  it('accepts an identical replay and rejects a conflicting replay without update', async () => {
    dbReplies({ rowCount: 0, rows: [] }, { rows: [{ record: freeze }] },
      { rowCount: 0, rows: [] }, { rows: [{ record: freeze }] })
    expect((await call('POST', { kind: 'freeze', record: freeze })).code).toBe(200)
    expect((await call('POST', { kind: 'freeze', record: { ...freeze, frozenAt: 'changed' } })).code).toBe(409)
    expect(dataQueries().at(-1)?.[1]).toEqual(['Admin', 'freeze', freeze.id])
  })

  it.each([['review', review], ['audit', audit]] as const)('accepts a valid %s record', async (kind, record) => {
    dbReplies({ rowCount: 1, rows: [{ record }] })
    expect((await call('POST', { kind, record })).code).toBe(201)
  })

  it('rejects invalid kinds, malformed records, oversized payloads and unsupported methods before DB access', async () => {
    for (const body of [{ kind: 'other', record: freeze }, { kind: 'freeze', record: { id: 'x' } },
      { kind: 'review', record: { ...review, label: 'LIVE_FILL' } }, { kind: 'audit', record: { ...audit, recommendations: null } },
      { kind: 'freeze', record: { ...freeze, id: 'x'.repeat(257) } },
      { kind: 'freeze', record: { ...freeze, extra: 'x'.repeat(4 * 1024 * 1024) } }]) {
      expect((await call('POST', body)).code).toBe(400)
    }
    expect((await call('PATCH')).code).toBe(405)
    expect(query).not.toHaveBeenCalled()
  })

  it('fails closed on missing configuration or DB errors without leaking details', async () => {
    delete process.env.EDGEBOARD_SESSION_SECRET
    expect((await call('GET')).code).toBe(401)
    process.env.EDGEBOARD_SESSION_SECRET = secret
    query.mockRejectedValueOnce(new Error('private DB diagnostics'))
    const result = await call('GET')
    expect(result.code).toBe(503)
    expect(JSON.stringify(result.payload)).not.toContain('private DB diagnostics')
  })
})
