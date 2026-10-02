import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSession, login, logout } from './auth'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('authentication client', () => {
  it('returns the authenticated admin from the server session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ authenticated: true, username: 'Admin' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(getSession()).resolves.toEqual({ authenticated: true, username: 'Admin' })
    expect(fetchMock).toHaveBeenCalledWith('/api/session', { credentials: 'same-origin' })
  })

  it('sends login credentials only to the server endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(login('Admin', 'not-a-real-password')).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith('/api/login', {
      body: JSON.stringify({ username: 'Admin', password: 'not-a-real-password' }),
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
  })

  it('requests server-side session invalidation on logout', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(logout()).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith('/api/logout', {
      credentials: 'same-origin',
      method: 'POST',
    })
  })
})
