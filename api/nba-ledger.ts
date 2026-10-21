import { verifySessionToken } from '../server/auth-core.js'
import { appendNbaLedger, listNbaLedger, validateRecord } from '../server/nba-ledger.js'

type Request = { method?: string; headers?: { cookie?: string }; body?: unknown }
type Response = { setHeader: (name: string, value: string) => void; status: (code: number) => { json: (body: unknown) => void } }

function sessionCookie(header: string | undefined): string | undefined {
  return header?.split(';').map((part) => part.trim()).find((part) => part.startsWith('edgeboard_session='))?.slice('edgeboard_session='.length)
}

export default async function handler(request: Request, response: Response): Promise<void> {
  response.setHeader('Cache-Control', 'private, no-store')
  if (request.method !== 'GET' && request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST')
    response.status(405).json({ error: 'Method not allowed' })
    return
  }
  const secret = process.env.EDGEBOARD_SESSION_SECRET
  const owner = secret ? verifySessionToken(sessionCookie(request.headers?.cookie), secret) : null
  if (!owner || owner.length > 256) { response.status(401).json({ error: 'Unauthorized' }); return }

  if (request.method === 'GET') {
    try { response.status(200).json(await listNbaLedger(owner)) }
    catch { response.status(503).json({ error: 'Ledger unavailable' }) }
    return
  }
  let body = request.body
  try {
    if (typeof body === 'string') {
      if (Buffer.byteLength(body, 'utf8') > 4 * 1024 * 1024 + 1024) throw new Error('Oversized body')
      body = JSON.parse(body)
    }
  } catch { response.status(400).json({ error: 'Invalid ledger record' }); return }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    response.status(400).json({ error: 'Invalid ledger record' }); return
  }
  const input = body as { kind?: unknown; record?: unknown }
  const record = validateRecord(input.kind, input.record)
  if (!record) { response.status(400).json({ error: 'Invalid ledger record' }); return }
  try {
    const result = await appendNbaLedger(owner, record)
    if (result.status === 'conflict') { response.status(409).json({ error: 'Immutable ledger record already exists' }); return }
    response.status(result.status === 'created' ? 201 : 200).json({ record: result.record })
  } catch { response.status(503).json({ error: 'Ledger unavailable' }) }
}
