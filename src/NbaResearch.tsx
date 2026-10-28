import { useEffect, useRef, useState } from 'react'
import { nbaLineChance, type NbaForecast } from '../server/nba-model'
import NbaFreezePanel from './NbaFreezePanel'
import { NBA_FREEZE_KEY, NBA_REVIEW_KEY, nbaSideLabel, trackNbaPick, type NbaScan, type NbaScanGame, type NbaStudySide } from './nba-paper'
import { NBA_AUDIT_KEY } from './nba-audit'
import { cloudValidationStorage, loadNbaCloudLedger, saveNbaCloudRecord, type NbaCloudLedger } from './nba-cloud-ledger'
import type { NbaFactor } from '../server/nba-factors'
import { summarizeNbaSimulation } from './nba-simulation-summary'

type Team = { id: string; name: string; abbreviation: string; pointsFor: number; pointsAgainst: number; wins: number; losses: number }
type Meeting = { id: string; tip: string; homeId: string; awayId: string; homeScore: number; awayScore: number; neutral: boolean }
type VenueRecord = { wins: number; losses: number; margin: number } | null
type Game = { id: string; home: string; away: string; homeId: string; awayId: string; startsAt: string; status: string;
  neutral?: boolean; forecast?: NbaForecast | null; meetings?: Meeting[]; venueContext?: { home: VenueRecord; awayRoad: VenueRecord } }
type Research = { date: string; observedAt: string; priorSeason: string; teams: Team[]; games: Game[];
  historyObservedAt?: string; currentSeasonFinals?: number;
  sources: { standings: string; schedule: string; history?: { url: string; sha256: string }[]; currentHistory?: string[] }; ratingsStatus: string; forecastStatus: string }
type KalshiStudy = NbaScan & { sources: { schedule: string; markets: string; feeSchedule: string } }
function defaultScanDate() {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const local = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
  return local < '2026-10-20' ? '2026-10-20' : local > '2027-04-11' ? '2027-04-11' : local
}

const factorLabels: { key: keyof NonNullable<NbaScanGame['factors']>; label: string }[] = [
  { key: 'injuries', label: 'Injury' }, { key: 'starters', label: 'Confirmed starters' },
  { key: 'offenseDefense', label: 'Prior-season offense / defense' }, { key: 'pace', label: 'Pace proxy' },
  { key: 'threes', label: 'Three-point profile' }, { key: 'ballMovement', label: 'Ball movement proxy' },
  { key: 'shotZones', label: '3-point / paint / midrange matchup' },
  { key: 'rosterMatchup', label: 'Roster-adjusted matchup' }, { key: 'marketDisagreement', label: 'Model / sportsbook margin' }, { key: 'venueH2H', label: 'Venue / H2H' },
  { key: 'contractRules', label: 'Contract rules' }, { key: 'fairPrice', label: 'Fair-price clause' },
  { key: 'fees', label: 'Current fees' }, { key: 'depth', label: 'Displayed sized depth' },
  { key: 'fillability', label: 'Final fillability' },
]

function FactorChecks({ game }: { game: NbaScanGame }) {
  const evidence = factorLabels.map(({ key, label }) => ({ label, value: game.factors?.[key] ??
    { status: 'unknown', detail: 'This scan did not return factor evidence.' } as NbaFactor }))
  const known = evidence.filter(({ value }) => value.status !== 'unknown').length
  return <><p className="nba-factor-summary">Evidence: {known} of {evidence.length} checks observed or estimated · not a qualified edge</p>
    <details className="nba-factor-details"><summary>Evidence &amp; gaps</summary>
      <ul className="nba-study-checks">{evidence.map(({ label, value }) => <li key={label}>
        <strong>{label} · {value.status.charAt(0).toUpperCase() + value.status.slice(1)}</strong>: {value.detail}
        {value.observedAt && <span> · observed {new Date(value.observedAt).toLocaleString()}</span>}
        {value.source?.split(' · ').filter((source) => source.startsWith('https://')).map((source, index) =>
          <span key={source}> · <a href={source} target="_blank" rel="noreferrer" aria-label={`${label} source${index ? ` ${index + 1}` : ''}`}>source{index ? ` ${index + 1}` : ''} ↗</a></span>)}
        {value.players?.length ? <ul>{value.players.map((player) => <li key={`${player.team}:${player.name}`}>
          {player.team}: {player.name} — {player.status} · reported {new Date(player.reportedAt).toLocaleString()}
        </li>)}</ul> : null}
      </li>)}</ul>
      <p>ESPN injury listings are reported statuses, not complete official clearance. <a href="https://official.nba.com/" target="_blank" rel="noreferrer">Check official NBA injury reports ↗</a> before tip. Historical factors are context, not new model weights. Refresh the scan near tip.</p>
    </details></>
}

function PlayerTotalsShadow({ game }: { game: NbaScanGame }) {
  if (!game.playerTotals) return null
  const active = game.selectionPolicy === 'nba-primary-v4-player-totals-v2'
  const { simulation, comparison } = game.playerTotals
  const summary = summarizeNbaSimulation(simulation)
  const highestProbability = [...comparison.candidates].filter((side) => Number.isFinite(side.probability) &&
    side.probability >= 0 && side.probability <= 1).sort((a, b) => b.probability - a.probability ||
      b.estimatedNetEdge - a.estimatedNetEdge || a.ticker.localeCompare(b.ticker) || a.side.localeCompare(b.side))[0]
  return <details className="nba-factor-details"><summary>{active ? 'Player Simulation v2 · main paper model' : 'Player totals · shadow only'}</summary>
    {simulation.version && <p><code>{simulation.version}</code> · {active ? 'Active paper selector; unvalidated, not a qualified betting edge.' : 'Pregame research, not a validated replacement model.'}</p>}
    {simulation.status === 'estimated' ? <>
      <p>{simulation.simulations.toLocaleString('en-US')} simulations · mean total {simulation.expectedTotal?.toFixed(1)} · simulated SD {simulation.totalSd?.toFixed(1)}. Uncalibrated recent-rotation model, not a verified lineup forecast.</p>
      {summary && <>
        <p>Paired score means: {game.home} {summary.meanHome.toFixed(1)} · {game.away} {summary.meanAway.toFixed(1)}. {game.home} won {(summary.homeWin * 100).toFixed(1)}% of simulated games; this is not a calibrated moneyline probability.</p>
        <p>Median total {summary.medianTotal.toFixed(1)} · central 80% of simulated totals {summary.p10Total.toFixed(1)}–{summary.p90Total.toFixed(1)}. Empirical draw range, not a validated real-game prediction interval.</p>
      </>}
      {simulation.inputs && <>
        <div className="table-wrap"><table aria-label="Current-season simulation inputs"><thead><tr><th>TEAM</th><th>GAMES</th><th>POINTS FOR /48</th><th>ALLOWED /48</th><th>POSSESSIONS /48</th><th>MODEL MODE</th></tr></thead><tbody>
          {(['home', 'away'] as const).map((side) => { const input = simulation.inputs![side]
            return <tr key={side}><td>{game[side]}</td><td>{input.gameIds.length}</td><td>{input.scoring?.pointsForPer48.toFixed(1) ?? 'unknown'}</td><td>{input.scoring?.pointsAllowedPer48.toFixed(1) ?? 'unknown'}</td><td>{input.possessions?.per48?.toFixed(1) ?? 'unknown'}</td><td>{input.drivers?.mode ?? 'legacy shooting model'}</td></tr> })}
        </tbody></table></div>
        <p className="help">Points allowed and points given up are the same input, counted once. {['nba-player-totals-v2', 'nba-player-totals-shadow-v2'].includes(simulation.version) ? 'Regulation-normalized scoring and estimated pace (when available) affect v2; context-only stats do not receive invented score bonuses.' : 'Legacy simulation: expanded scoring and pace inputs were not captured. Old evidence is not backfilled.'}</p>
        <details><summary>Player minutes &amp; plus-minus inputs</summary>
          <div className="table-wrap"><table aria-label="Player plus-minus context"><thead><tr><th>TEAM</th><th>PLAYER</th><th>MIN / GAME</th><th>+/- / OBSERVED GAME</th><th>+/- GAMES</th></tr></thead><tbody>
            {(['home', 'away'] as const).flatMap((side) => simulation.inputs![side].players.map((player) =>
              <tr key={`${side}:${player.id}`}><td>{game[side]}</td><td>{player.name}</td><td>{player.meanMinutes.toFixed(1)}</td><td>{player.plusMinus?.perGame?.toFixed(1) ?? 'unknown'}</td><td>{player.plusMinus?.observedGames ?? 'unknown'}</td></tr>))}
          </tbody></table></div>
          <p>Plus-minus is not individual points allowed. It is recorded as reconciled context with zero extra scoring weight: unadjusted +/- overlaps team margin and cannot isolate a player's defensive impact. Missing is unknown, not zero.</p>
        </details>
      </>}
      <p className="help">Monte Carlo noise alone can be about ±3.1 percentage points near 50%; real model and roster uncertainty is larger. Highest probability and largest estimated cost gap are different rankings.</p>
      {highestProbability && <p>Highest simulated chance on inspected totals: {nbaSideLabel(highestProbability, game)} · {(highestProbability.probability * 100).toFixed(1)}%. A higher hit rate can still offer worse value or lose money after costs.</p>}
      {active ? game.studySide ? <p>Main v2 paper choice: <strong>{nbaSideLabel(game.studySide, game)}</strong> · v2 simulation chance {(game.studySide.probability * 100).toFixed(1)}%. Experimental, not a calibrated win rate.</p> : <p>No eligible positive-gap v2 paper choice. No fallback to the old model.</p> : comparison.studySide ? <p>Top positive-gap shadow: <strong>{nbaSideLabel(comparison.studySide, game)}</strong> · {(comparison.studySide.probability * 100).toFixed(1)}% simulated chance. Not promoted to a pick.</p> : <p>No positive-gap player shadow on the observed quotes.</p>}
      {comparison.candidates.length > 0 && <div className="table-wrap"><table aria-label="Same-quote total estimates"><thead><tr><th>GAP RANK</th><th>TOTAL</th><th>BASELINE %</th><th>PLAYER %</th><th>ALL-IN ¢</th><th>GAP pp</th></tr></thead><tbody>
        {comparison.candidates.map((side, index) => { const baseline = comparison.baselineCandidates.find((item) => item.ticker === side.ticker && item.side === side.side)
          return <tr key={`${side.ticker}:${side.side}`}><td>{index + 1}</td><td>{nbaSideLabel(side, game)}</td><td>{baseline ? (baseline.probability * 100).toFixed(1) : 'unknown'}</td><td>{(side.probability * 100).toFixed(1)}</td><td>{(side.allInCost * 100).toFixed(2)}</td><td>{(side.estimatedNetEdge * 100).toFixed(2)}</td></tr> })}
      </tbody></table></div>}
    </> : <p>{simulation.reason ?? 'Player inputs unavailable; no simulation estimate.'}</p>}
    <ul>{[...simulation.assumptions, ...simulation.unknowns].map((detail) => <li key={detail}>{detail}</li>)}</ul>
    {simulation.sources.map((source, index) => <span key={source}><a href={source} target="_blank" rel="noreferrer">Box score {index + 1}</a>{' '}</span>)}
    <p className="help">{active ? 'v2 chooses at most one main paper pick per game. The old score-only model is frozen separately for comparison. No real orders.' : 'Research comparison only. No extra tracker pick and no change to the primary selection.'}</p>
  </details>
}

function PricedOption({ side, game, leading = false, model }: { side: NbaStudySide; game: NbaScanGame; leading?: boolean; model?: 'baseline' | 'v2' }) {
  const playerModel = model ? model === 'v2' : game.selectionPolicy === 'nba-primary-v4-player-totals-v2'
  return <div className="nba-priced-option"><strong>{nbaSideLabel(side, game)}</strong> <span className="nba-option-status">{leading ? 'TOP STUDY · ' : ''}NOT QUALIFIED</span>
    {leading && <p className="nba-pick-economics">1u paper stake · all-in {(side.allInCost * 100).toFixed(2)}¢ · win {side.allInCost > 0 ? `+${(1 / side.allInCost - 1).toFixed(2)}u` : 'unavailable'} · loss −1u</p>}
    <details><summary>Reasoning &amp; risks — {nbaSideLabel(side, game)}</summary>
      <p><code>{side.ticker}</code> · {side.side.toUpperCase()} · {side.market} · 10 paper contracts</p>
      <p>{playerModel ? 'Player Simulation v2' : 'Score-only model'} {(side.probability * 100).toFixed(1)}% · sized quote {(side.price * 100).toFixed(1)}¢ + estimated fee {(side.feeEstimate / 10 * 100).toFixed(2)}¢ per contract · all-in {(side.allInCost * 100).toFixed(2)}¢ · model–cost gap {(side.estimatedNetEdge * 100).toFixed(2)} pp.</p>
      {side.market === 'total' && <p>Pregame sportsbook total: {game.totalBenchmark?.reference ?? 'unavailable'} ({game.totalBenchmark?.provider ?? 'unknown provider'}). {game.totalBenchmark?.reason ?? 'No independent comparison captured.'}</p>}
      <p>Ranked by {playerModel ? 'v2 simulation' : 'score-only'} probability minus estimated all-in cost at this scan, with a limited nearby-total comparison when a sportsbook reference exists. Neither a positive model–cost gap nor a closer total proves a safer or profitable pick. This side pays $1 only if its exact {side.side.toUpperCase()} contract outcome occurs; displayed book depth is not a fill.</p>
      <p>Current injuries and lineup, historical team context, rules, fees and book checks have separate sourced statuses under Evidence &amp; gaps. A displayed quote cannot prove a fill. Fair-price settlement can differ from binary results. Rerun the scan before tip.</p>
      <p>Exact rule: {side.rules}</p><p>{side.rulesSecondary}</p>
    </details></div>
}

export default function NbaResearch({ onLogout }: { onLogout: () => Promise<void> }) {
  const [date, setDate] = useState(defaultScanDate)
  const [data, setData] = useState<Research | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState('')
  const [spread, setSpread] = useState('-3.5')
  const [total, setTotal] = useState('224.5')
  const [study, setStudy] = useState<KalshiStudy | null>(null)
  const [scanBusy, setScanBusy] = useState(false)
  const scanSequence = useRef(0)
  const [scanError, setScanError] = useState('')
  const [nbaView, setNbaView] = useState<'scan' | 'history'>('scan')
  const [cloud, setCloud] = useState<NbaCloudLedger | null>(null)
  const [cloudError, setCloudError] = useState('')
  const [tracked, setTracked] = useState<string[]>([])
  const [ledgerRevision, setLedgerRevision] = useState(0)
  const [trackError, setTrackError] = useState('')
  function downloadLegacyBackup() {
    try {
      const payload = { freezes: localStorage.getItem(NBA_FREEZE_KEY), reviews: localStorage.getItem(NBA_REVIEW_KEY), audits: localStorage.getItem(NBA_AUDIT_KEY) }
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a'); link.href = url; link.download = 'edgeboard-nba-legacy-backup.json'; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch { setCloudError('Could not export legacy browser records; do not clear this browser data') }
  }
  const tracking = useRef(new Set<string>())
  const [trackingId, setTrackingId] = useState('')
  useEffect(() => {
    let active = true
    loadNbaCloudLedger().then((ledger) => {
      if (!active) return
      setCloud(ledger)
      setTracked(ledger.freezes.flatMap((record) => record.decisions.filter((decision) => decision.selected && decision.evidence?.requestedPaper).map((decision) => decision.gameId)))
      setCloudError('')
    }).catch((failure) => { if (active) setCloudError(failure instanceof Error ? failure.message : 'Cloud ledger unavailable') })
    return () => { active = false }
  }, [])
  async function trackPick(gameId: string) {
    if (!study || !cloud || tracking.current.has(gameId)) return
    tracking.current.add(gameId); setTrackingId(gameId)
    try {
      const record = trackNbaPick(cloudValidationStorage(cloud), study, gameId, new Date().toISOString())
      await saveNbaCloudRecord('freeze', record)
      setCloud((old) => old ? { ...old, freezes: [...old.freezes, record] } : old)
      setTracked((old) => [...old, gameId]); setLedgerRevision((old) => old + 1); setTrackError('')
    } catch (failure) { setTrackError(failure instanceof Error ? failure.message : 'Paper pick not saved') }
    finally { tracking.current.delete(gameId); setTrackingId('') }
  }
  function changeDate(next: string) {
    scanSequence.current++
    setDate(next); setStudy(null); setScanError('')
  }
  async function scanSlate() {
    const requestId = ++scanSequence.current
    setStudy(null); setTrackError(''); setScanError(''); setScanBusy(true)
    try {
      const response = await fetch(`/api/nba-scan?date=${encodeURIComponent(date)}&quantity=10`, { credentials: 'same-origin' })
      if (response.status === 401) throw new Error('Session expired. Sign in again to scan the slate.')
      if (!response.ok) throw new Error('Kalshi scan unavailable. No partial study sides shown.')
      const payload: KalshiStudy = await response.json()
      if (payload.date !== date || payload.status !== 'STUDY_ONLY_NO_QUALIFIED_PICKS' ||
        !Array.isArray(payload.games) || payload.games.length > 15 ||
        new Set(payload.games.map((item) => item.gameId)).size !== payload.games.length || !Array.isArray(payload.marketInventory) ||
        !Array.isArray(payload.series) || !payload.historyObservedAt || payload.games.some((item) => item.qualifiedPaperPick !== false || !Array.isArray(item.inspected))) {
        throw new Error('Kalshi scan incomplete. No partial study sides shown.')
      }
      if (requestId === scanSequence.current) setStudy(payload)
    } catch (failure) {
      if (requestId === scanSequence.current) setScanError(failure instanceof Error ? failure.message : 'Kalshi scan unavailable')
    }
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
  return <main className="shell nba-research" id="nba-research">
    <nav className="nba-view-tabs" role="tablist" aria-label="NBA paper workspace"><button type="button" role="tab" aria-selected={nbaView === 'scan'} onClick={() => setNbaView('scan')}>Scan &amp; choices</button><button type="button" role="tab" aria-selected={nbaView === 'history'} onClick={() => setNbaView('history')}>Bet history</button></nav>
    <header className="topbar"><a className="brand" href="#nba-research" aria-label="Edgeboard NBA home"><span className="brand-mark">E</span><span>EDGEBOARD</span></a><div className="topbar-actions"><span className="status">NBA PAPER RESEARCH · NO REAL ORDERS</span><button className="logout" type="button" onClick={() => void onLogout()}>Log out</button></div></header>
    <section className="board nba-paper-workspace" aria-label="NBA slate study checklist"><p className="eyebrow">01 / NBA PAPER DESK</p><h2>Scan slate &amp; track results</h2>
      {nbaView === 'scan' && <>
      <p className="help">Scan, pick a side, tap Track. Each confirmed click saves one pending 1u paper study to the signed-in cloud ledger. Old browser records are migrated without deleting them. Not a qualified edge or real order.</p>
      <p className="help">New scans use Player Simulation v2 as the main paper selector: 1,000 simulated games, at most one positive-estimated-gap total per game, no old-model fallback. The old score-only selection stays frozen for comparison.</p>
      <div className="scan-controls"><label>Scan game date<input type="date" min="2026-10-20" max="2027-04-11" value={date} onChange={(event) => changeDate(event.target.value)} /></label>
        <button type="button" disabled={scanBusy || !date} onClick={() => void scanSlate()}>{scanBusy ? 'Scanning Kalshi…' : 'Scan slate'}</button></div>
      {scanError && <><p role="alert">{scanError}</p>{scanError.startsWith('Session expired.') &&
        <button type="button" onClick={() => void onLogout()}>Sign in again</button>}</>}{trackError && <p role="alert">{trackError}</p>}
      {cloudError && <><p role="alert">{cloudError}. Browser records remain intact; export them before clearing site data.</p><button type="button" onClick={downloadLegacyBackup}>Download legacy browser backup</button></>}
      {study && study.date === date && <><p className="help">{study.date} slate · observed {new Date(study.observedAt).toLocaleString()} · current-season final scores in history: {study.currentSeasonFinals ?? 'unknown'} · 10 whole contracts per inspected side · quotes may change before tip. <a href={study.sources.markets} target="_blank" rel="noreferrer">Kalshi public markets</a> · <a href={study.sources.feeSchedule} target="_blank" rel="noreferrer">fee schedule</a></p>
        {!study.games.length && <p className="help">No regular-season NBA games on this date. No paper choices.</p>}
        <div className="nba-study-grid">{study.games.map((item) => <article key={item.gameId} className="nba-study-card"><h3>{item.away} @ {item.home}</h3>
          {item.studySide ? <><p><strong>{item.selectionPolicy === 'nba-primary-v4-player-totals-v2' ? 'Player Simulation v2 · main paper pick · not a qualified bet' : 'Study side · not a qualified bet'}</strong></p><PricedOption side={item.studySide} game={item} leading />
            {item.shadowSide && <p className="help">Shadow comparison · {nbaSideLabel(item.shadowSide, item)} · model {(item.shadowSide.probability * 100).toFixed(1)}% · all-in {(item.shadowSide.allInCost * 100).toFixed(2)}¢ · simulated win {`+${(1 / item.shadowSide.allInCost - 1).toFixed(2)}u`} / loss −1u. Research only: not tracked as an extra pick. Near-market spreads require a sourced sportsbook reference; at least 1.7× gross payout, 55% experimental model chance and 3pp estimated gap. Top study, including totals, is unchanged.</p>}
            {item.pregameLine && <p className="help">Independent {item.pregameLine.provider} pregame reference: {item.home} {item.pregameLine.homeSpread > 0 ? '+' : ''}{item.pregameLine.homeSpread} · total {item.pregameLine.total ?? 'unavailable'} · <a href={item.pregameLine.source} target="_blank" rel="noreferrer">observed {new Date(item.pregameLine.observedAt).toLocaleString()}</a>. Not the selected Kalshi contract.</p>}
            <button className="nba-add-paper" type="button" disabled={!cloud || tracked.includes(item.gameId) || trackingId === item.gameId} onClick={() => void trackPick(item.gameId)}>
              {tracked.includes(item.gameId) ? `${nbaSideLabel(item.studySide, item)} tracked · see history` : trackingId === item.gameId ? 'Saving paper pick…' : `Track ${nbaSideLabel(item.studySide, item)} as paper pick · 1u`}
            </button>
            <details><summary>Other priced options ({Math.max(0, (item.candidates?.length ?? 1) - 1)})</summary>
              {(item.candidates ?? []).filter((candidate) => candidate.ticker !== item.studySide?.ticker || candidate.side !== item.studySide?.side).map((candidate) =>
                <PricedOption key={`${candidate.ticker}:${candidate.side}`} side={candidate} game={item} />)}</details></> : <>
            <p>{item.abstentionReason ?? 'No sized book/model comparison available. No study side invented.'}</p>
            {item.selectionPolicy !== 'nba-primary-v4-player-totals-v2' && item.baselineStudySide && <details><summary>Baseline comparison · research only, not a primary pick</summary>
              <PricedOption side={item.baselineStudySide} game={item} />
              <p className="help">Retained for same-time evaluation. No replacement total or reversed side is invented.</p></details>}
          </>}
          {item.selectionPolicy === 'nba-primary-v4-player-totals-v2' && item.baselineStudySide && <details className="nba-factor-details"><summary>Old score-only model · frozen comparison</summary>
            <PricedOption side={item.baselineStudySide} game={item} model="baseline" />
            <p>Retained with the same scan and quotes for comparison only. This does not choose the main pick or create a second tracked paper pick. Historical records are unchanged.</p>
          </details>}
          <PlayerTotalsShadow game={item} />
          <FactorChecks game={item} />
          <details className="nba-market-checks"><summary>Market coverage &amp; missing checks</summary>
          <p>Listed full-game contracts — ML: {item.coverage.moneyline} · Spread: {item.coverage.spread} · Total: {item.coverage.total}. {item.coverage.spread === 0 || item.coverage.total === 0 ? 'Missing market families are not simulated.' : ''}</p>
          <p className="help">{item.candidates?.length ?? (item.studySide ? 1 : 0)} priced options inspected from selected lines · listed contracts are not all priced or qualified.</p>
          <p>Game mapped: {item.checklist?.mappedGame ? 'verified against schedule' : 'unverified'}. Rest, travel and current-roster continuity remain unmodeled. Open Evidence &amp; gaps for each sourced status.</p></details>
        </article>)}</div></>}
      </>}
      {nbaView === 'history' && (cloud ? <NbaFreezePanel key={`history-${ledgerRevision}`} scan={null} view="history" cloudLedger={cloud} onCloudChange={setCloud} /> : <><p role="status">{cloudError ? 'NBA cloud ledger unavailable; history is not empty, but cannot be loaded.' : 'Loading NBA paper ledger…'}</p>{cloudError && <button type="button" onClick={downloadLegacyBackup}>Download legacy browser backup</button>}</>)}
    </section>
    <section className="hero"><div><p className="eyebrow">NBA / 2026–27 · PAPER RESEARCH ONLY</p><h1>A model.<br /><em>Not a promise.</em></h1><p className="lede">Our priority is net units after costs, not a promised win percentage. v2 simulation probabilities are experimental; they are not a proven betting edge. NFL forecasts, rules and paper records stay in their own tab.</p></div><aside className="risk-card"><span>DECISION STATUS</span><strong>Paper studies, not qualified picks</strong><div>The choices above are live-scan research leads. Current lineups, exact costs and prospective profitability remain unverified.</div></aside></section>
    <section className="board" aria-labelledby="matchups-heading"><p className="eyebrow">02 / MATCHUP DESK</p><h2 id="matchups-heading">Upcoming regular-season slate</h2>
      <p className="help">Old score-only matchup desk: comparison only. These baseline forecasts and line calculators do not choose the main v2 paper picks above.</p>
      <p className="help">Choose a regular-season game date. ESPN schedule and 2025–26 regular-season standings are fetched together; incomplete data fails closed. These are past team averages, not a 2026–27 lineup-adjusted forecast.</p>
      <div className="scan-controls"><label>NBA game date<input type="date" min="2026-10-20" max="2027-04-11" value={date} onChange={(event) => changeDate(event.target.value)} /></label><span>{busy ? 'Loading sourced NBA data…' : data ? `Observed ${new Date(data.observedAt).toLocaleString()}` : 'No current comparison'}</span></div>
      {error && <p role="alert">{error}</p>}
      {data && <>
        {data.games.length ? <div className="nba-game-list" role="group" aria-label="NBA matchups">{data.games.map((item) => <button key={item.id} type="button" aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>{item.away} @ {item.home}<small>{new Date(item.startsAt).toLocaleString()}</small></button>)}</div> : <p className="help">No regular-season games listed for this date. No picks implied.</p>}
        {home && away && <div className="nba-matchup"><h3>{away.name} @ {home.name}</h3><p>2025–26 regular-season context · W–L and points per game</p><div className="table-wrap"><table><thead><tr><th>TEAM</th><th>RECORD</th><th>POINTS SCORED / GAME</th><th>POINTS ALLOWED / GAME</th></tr></thead><tbody>{[away, home].map((team) => <tr key={team.id}><td><strong>{team.name}</strong></td><td>{team.wins}–{team.losses}</td><td>{team.pointsFor.toFixed(1)}</td><td>{team.pointsAgainst.toFixed(1)}</td></tr>)}</tbody></table></div><p className="help">Matchup lens: compare each team’s scoring with the other’s points allowed, but these are <strong>not possession-adjusted offensive or defensive ratings</strong>. Different rosters, pace and opponents invalidate a naïve points-to-win conversion. Offensive rating, defensive rating and lineup on/off impact remain unverified, not zero.</p></div>}
        {home && away && <div className="nba-model"><h3>NBA scores-only v2 · experimental</h3>{forecast ? <>
          <p>Expected home margin {forecast.expectedMargin.toFixed(1)} · game total {forecast.expectedTotal.toFixed(1)} · home-court baseline +{forecast.homeAdvantage.toFixed(1)} points {game?.neutral ? '(neutral: off)' : ''}.</p>
          <p>Moneyline estimate: {home.abbreviation} {(forecast.homeWin * 100).toFixed(1)}% · {away.abbreviation} {(forecast.awayWin * 100).toFixed(1)}%. This is not a wager or qualified paper pick.</p>
          <div className="nba-line-inputs"><label>Home spread (home points +/−)<input type="number" step="0.5" value={spread} onChange={(event) => setSpread(event.target.value)} /></label><label>Game total<input type="number" step="0.5" value={total} onChange={(event) => setTotal(event.target.value)} /></label></div>
          <p>{spreadChance === null ? 'Enter a half-point home spread.' : `${home.abbreviation} covers ${spread}: ${(spreadChance * 100).toFixed(1)}%`}{overChance === null || underChance === null ? ' · Enter a half-point total.' : ` · Over ${total}: ${(overChance * 100).toFixed(1)}% · Under ${total}: ${(underChance * 100).toFixed(1)}%`}</p>
          <p className="help">Lines above are manual research inputs, not live sportsbook or Kalshi quotes. Final current-season scores are refreshed when the public feed works ({data?.currentSeasonFinals ?? 'unknown'} included). Shot-location profiles are contextual with zero numerical weight. Model ignores current injuries, starters, verified transaction impact, travel and rest. First 2–3 weeks are high uncertainty, not a mandate to pick. History observed: {data?.historyObservedAt ?? 'unavailable'}.</p>
        </> : <p className="help">No pregame score forecast: tip has passed or required history/model inputs are incomplete. Refresh and verify the evidence before estimating probabilities.</p>}
        <h4>2025–26 venue splits · context only</h4><p>{home.abbreviation} 2025–26 home: {game?.venueContext?.home ? `${game.venueContext.home.wins}–${game.venueContext.home.losses} · ${game.venueContext.home.margin.toFixed(1)} avg margin` : 'unavailable'}<br />{away.abbreviation} 2025–26 road: {game?.venueContext?.awayRoad ? `${game.venueContext.awayRoad.wins}–${game.venueContext.awayRoad.losses} · ${game.venueContext.awayRoad.margin.toFixed(1)} avg margin` : 'unavailable'}</p>
        <h4>Recent head-to-head · context only</h4>{game?.meetings?.length ? <ul>{game.meetings.map((meeting) => <li key={meeting.id}><a href={`https://www.espn.com/nba/game/_/gameId/${encodeURIComponent(meeting.id)}`} target="_blank" rel="noreferrer">{meeting.tip.slice(0, 10)}</a> · {meeting.homeId === home.id ? home.abbreviation : away.abbreviation} home {meeting.homeScore}–{meeting.awayScore} {meeting.neutral ? '(neutral)' : ''}</li>)}</ul> : <p className="help">No recent meetings in the two-season history. Do not assume an unchanged rivalry edge.</p>}
        <p className="help">Head-to-head and team venue splits have <strong>zero extra numerical weight</strong> until a recency- and roster-adjusted feature improves forward tests. Home court is a league baseline, not a team-specific home-record bonus.</p></div>}
        <p className="help">Source: <a href={data.sources.standings} target="_blank" rel="noreferrer">ESPN 2025–26 standings</a> · <a href={data.sources.schedule} target="_blank" rel="noreferrer">ESPN game schedule</a>. Availability and ratings are not included; use the paper desk above for selected-date market depth.</p>
      </>}
    </section>
    <footer>NBA PRIORITY · EXPERIMENTAL PROBABILITIES · NO QUALIFIED PICKS OR REAL ORDERS</footer>
  </main>
}
