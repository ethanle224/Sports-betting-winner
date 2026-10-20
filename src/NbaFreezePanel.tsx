import { useState } from 'react'
import { appendNbaFreeze, appendNbaReview, freezeNbaStudy, readNbaFreezes, readNbaReviews, summarizeNbaHistory,
  type NbaEvidence, type NbaFreeze, type NbaReview, type NbaScan } from './nba-paper'

const empty: NbaEvidence = { requestedPaper: false, availabilitySource: '', availabilityObservedAt: '', availabilityNotes: '',
  rulesSource: '', feeSource: '', uncertaintyAccepted: false, rationale: '' }
const localTime = (iso: string) => {
  if (!iso || !Number.isFinite(Date.parse(iso))) return ''
  const time = new Date(iso)
  return new Date(time.getTime() - time.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function NbaSettlementForm({ record, gameId, ticker, side, onSaved }: { record: NbaFreeze; gameId: string; ticker: string; side: string; onSaved: (review: NbaReview) => void }) {
  const [outcome, setOutcome] = useState('')
  const [payout, setPayout] = useState('')
  const [source, setSource] = useState(`https://external-api.kalshi.com/trade-api/v2/markets/${ticker}`)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  function save() {
    try {
      const reviewed = appendNbaReview(localStorage, { scanId: record.id, gameId, observedAt: new Date().toISOString(),
        source, outcome: outcome as 'YES' | 'NO' | 'FAIR_PRICE', payout: Number(payout), note })
      onSaved(reviewed)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Cannot save review') }
  }
  return <fieldset aria-label={`Review frozen ${gameId}`} className="nba-review-form"><legend>Review frozen {gameId} · {ticker}</legend>
    <p className="help">Check the exact Kalshi contract result; selected paper side is {side.toUpperCase()}. This is an operator-attested simulation, not an actual fill. Fair-price resolutions are not binary.</p>
    <label>Settlement outcome<select value={outcome} onChange={(event) => { setOutcome(event.target.value); setPayout(event.target.value === 'FAIR_PRICE' || !event.target.value ? '' : event.target.value.toLowerCase() === side ? '1' : '0') }}>
      <option value="">Choose verified outcome</option><option value="YES">YES</option><option value="NO">NO</option><option value="FAIR_PRICE">FAIR_PRICE</option></select></label>
    {outcome === 'FAIR_PRICE' && <label>Selected-side fair-price payout per contract<input type="number" min="0" max="1" step="0.01" value={payout} onChange={(event) => setPayout(event.target.value)} /></label>}
    <label>Exact contract settlement URL<input type="url" value={source} onChange={(event) => setSource(event.target.value)} /></label>
    <label>Settlement evidence notes<textarea value={note} onChange={(event) => setNote(event.target.value)} /></label>
    <button type="button" onClick={save}>Save settlement review</button>{error && <p role="alert">{error}</p>}
  </fieldset>
}

export default function NbaFreezePanel({ scan, view = 'scan' }: { scan: NbaScan | null; view?: 'scan' | 'history' }) {
  const [evidence, setEvidence] = useState<Record<string, NbaEvidence>>({})
  const [initial] = useState(() => {
    try { return { records: readNbaFreezes(localStorage), reviews: readNbaReviews(localStorage), error: '' } }
    catch (failure) { return { records: [] as NbaFreeze[], reviews: [] as NbaReview[], error: failure instanceof Error ? failure.message : 'Cannot read NBA ledger' } }
  })
  const [records, setRecords] = useState<NbaFreeze[]>(initial.records)
  const [reviews, setReviews] = useState<NbaReview[]>(initial.reviews)
  const history = summarizeNbaHistory(records, reviews)
  const [error, setError] = useState(initial.error)
  const update = (id: string, changes: Partial<NbaEvidence>) => setEvidence((old) => ({ ...old, [id]: { ...empty, ...old[id], ...changes } }))
  function freeze() {
    if (!scan || error) return
    try {
      const record = freezeNbaStudy(scan, evidence, new Date().toISOString())
      setRecords(appendNbaFreeze(localStorage, record))
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Cannot freeze NBA snapshot') }
  }
  function download() {
    const all = readNbaFreezes(localStorage)
    const settled = readNbaReviews(localStorage)
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 'nba-paper-v1', freezes: all, reviews: settled }, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url; link.download = 'edgeboard-nba-paper-audit.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <div className="nba-freeze-panel">
    <h3>{view === 'scan' ? 'Opening slate decision freeze · browser-local' : 'NBA paper bet history · browser-local'}</h3>
    {view === 'scan' && <>
    <p className="help">Check “Request paper experiment” on each game you want tracked, then freeze the fresh scan before tip. If availability, rules, fees or rationale are incomplete, it stays a forced STUDY but still appears in Bet history for later settlement review. A PAPER_EXPERIMENT requires dated evidence and a positive estimated-cost gap; neither label is a qualified edge or real order. Save the JSON elsewhere—clearing browser data deletes local records.</p>
    {scan ? <div className="nba-evidence-grid">{scan.games.map((game) => {
      const item = evidence[game.gameId] ?? empty
      return <fieldset key={game.gameId} aria-label={`${game.away} @ ${game.home} paper evidence`}>
        <legend>{game.away} @ {game.home}</legend>
        <label className="nba-checkbox"><input type="checkbox" checked={item.requestedPaper} onChange={(event) => update(game.gameId, { requestedPaper: event.target.checked })} />Request paper experiment for {game.away} @ {game.home}</label>
        <label>Availability source URL<input type="url" value={item.availabilitySource} onChange={(event) => update(game.gameId, { availabilitySource: event.target.value })} placeholder="https://official.nba.com/..." /></label>
        <label>Availability observed at<input type="datetime-local" value={localTime(item.availabilityObservedAt)} onChange={(event) => update(game.gameId, { availabilityObservedAt: event.target.value ? new Date(event.target.value).toISOString() : '' })} /></label>
        <label>Lineup and injury notes<textarea value={item.availabilityNotes} onChange={(event) => update(game.gameId, { availabilityNotes: event.target.value })} placeholder="Who is in/out/questionable? What remains unknown?" /></label>
        <label>Exact contract rules source URL<input type="url" value={item.rulesSource} onChange={(event) => update(game.gameId, { rulesSource: event.target.value })} /></label>
        <label>Fee schedule source URL<input type="url" value={item.feeSource} onChange={(event) => update(game.gameId, { feeSource: event.target.value })} /></label>
        <label>Pregame thesis and risks<textarea value={item.rationale} onChange={(event) => update(game.gameId, { rationale: event.target.value })} /></label>
        <label className="nba-checkbox"><input type="checkbox" checked={item.uncertaintyAccepted} onChange={(event) => update(game.gameId, { uncertaintyAccepted: event.target.checked })} />I understand the score-only model and fee estimate are unvalidated</label>
      </fieldset>
    })}</div> : <p className="help">No fresh scan loaded. Earlier frozen records and settlement reviews remain accessible below.</p>}
    </>}
    <div className="nba-freeze-actions">{view === 'scan' && scan && <button type="button" onClick={freeze} disabled={!!error}>Freeze three-game NBA snapshot</button>}
      <button type="button" onClick={() => { try { download() } catch { setError('Cannot export NBA audit JSON') } }} disabled={!records.length}>Download NBA audit JSON</button></div>
    {error && <p role="alert">{error}</p>}
    {view === 'scan' && <p className="help">Frozen NBA scans: {records.length} · PAPER EXPERIMENT · {records.flatMap((record) => record.decisions).filter((d) => d.status === 'PAPER_EXPERIMENT').length}. Requested but incomplete sides remain STUDY and can be reviewed in history.</p>}
    {view === 'history' && <><p className="help">Only explicitly requested, pre-tip frozen NBA paper sides count. Forced studies remain unqualified. Each freeze is a separate simulated entry; repeat freezes of the same game count separately. No real fills or orders.</p>
      <div className="nba-history-stats" aria-label="NBA paper win loss tracker"><strong>Wins: {history.wins}</strong><strong>Losses: {history.losses}</strong><strong>Pending: {history.pending}</strong><strong>Fair price: {history.fairPrice}</strong><strong>Simulated net units: {history.simulatedNetUnits.toFixed(3)}</strong></div>
      {history.entries.length === 0 && <p>No requested paper sides frozen yet. Run a fresh scan and freeze before tip.</p>}</>}
    {records.length > 0 && (view === 'scan' || history.entries.length > 0) && <div className="nba-freeze-history"><h4>Frozen decisions (newest last)</h4>{records.filter((record) => view === 'scan' || record.decisions.some((decision) => decision.selected && decision.evidence?.requestedPaper)).map((record) => <article key={record.id}><time dateTime={record.frozenAt}>{new Date(record.frozenAt).toLocaleString()}</time>
      <ul>{record.decisions.filter((decision) => view === 'scan' || (decision.selected && decision.evidence?.requestedPaper)).map((decision) => <li key={decision.gameId}><strong>{decision.status}</strong> · {decision.gameId} · {decision.selected?.ticker ?? 'No sized side'} {decision.selected ? decision.selected.side.toUpperCase() : ''}
        {view === 'history' && decision.evidence?.requestedPaper && decision.selected && <strong> · {reviews.find((item) => item.id === `${record.id}:${decision.gameId}`)?.outcome === 'FAIR_PRICE' ? 'FAIR PRICE' : reviews.find((item) => item.id === `${record.id}:${decision.gameId}`)?.payout === 1 ? 'WIN' : reviews.find((item) => item.id === `${record.id}:${decision.gameId}`)?.payout === 0 ? 'LOSS' : 'PENDING'} · {decision.status === 'STUDY' ? 'Forced study · not qualified' : 'Paper experiment · not validated'}</strong>}
        {decision.reasons.length > 0 && <span> · {decision.reasons.join('; ')}</span>}
        {reviews.find((item) => item.id === `${record.id}:${decision.gameId}`) && <p>Simulated post-cost net units: {reviews.find((item) => item.id === `${record.id}:${decision.gameId}`)!.simulatedNetUnits.toFixed(3)} · $25/unit · no fill · operator-attested settlement</p>}
        {decision.evidence?.requestedPaper && decision.selected && !reviews.some((item) => item.id === `${record.id}:${decision.gameId}`) &&
          Date.now() > Date.parse(record.scan.games.find((game) => game.gameId === decision.gameId)?.startsAt ?? '') &&
          <NbaSettlementForm record={record} gameId={decision.gameId} ticker={decision.selected.ticker} side={decision.selected.side} onSaved={(review) => setReviews((old) => [...old, review])} />}
      </li>)}</ul></article>)}</div>}
  </div>
}
