import { timingSafeEqual } from 'node:crypto'
import { createSessionToken, sessionMaxAgeSeconds } from './auth-core.js'

type Request = { body?: unknown; method?: string }
type Response = { end: () => void; setHeader: (name: string, value: string) => void; status: (code: number) => { json: (body: unknown) => void } }

function credentials(body: unknown): { password: string; username: string } | null {
  const value = typeof body === 'string' ? JSON.parse(body) : body
  if (!value || typeof value !== 'object') return null
  const { username, password } = value as { username?: unknown; password?: unknown }
  return typeof username === 'string' && typeof password === 'string' ? { username, password } : null
}

function passwordsMatch(input: string, expected: string): boolean {
  const inputBuffer = Buffer.from(input)
  const expectedBuffer = Buffer.from(expected)
  return inputBuffer.length === expectedBuffer.length && timingSafeEqual(inputBuffer, expectedBuffer)
}

export default function handler(request: Request, response: Response): void {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    response.status(405).json({ message: 'Method not allowed.' })
    return
  }

  const password = process.env.EDGEBOARD_ADMIN_PASSWORD
  const sessionSecret = process.env.EDGEBOARD_SESSION_SECRET
  if (!password || !sessionSecret) {
    response.status(503).json({ message: 'Login is not configured.' })
    return
  }

  try {
    const input = credentials(request.body)
    if (!input || input.username !== 'Admin' || !passwordsMatch(input.password, password)) {
      response.status(401).json({ message: 'Invalid username or password.' })
      return
    }
  } catch {
    response.status(400).json({ message: 'Invalid login request.' })
    return
  }

  const token = createSessionToken('Admin', sessionSecret)
  response.setHeader(
    'Set-Cookie',
    `edgeboard_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${sessionMaxAgeSeconds}`,
  )
  response.status(204).end()
}
