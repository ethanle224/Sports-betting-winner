// Experimental pregame score-distribution baseline. No Kalshi prices enter this model.
export type CompletedGame = { date: string; home: string; away: string; homeScore: number; awayScore: number }
export type ScoreForecast = { samples: [number, number][]; projectedHome: number; projectedAway: number; trainingGames: number }
export type ScoreModel = { games: CompletedGame[]; homeMean: number; awayMean: number; leagueMean: number }

export function csvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++ } else quoted = !quoted }
    else if (ch === ',' && !quoted) { row.push(field); field = '' }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); if (row.some((v) => v !== '')) rows.push(row)
      row = []; field = ''
    } else field += ch
  }
  if (quoted) throw new Error('Unterminated CSV field')
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}

export function parseGamesCsv(csv: string): CompletedGame[] {
  const [header, ...rows] = csvRows(csv)
  if (!header) throw new Error('Empty schedule')
  const index = (name: string) => { const i = header.indexOf(name); if (i < 0) throw new Error(`Schedule missing ${name}`); return i }
  const fields = ['game_type', 'gameday', 'home_team', 'away_team', 'home_score', 'away_score'].map(index)
  return rows.flatMap((row) => {
    const [kind, date, home, away, homeText, awayText] = fields.map((i) => row[i])
    if (kind !== 'REG' || !/^20\d\d-\d\d-\d\d$/.test(date || '') || !home || !away || !/^\d{1,2}$/.test(homeText || '') || !/^\d{1,2}$/.test(awayText || '')) return []
    return [{ date, home, away, homeScore: Number(homeText), awayScore: Number(awayText) }]
  })
}

export function parseScheduleCsv(csv: string, date: string): { home: string; away: string; date: string }[] {
  const [header, ...rows] = csvRows(csv)
  if (!header) throw new Error('Empty schedule')
  const fields = ['game_type', 'gameday', 'home_team', 'away_team'].map((key) => {
    const i = header.indexOf(key); if (i < 0) throw new Error(`Schedule missing ${key}`); return i
  })
  return rows.flatMap((row) => {
    const [kind, day, home, away] = fields.map((i) => row[i])
    return kind === 'REG' && day === date && home && away ? [{ home, away, date: day }] : []
  })
}

export function fitScoreModel(games: CompletedGame[], cutoff: string): ScoreModel | null {
  const prior = games.filter((g) => g.date < cutoff && g.date >= `${Number(cutoff.slice(0, 4)) - 2}-01-01` &&
    Number.isInteger(g.homeScore) && Number.isInteger(g.awayScore) && g.homeScore >= 0 && g.awayScore >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (prior.length < 24) return null
  return { games: prior, homeMean: prior.reduce((n, g) => n + g.homeScore, 0) / prior.length,
    awayMean: prior.reduce((n, g) => n + g.awayScore, 0) / prior.length,
    leagueMean: prior.reduce((n, g) => n + g.homeScore + g.awayScore, 0) / (2 * prior.length) }
}

export function forecastGame(model: ScoreModel, home: string, away: string): ScoreForecast | null {
  if (home === away) return null
  const gamesFor = (team: string) => model.games.filter((g) => g.home === team || g.away === team).slice(-16)
  const h = gamesFor(home); const a = gamesFor(away)
  if (h.length < 6 || a.length < 6) return null
  const average = (games: CompletedGame[], team: string, scored: boolean) => games.reduce((n, g) => n +
    (g.home === team ? scored ? g.homeScore : g.awayScore : scored ? g.awayScore : g.homeScore), 0) / games.length
  // Shrink small team samples toward the league; combine each offense with opposing defense.
  const shrink = (value: number, count: number) => (value * count + model.leagueMean * 8) / (count + 8)
  const projectedHome = Math.max(0, shrink(average(h, home, true), h.length) + shrink(average(a, away, false), a.length) - model.leagueMean + (model.homeMean - model.awayMean) / 2)
  const projectedAway = Math.max(0, shrink(average(a, away, true), a.length) + shrink(average(h, home, false), h.length) - model.leagueMean - (model.homeMean - model.awayMean) / 2)
  // Paired past score residuals preserve some game-level scoring correlation.
  const samples: [number, number][] = model.games.slice(-512).map((g) => [
    Math.max(0, Math.round(projectedHome + g.homeScore - model.homeMean)),
    Math.max(0, Math.round(projectedAway + g.awayScore - model.awayMean)),
  ])
  return { samples, projectedHome, projectedAway, trainingGames: model.games.length }
}
