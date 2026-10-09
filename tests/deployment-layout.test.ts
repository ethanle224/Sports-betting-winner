import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('publishes only real HTTP endpoints as Vercel functions', () => {
  const routes = readdirSync(resolve(process.cwd(), 'api'))
    .filter((name) => name.endsWith('.ts')).sort()
  expect(routes).toEqual(['login.ts', 'logout.ts', 'nba-research.ts', 'nba-scan.ts', 'nfl-scan.ts', 'session.ts'])
})

it('uses NodeNext JSON import attributes in both NBA Vercel functions', () => {
  for (const route of ['nba-research.ts', 'nba-scan.ts']) {
    const source = readFileSync(resolve(process.cwd(), 'api', route), 'utf8')
    expect(source).toMatch(/from ['"]\.\.\/server\/data\/nba-games\.json['"] with \{ type: ['"]json['"] \}/)
  }
})
