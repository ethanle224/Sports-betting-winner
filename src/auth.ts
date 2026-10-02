export type Session =
  | { authenticated: true; username: string }
  | { authenticated: false }

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json()
    return value && typeof value === 'object' ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export async function getSession(): Promise<Session> {
  try {
    const response = await fetch('/api/session', { credentials: 'same-origin' })
    if (!response.ok) return { authenticated: false }
    const payload = await responseJson(response)
    if (payload.authenticated === true && typeof payload.username === 'string') {
      return { authenticated: true, username: payload.username }
    }
  } catch {
    // Treat a network/API failure as unauthenticated; do not reveal server details in the UI.
  }
  return { authenticated: false }
}

export async function login(username: string, password: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const response = await fetch('/api/login', {
      body: JSON.stringify({ username, password }),
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    if (response.ok) return { ok: true }
    const payload = await responseJson(response)
    return { ok: false, message: typeof payload.message === 'string' ? payload.message : 'Login failed.' }
  } catch {
    return { ok: false, message: 'Login is unavailable. Please try again.' }
  }
}

export async function logout(): Promise<void> {
  await fetch('/api/logout', { credentials: 'same-origin', method: 'POST' })
}
