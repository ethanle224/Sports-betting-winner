// Play-by-play metrics are context only; the held-out test did not justify changing probabilities with them.
export type TeamGameEfficiency = { gameId: string; date: string; team: string; opponent: string;
  plays: number; epaSum: number; successes: number; firstDowns: number; drives: number }
export type EfficiencySnapshot = { version: number; generatedAt: string; lastGameDate: string;
  sources: { url: string; sha256: string; rows: number }[]; games: TeamGameEfficiency[] }
export type EfficiencyRates = { epaPerPlay: number; successRate: number; firstDownsPerGame: number;
  playsPerGame: number; drivesPerGame: number; games: number }
export type MatchupContext = { home: { team: string; offense: EfficiencyRates; opposingDefense: EfficiencyRates };
  away: { team: string; offense: EfficiencyRates; opposingDefense: EfficiencyRates };
  snapshotThrough: string; source: string; probabilityAdjustment: false }

function rates(entries: TeamGameEfficiency[]): EfficiencyRates {
  const plays = entries.reduce((n, g) => n + g.plays, 0)
  const sum = (key: 'epaSum' | 'successes' | 'firstDowns' | 'drives' | 'plays') => entries.reduce((n, g) => n + g[key], 0)
  return { epaPerPlay: sum('epaSum') / plays, successRate: sum('successes') / plays,
    firstDownsPerGame: sum('firstDowns') / entries.length, playsPerGame: sum('plays') / entries.length,
    drivesPerGame: sum('drives') / entries.length, games: entries.length }
}

export function matchupContext(snapshot: EfficiencySnapshot, home: string, away: string,
  cutoff: string, latestCompletedDate: string): MatchupContext | null {
  if (snapshot.version !== 1 || snapshot.lastGameDate < latestCompletedDate || home === away) return null
  const start = `${Number(cutoff.slice(0, 4)) - 2}-01-01`
  const prior = snapshot.games.filter((g) => g.date < cutoff && g.date >= start && g.plays >= 20)
  const recent = (team: string, defense: boolean) => prior.filter((g) => (defense ? g.opponent : g.team) === team).slice(-16)
  const ho = recent(home, false); const hd = recent(home, true)
  const ao = recent(away, false); const ad = recent(away, true)
  if ([ho, hd, ao, ad].some((list) => list.length < 6)) return null
  return { home: { team: home, offense: rates(ho), opposingDefense: rates(ad) },
    away: { team: away, offense: rates(ao), opposingDefense: rates(hd) },
    snapshotThrough: snapshot.lastGameDate, source: 'nflverse play-by-play', probabilityAdjustment: false }
}
