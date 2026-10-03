import { createHmac, timingSafeEqual } from 'node:crypto'

const SESSION_TTL_MS = 60 * 60 * 1000

type Payload = { exp: number; username: string }

function encode(value: string): string {
  return Buffer.from(value).toString('base64url')
}

function decode(value: string): string | null {
  try {
    return Buffer.from(value, 'base64url').toString('utf8')
  } catch {
    return null
  }
}

function signature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export function createSessionToken(username: string, secret: string, now = Date.now()): string {
  const payload = encode(JSON.stringify({ username, exp: now + SESSION_TTL_MS } satisfies Payload))
  return `${payload}.${signature(payload, secret)}`
}

export function verifySessionToken(token: string | undefined, secret: string, now = Date.now()): string | null {
  if (!token) return null
  const [payload, receivedSignature, extra] = token.split('.')
  if (!payload || !receivedSignature || extra) return null
  const expectedSignature = signature(payload, secret)
  const received = Buffer.from(receivedSignature)
  const expected = Buffer.from(expectedSignature)
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null

  const decoded = decode(payload)
  if (!decoded) return null
  try {
    const value: unknown = JSON.parse(decoded)
    if (!value || typeof value !== 'object') return null
    const { username, exp } = value as Partial<Payload>
    if (typeof username !== 'string' || typeof exp !== 'number' || exp <= now) return null
    return username
  } catch {
    return null
  }
}

export const sessionMaxAgeSeconds = SESSION_TTL_MS / 1000
