import { useEffect, useState } from 'react'
import { offseasonExamples } from './nba-offseason'
import { nbaLineChance, type NbaForecast } from '../server/nba-model'
import NbaFreezePanel from './NbaFreezePanel'
import type { NbaScan, NbaScanGame, NbaStudySide } from './nba-paper'

type Team = { id: string; name: string; abbreviation: string; pointsFor: number; pointsAgainst: number; wins: number; losses: number }
type Meeting = { id: string; tip: string; homeId: string; awayId: string; homeScore: number; awayScore: number; neutral: boolean }
type VenueRecord = { wins: number; losses: number; margin: number } | null
type Game = { id: string; home: string; away: string; homeId: string; awayId: string; startsAt: string; status: string;
  neutral?: boolean; forecast?: NbaForecast | null; meetings?: Meeting[]; venueContext?: { home: VenueRecord; awayRoad: VenueRecord } }
type Research = { date: string; observedAt: string; priorSeason: string; teams: Team[]; games: Game[];
  historyObservedAt?: string; sources: { standings: string; schedule: string; history?: { url: string; sha256: string }[] }; ratingsStatus: string; forecastStatus: string }
type KalshiStudy = NbaScan & { sources: { schedule: string; markets: string; feeSchedule: string } }

function sideLabel(side: NbaStudySide, game: NbaScanGame): string {
  if (side.market === 'total' && side.line !== null) return `${side.side === 'no' ? 'Under' : 'Over'} ${side.line}`
  const win = /^If (.+?) wins by more than ([\d.]+) points\b/.exec(side.rules)
  if (side.market === 'spread' && win && side.line !== null) {
    const team = side.side === 'yes' ? win[1] : win[1] === game.home ? game.away : game.home
    return `${team} ${side.side === 'yes' ? '-' : '+'}${side.line}`
  }
  const winner = /^If (.+?) wins\b/.exec(side.rules)
  if (side.market === 'moneyline' && winner) return `${side.side === 'yes' ? winner[1] : winner[1] === game.home ? game.away : game.home} winner`
  return `${side.side.toUpperCase()} · ${side.ticker}`
}

function PricedOption({ side, game, leading = false }: { side: NbaStudySide; game: NbaScanGame; leading?: boolean }) {
  return <div className="nba-priced-option"><strong>{sideLabel(side, game)}</strong> <span className="nba-option-status">{leading ? 'TOP STUDY · ' : ''}NOT QUALIFIED</span>
    <p><code>{side.ticker}</code> · {side.side.toUpperCase()} · {side.market} · 10 paper contracts</p>
    <p>Score-only model {(side.probability * 100).toFixed(1)}% · sized quote {(side.price * 100).toFixed(1)}¢ + estimated fee {(side.feeEstimate / 10 * 100).toFixed(2)}¢ per contract · all-in {(side.allInCost * 100).toFixed(2)}¢ · model–cost gap {(side.estimatedNetEdge * 100).toFixed(2)} pp.</p>
    <details><summary>Reasoning &amp; risks — {sideLabel(side, game)}</summary>
      <p>Ranked by score-only probability minus estimated all-in cost at this scan, not by preseason results or a validated edge. A positive model–cost gap is not a profit forecast. This side pays $1 only if its exact {side.side.toUpperCase()} contract outcome occurs; displayed book depth is not a fill.</p>
      <p>Still unverified: injuries, starters, roster-adjusted matchup, pace, threes, ball movement, current fees, and final fillability. Rerun the scan before tip. Venue and recent head-to-head are context, not extra numerical weight.</p>
      <p>Exact rule: {side.rules}</p><p>{side.rulesSecondary}</p>
    </details></div>
}

export default function NbaResearch({ onLogout }: { onLogout: () => Promise<void> }) {
  const [date, setDate] = useState('2026-10-20')
  const [data, setData] = useState<Research | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState('')
  const [filter, setFilter] = useState('')
  const [spread, setSpread] = useState('-3.5')
  const [total, setTotal] = useState('224.5')
  const [study, setStudy] = useState<KalshiStudy | null>(null)
  const [scanBusy, setScanBusy] = useState(false)
  const [scanError, setScanError] = useState('')
  const [nbaView, setNbaView] = useState<'scan' | 'history'>('scan')
  async function scanOpeningSlate() {
    setStudy(null); setScanError(''); setScanBusy(true)
    try {
      const response = await fetch('/api/nba-scan?date=2026-10-20&quantity=10', { credentials: 'same-origin' })
      if (!response.ok) throw new Error('Kalshi scan unavailable. No partial study sides shown.')
      const payload: KalshiStudy = await response.json()
      if (payload.date !== '2026-10-20' || payload.status !== 'STUDY_ONLY_NO_QUALIFIED_PICKS' ||
        !Array.isArray(payload.games) || payload.games.length !== 3 || !Array.isArray(payload.marketInventory) ||
        !Array.isArray(payload.series) || !payload.historyObservedAt || payload.games.some((item) => item.qualifiedPaperPick !== false || !Array.isArray(item.inspected))) {
        throw new Error('Kalshi scan incomplete. No partial study sides shown.')
      }
      setStudy(payload)
    } catch (failure) { setScanError(failure instanceof Error ? failure.message : 'Kalshi scan unavailable') }
    finally { setScanBusy(false) }
  }
  useEffect(() => {
    let active = true
    async function load() {
      setBusy(true); setError(''); setData(null); setSelected('')
      try {
        const response = await fetch(`/api/nba-research?date=${encodeURIComponent(date)}`, { credentials: 'same-origin' })
        if (!response.ok) throw new Error(`NBA data unavailable (HTTP ${response.status}). No partial comparison shown.`)
        const payload: Research = await response.json()
        if (!Array.isArray(payload.teams) || !Array.isArray(payload.games) || payload.ratingsStatus !== 'unavailable' || !['not modeled', 'experimental score-only'].includes(payload.forecastStatus)) throw new Error('NBA response incomplete. No comparison shown.')
        if (active) { setData(payload); setSelected(payload.games[0]?.id ?? '') }
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : 'NBA source unavailable')
      } finally { if (active) setBusy(false) }
    }
    void load()
    return () => { active = false }
  }, [date])
  const game = data?.games.find((item) => item.id === selected)
  const home = data?.teams.find((team) => team.id === game?.homeId)
  const away = data?.teams.find((team) => team.id === game?.awayId)
  const forecast = game?.forecast
  const spreadChance = forecast && spread.trim() ? nbaLineChance(forecast, 'homeSpread', Number(spread)) : null
  const overChance = forecast && total.trim() ? nbaLineChance(forecast, 'over', Number(total)) : null
  const underChance = forecast && total.trim() ? nbaLineChance(forecast, 'under', Number(total)) : null
  const relevantMoves = offseasonExamples.filter((move) => home && away && move.teams.some((team) => team === home.abbreviation || team === away.abbreviation))
  return <main className="shell nba-research" id="nba-research">
    <header className="topbar"><a className="brand" href="#nba-research" aria-label="Edgeboard NBA home"><span className="brand-mark">E</span><span>EDGEBOARD</span></a><div className="topbar-actions"><span className="status">NBA PAPER RESEARCH · NO REAL ORDERS</span><button className="logout" type="button" onClick={() => void onLogout()}>Log out</button></div></header>
    <section className="board nba-paper-workspace" aria-label="October 20 Kalshi study checklist"><p className="eyebrow">01 / NBA PAPER DESK</p><h2>Scan opening-night choices &amp; track results</h2>
      <div className="nba-view-tabs" role="tablist" aria-label="NBA paper workspace"><button type="button" role="tab" aria-selected={nbaView === 'scan'} onClick={() => setNbaView('scan')}>Scan &amp; choices</button><button type="button" role="tab" aria-selected={nbaView === 'history'} onClick={() => setNbaView('history')}>Bet history</button></div>
      {nbaView === 'scan' && <>
      <p className="help">One ranked study choice per game, with other inspected priced sides and expandable reasons. These are paper-only comparisons, not qualified picks or orders. Quotes and fees can change.</p>
      {date === '2026-10-20' ? <button type="button" disabled={scanBusy} onClick={() => void scanOpeningSlate()}>{scanBusy ? 'Scanning Kalshi…' : 'Scan Kalshi opening slate'}</button> : <p className="help">Exact Kalshi mapping is available for October 20 only; choose that date below to scan.</p>}
      {scanError && <p role="alert">{scanError}</p>}
      {study && date === '2026-10-20' && <><p className="help">Observed {new Date(study.observedAt).toLocaleString()} · 10 whole contracts per inspected side · quotes may change before tip. <a href={study.sources.markets} target="_blank" rel="noreferrer">Kalshi public markets</a> · <a href={study.sources.feeSchedule} target="_blank" rel="noreferrer">fee schedule</a></p>
        <div className="nba-study-grid">{study.games.map((item) => <article key={item.gameId} className="nba-study-card"><h3>{item.away} @ {item.home}</h3>
          <p>Listed full-game contracts — ML: {item.coverage.moneyline} · Spread: {item.coverage.spread} · Total: {item.coverage.total}. {item.coverage.spread === 0 || item.coverage.total === 0 ? 'Missing market families are not simulated.' : ''}</p>
          {item.studySide ? <><p><strong>Study side · not a qualified bet</strong></p><PricedOption side={item.studySide} game={item} leading />
            <details><summary>Other priced options ({Math.max(0, (item.candidates?.length ?? 1) - 1)})</summary>
              {(item.candidates ?? []).filter((candidate) => candidate.ticker !== item.studySide?.ticker || candidate.side !== item.studySide?.side).map((candidate) =>
                <PricedOption key={`${candidate.ticker}:${candidate.side}`} side={candidate} game={item} />)}</details></> : <p>No sized book/model comparison available. No study side invented.</p>}
          <p className="help">{item.candidates?.length ?? (item.studySide ? 1 : 0)} priced options inspected from selected lines · listed contracts are not all priced or qualified.</p>
          <ul className="nba-study-checks"><li>Game mapped: {item.checklist?.mappedGame ? 'verified against schedule' : 'unverified'}</li>
            <li>Offense vs defense and pace: raw scoring included; opponent-adjusted ratings and possessions unverified</li>
            <li>Three-point attempts, makes and opponent defense: unverified</li><li>Assists, touches and chemistry: unverified</li>
            <li>Venue and recent H2H: contextual below; zero extra numerical weight</li><li>Rest, travel and roster continuity: unverified</li>
            <li>Injury and expected lineup: unverified</li><li>Contract resolution / fair-price risk: unverified</li>
            <li>Final fee and fillability: unverified; current displayed depth is not a fill</li></ul>
        </article>)}</div></>}
      </>}
      <NbaFreezePanel key={study?.observedAt ?? 'no-scan'} scan={study} view={nbaView} />
    </section>
    <section className="hero"><div><p className="eyebrow">NBA / 2026–27 · PAPER RESEARCH ONLY</p><h1>A baseline.<br /><em>Not a promise.</em></h1><p className="lede">Our priority is net units after costs, not a promised win percentage. Scores-only probabilities are experimental; they are not a betting edge. NFL forecasts, rules and paper records stay in their own tab.</p></div><aside className="risk-card"><span>DECISION STATUS</span><strong>Paper studies, not qualified picks</strong><div>The choices above are live-scan research leads. Current lineups, exact costs and prospective profitability remain unverified.</div></aside></section>
    <section className="board" aria-labelledby="matchups-heading"><p className="eyebrow">02 / MATCHUP DESK</p><h2 id="matchups-heading">Upcoming regular-season slate</h2>
      <p className="help">Choose a regular-season game date. ESPN schedule and 2025–26 regular-season standings are fetched together; incomplete data fails closed. These are past team averages, not a 2026–27 lineup-adjusted forecast.</p>
      <div className="scan-controls"><label>NBA game date<input type="date" min="2026-10-20" max="2027-04-11" value={date} onChange={(event) => { setDate(event.target.value); setStudy(null); setScanError('') }} /></label><span>{busy ? 'Loading sourced NBA data…' : data ? `Observed ${new Date(data.observedAt).toLocaleString()}` : 'No current comparison'}</span></div>
      {error && <p role="alert">{error}</p>}
      {data && <>
        {data.games.length ? <div className="nba-game-list" role="group" aria-label="NBA matchups">{data.games.map((item) => <button key={item.id} type="button" aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>{item.away} @ {item.home}<small>{new Date(item.startsAt).toLocaleString()}</small></button>)}</div> : <p className="help">No regular-season games listed for this date. No picks implied.</p>}
        {home && away && <div className="nba-matchup"><h3>{away.name} @ {home.name}</h3><p>2025–26 regular-season context · W–L and points per game</p><div className="table-wrap"><table><thead><tr><th>TEAM</th><th>RECORD</th><th>POINTS SCORED / GAME</th><th>POINTS ALLOWED / GAME</th></tr></thead><tbody>{[away, home].map((team) => <tr key={team.id}><td><strong>{team.name}</strong></td><td>{team.wins}–{team.losses}</td><td>{team.pointsFor.toFixed(1)}</td><td>{team.pointsAgainst.toFixed(1)}</td></tr>)}</tbody></table></div><p className="help">Matchup lens: compare each team’s scoring with the other’s points allowed, but these are <strong>not possession-adjusted offensive or defensive ratings</strong>. Different rosters, pace and opponents invalidate a naïve points-to-win conversion. Offensive rating, defensive rating and lineup on/off impact remain unverified, not zero.</p></div>}
        {home && away && <div className="nba-model"><h3>NBA scores-only v1 · experimental</h3>{forecast ? <>
          <p>Expected home margin {forecast.expectedMargin.toFixed(1)} · game total {forecast.expectedTotal.toFixed(1)} · home-court baseline +{forecast.homeAdvantage.toFixed(1)} points {game?.neutral ? '(neutral: off)' : ''}.</p>
          <p>Moneyline estimate: {home.abbreviation} {(forecast.homeWin * 100).toFixed(1)}% · {away.abbreviation} {(forecast.awayWin * 100).toFixed(1)}%. This is not a wager or qualified paper pick.</p>
          <div className="nba-line-inputs"><label>Home spread (home points +/−)<input type="number" step="0.5" value={spread} onChange={(event) => setSpread(event.target.value)} /></label><label>Game total<input type="number" step="0.5" value={total} onChange={(event) => setTotal(event.target.value)} /></label></div>
          <p>{spreadChance === null ? 'Enter a half-point home spread.' : `${home.abbreviation} covers ${spread}: ${(spreadChance * 100).toFixed(1)}%`}{overChance === null || underChance === null ? ' · Enter a half-point total.' : ` · Over ${total}: ${(overChance * 100).toFixed(1)}% · Under ${total}: ${(underChance * 100).toFixed(1)}%`}</p>
          <p className="help">Lines above are manual research inputs, not live sportsbook or Kalshi quotes. Model ignores current injuries, starters, verified transaction impact, travel and rest. First 2–3 weeks are a high-uncertainty paper-learning period, not a mandate to pick. History snapshot: {data?.historyObservedAt ?? 'unavailable'}.</p>
        </> : <p className="help">No score forecast: history is stale for this game date or model inputs are incomplete. Refresh and verify the evidence before estimating probabilities.</p>}
        <h4>2025–26 venue splits · context only</h4><p>{home.abbreviation} 2025–26 home: {game?.venueContext?.home ? `${game.venueContext.home.wins}–${game.venueContext.home.losses} · ${game.venueContext.home.margin.toFixed(1)} avg margin` : 'unavailable'}<br />{away.abbreviation} 2025–26 road: {game?.venueContext?.awayRoad ? `${game.venueContext.awayRoad.wins}–${game.venueContext.awayRoad.losses} · ${game.venueContext.awayRoad.margin.toFixed(1)} avg margin` : 'unavailable'}</p>
        <h4>Recent head-to-head · context only</h4>{game?.meetings?.length ? <ul>{game.meetings.map((meeting) => <li key={meeting.id}><a href={`https://www.espn.com/nba/game/_/gameId/${encodeURIComponent(meeting.id)}`} target="_blank" rel="noreferrer">{meeting.tip.slice(0, 10)}</a> · {meeting.homeId === home.id ? home.abbreviation : away.abbreviation} home {meeting.homeScore}–{meeting.awayScore} {meeting.neutral ? '(neutral)' : ''}</li>)}</ul> : <p className="help">No recent meetings in the two-season history. Do not assume an unchanged rivalry edge.</p>}
        <p className="help">Head-to-head and team venue splits have <strong>zero extra numerical weight</strong> until a recency- and roster-adjusted feature improves forward tests. Home court is a league baseline, not a team-specific home-record bonus.</p></div>}
        <p className="help">Source: <a href={data.sources.standings} target="_blank" rel="noreferrer">ESPN 2025–26 standings</a> · <a href={data.sources.schedule} target="_blank" rel="noreferrer">ESPN game schedule</a>. Availability and ratings are not included; use the paper desk above for opening-slate market depth.</p>
      </>}
    </section>
    <section className="board" aria-labelledby="teams-heading"><p className="eyebrow">03 / LEAGUE BASELINE</p><h2 id="teams-heading">All teams · prior season</h2><p className="help">Every team’s 2025–26 W–L, scoring and points allowed. A roster overhaul can make these especially stale. No 2026–27 performance is implied.</p>
      {data && <><label className="nba-filter">Find team<input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Team name or abbreviation" /></label><div className="table-wrap nba-table"><table><thead><tr><th>TEAM</th><th>W–L</th><th>PTS/G</th><th>OPP PTS/G</th></tr></thead><tbody>{data.teams.filter((team) => `${team.name} ${team.abbreviation}`.toLowerCase().includes(filter.toLowerCase())).map((team) => <tr key={team.id}><td><strong>{team.name}</strong></td><td>{team.wins}–{team.losses}</td><td>{team.pointsFor.toFixed(1)}</td><td>{team.pointsAgainst.toFixed(1)}</td></tr>)}</tbody></table></div></>}
    </section>
    <section className="board" aria-labelledby="offseason-heading"><p className="eyebrow">04 / ROSTER INTELLIGENCE</p><h2 id="offseason-heading">Offseason &amp; availability</h2><p className="help">Trades, signings and rotations matter. Below are selected sourced examples checked October 5, 2026—not a complete transaction ledger or current-roster guarantee. Verify current lineups and injuries before using them; no numerical lineup adjustment is made.</p>
      {home && away && <div className="nba-moves"><h3>Selected moves involving {away.abbreviation} / {home.abbreviation}</h3>{relevantMoves.length ? <ul>{relevantMoves.map((move) => <li key={move.move}><time dateTime={move.date}>{move.date}</time><strong>{move.move}</strong><a href={move.source} target="_blank" rel="noreferrer">{move.sourceLabel} ↗</a></li>)}</ul> : <p className="help">No move in this limited selection; check the full trackers. This does not mean either roster is unchanged.</p>}</div>}
      <div className="nba-source-grid"><a href="https://www.nba.com/news/nba-offseason-deals-2026" target="_blank" rel="noreferrer">Official 2026 offseason deals<span>Trades · signings · departures by team ↗</span></a><a href="https://www.nba.com/news/2026-offseason-trade-tracker" target="_blank" rel="noreferrer">NBA trade tracker<span>Official transaction detail ↗</span></a><a href="https://www.nba.com/freeagents/2026" target="_blank" rel="noreferrer">NBA free agency hub<span>Signings and reporting ↗</span></a><a href="https://official.nba.com/" target="_blank" rel="noreferrer">NBA official reports<span>Confirm current injury availability ↗</span></a></div></section>

    <footer>NBA PRIORITY · EXPERIMENTAL PROBABILITIES · NO QUALIFIED PICKS OR REAL ORDERS</footer>
  </main>
}
