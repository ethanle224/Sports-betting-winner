import { describe, expect, it, vi } from 'vitest'
import { createSessionToken } from './auth-core'
import handler from './nfl-scan'

const token = createSessionToken('Admin', 'test-secret')
function response() {
  const state: { code: number; payload: unknown } = { code: 0, payload: null }
  return { state, setHeader: vi.fn(), status(code: number) { state.code = code; return { json(payload: unknown) { state.payload = payload } } } }
}

describe('NFL scan endpoint', () => {
  it('denies missing session without fetching markets', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
    const res = response()
    await handler({ method: 'GET', query: { date: '2026-10-04' }, headers: {} }, res)
    expect(res.state.code).toBe(401)
    expect(fetcher).not.toHaveBeenCalled()
    fetcher.mockRestore()
  })
  it('rejects invalid dates before any API request', async () => {
    process.env.EDGEBOARD_SESSION_SECRET = 'test-secret'
    const fetcher = vi.spyOn(globalThis, 'fetch')
    const res = response()
    await handler({ method: 'GET', query: { date: 'yesterday' }, headers: { cookie: `edgeboard_session=${token}` } }, res)
    expect(res.state.code).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
    fetcher.mockRestore()
    delete process.env.EDGEBOARD_SESSION_SECRET
  })
})
