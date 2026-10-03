import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import type { CompletedGame } from './nfl-model.js'
import type { EfficiencySnapshot, TeamGameEfficiency } from './nfl-efficiency.js'

const SOURCE = 'https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{}.csv.gz'
const FIELDS = ['game_id', 'game_date', 'season_type', 'play_type', 'posteam', 'defteam', 'home_team',
  'away_team', 'drive', 'epa', 'success', 'first_down', 'qb_spike', 'qb_kneel'] as const

// Read just the required columns. Descriptions in nflverse CSV may contain quoted newlines.
function selectedRows(csv: string, onRow: (row: Record<string, string>) => void): void {
  const end = csv.indexOf('\n')
  if (end < 0) throw new Error('Missing CSV header')
  const headers = csv.slice(0, end).replace(/\r$/, '').replace(/^\uFEFF/, '').split(',')
  const indexes = new Map<number, string>()
  for (const field of FIELDS) {
    const index = headers.indexOf(field)
    if (index < 0) throw new Error(`Missing play-by-play column ${field}`)
    indexes.set(index, field)
  }
  let row: Record<string, string> = {}, column = 0, value = '', quoted = false
  const saveField = () => { const field = indexes.get(column); if (field) row[field] = value; column++; value = '' }
  const saveRow = () => { saveField(); if (row.game_id) onRow(row); row = {}; column = 0 }
  for (let i = end + 1; i < csv.length; i++) {
    const char = csv[i]
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') { if (indexes.has(column)) value += '"'; i++ }
      else quoted = !quoted
    } else if (char === ',' && !quoted) saveField()
    else if ((char === '\r' || char === '\n') && !quoted) {
      if (char === '\r' && csv[i + 1] === '\n') i++
      saveRow()
    } else if (indexes.has(column)) value += char
  }
  if (quoted) throw new Error('Unterminated play-by-play CSV field')
  if (column || value) saveRow()
}

export function parseEfficiencyCsv(csv: string, cutoff: string): TeamGameEfficiency[] {
  const groups = new Map<string, TeamGameEfficiency & { driveIds: Set<string> }>()
  selectedRows(csv, (row) => {
    const { game_id: gameId, game_date: date, home_team: home, away_team: away, posteam: team, defteam: opponent } = row
    if (row.season_type !== 'REG' || date >= cutoff || !/^20\d\d-\d\d-\d\d$/.test(date) ||
      (row.play_type !== 'pass' && row.play_type !== 'run') || row.qb_spike === '1' || row.qb_kneel === '1' ||
      !gameId || !row.drive || !team || !opponent || (team !== home && team !== away) ||
      opponent !== (team === home ? away : home)) return
    const epa = Number(row.epa), success = Number(row.success), first = Number(row.first_down)
    if (!row.epa || !Number.isFinite(epa) || !['0', '1'].includes(row.success) || !['0', '1'].includes(row.first_down)) return
    const key = `${gameId}:${team}`
    if (!groups.has(key)) groups.set(key, { gameId, date, team, opponent, plays: 0, epaSum: 0,
      successes: 0, firstDowns: 0, drives: 0, driveIds: new Set() })
    const game = groups.get(key)!
    if (game.date !== date || game.opponent !== opponent) throw new Error('Conflicting play-by-play game identity')
    game.plays++; game.epaSum += epa; game.successes += success; game.firstDowns += first
    game.driveIds.add(row.drive)
  })
  return Array.from(groups.values()).filter((g) => g.plays >= 20).map(({ driveIds, ...g }) => ({
    ...g, drives: driveIds.size, epaSum: Number(g.epaSum.toFixed(6)),
  })).sort((a, b) => a.date.localeCompare(b.date) || a.gameId.localeCompare(b.gameId) || a.team.localeCompare(b.team))
}

const seasonFor = (date: string) => Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) <= 3 ? 1 : 0)
export async function refreshEfficiency(snapshot: EfficiencySnapshot, completed: CompletedGame[], cutoff: string,
  fetcher: typeof fetch = fetch): Promise<{ snapshot: EfficiencySnapshot | null; status: 'current' | 'refreshed' | 'unavailable' }> {
  const missing = completed.filter((g) => g.date > snapshot.lastGameDate && g.date < cutoff)
  if (!missing.length) return { snapshot, status: 'current' }
  const seasons = [...new Set(missing.map((g) => seasonFor(g.date)))]
  if (seasons.length > 2) return { snapshot: null, status: 'unavailable' }
  try {
    const updates = await Promise.all(seasons.map(async (season) => {
      const url = SOURCE.replace('{}', String(season))
      const response = await fetcher(url, { signal: AbortSignal.timeout(15000) })
      if (!response.ok) throw new Error('Play-by-play unavailable')
      const compressed = Buffer.from(await response.arrayBuffer())
      if (compressed.length > 25_000_000 || compressed.length < 100) throw new Error('Invalid play-by-play size')
      const raw = gunzipSync(compressed, { maxOutputLength: 150_000_000 }).toString('utf8')
      const games = parseEfficiencyCsv(raw, cutoff)
      return { games, source: { url, sha256: createHash('sha256').update(compressed).digest('hex'), rows: games.length } }
    }))
    const updated = updates.flatMap((batch) => batch.games)
    if (missing.some((game) => ![game.home, game.away].every((team) => updated.some((entry) =>
      entry.date === game.date && entry.team === team && entry.opponent === (team === game.home ? game.away : game.home))))) {
      return { snapshot: null, status: 'unavailable' }
    }
    const byGame = new Map(snapshot.games.map((game) => [`${game.gameId}:${game.team}`, game]))
    for (const game of updated) byGame.set(`${game.gameId}:${game.team}`, game)
    return { snapshot: { ...snapshot, games: [...byGame.values()].sort((a, b) => a.date.localeCompare(b.date)),
      lastGameDate: missing.reduce((latest, game) => game.date > latest ? game.date : latest, snapshot.lastGameDate),
      generatedAt: new Date().toISOString(), sources: [...snapshot.sources, ...updates.map((batch) => batch.source)] }, status: 'refreshed' }
  } catch { return { snapshot: null, status: 'unavailable' } }
}
