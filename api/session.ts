import { verifySessionToken } from './auth-core.js'

type Request = { headers?: { cookie?: string }; method?: string }
type Response = { setHeader: (name: string, value: string) => void; status: (code: number) => { json: (body: unknown) => void } }

function readCookie(header: string | undefined, name: string): string | undefined {
  return header?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1)
}

export default function handler(request: Request, response: Response): void {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    response.status(405).json({ authenticated: false })
    return
  }

  const secret = process.env.EDGEBOARD_SESSION_SECRET
  const username = secret ? verifySessionToken(readCookie(request.headers?.cookie, 'edgeboard_session'), secret) : null
  if (!username) {
    response.status(401).json({ authenticated: false })
    return
  }
  response.status(200).json({ authenticated: true, username })
}
