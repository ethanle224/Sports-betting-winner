type Request = { method?: string }
type Response = { end: () => void; setHeader: (name: string, value: string) => void; status: (code: number) => { json: (body: unknown) => void } }

export default function handler(request: Request, response: Response): void {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    response.status(405).json({ message: 'Method not allowed.' })
    return
  }
  response.setHeader('Set-Cookie', 'edgeboard_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0')
  response.status(204).end()
}
