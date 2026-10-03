import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('publishes only real HTTP endpoints as Vercel functions', () => {
  const routes = readdirSync(resolve(process.cwd(), 'api'))
    .filter((name) => name.endsWith('.ts')).sort()
  expect(routes).toEqual(['login.ts', 'logout.ts', 'nfl-scan.ts', 'session.ts'])
})
