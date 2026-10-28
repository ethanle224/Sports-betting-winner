import { useState } from 'react'
import { appendNbaFreeze, appendNbaReview, freezeNbaStudy, nbaSideLabel, readNbaFreezes, readNbaReviews, summarizeNbaHistory,
  type NbaEvidence, type NbaFreeze, type NbaReview, type NbaScan } from './nba-paper'
import { auditShadowPick, auditTrackedPick, readNbaAudits, type NbaAuditReport, type NbaAuditResponse } from './nba-audit'
import { cloudValidationStorage, saveNbaCloudRecord, type NbaCloudLedger } from './nba-cloud-ledger'
import NbaHistoryBoard from './NbaHistoryBoard'
import { signedUnits } from './nba-board-format'

const empty: NbaEvidence = { requestedPaper: false, availabilitySource: '', availabilityObservedAt: '', availabilityNotes: '',
  rulesSource: '', feeSource: '', uncertaintyAccepted: false, rationale: '' }
const localTime = (iso: string) => {
  if (!iso || !Number.isFinite(Date.parse(iso))) return ''
  const time = new Date(iso)
  return new Date(time.getTime() - time.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function NbaSettlementForm({ record, gameId, ticker, side, onSaved, cloudLedger }: { record: NbaFreeze; gameId: string; ticker: string; side: string; onSaved: (review: NbaReview) => void; cloudLedger?: NbaCloudLedger }) {
  const [outcome, setOutcome] = useState('')
  const [payout, setPayout] = useState('')
  const [source, setSource] = useState(`https://external-api.kalshi.com/trade-api/v2/markets/${ticker}`)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  async function save() {
    try {
      const reviewed = appendNbaReview(cloudLedger ? cloudValidationStorage(cloudLedger) : localStorage, { scanId: record.id, gameId, observedAt: new Date().toISOString(),
        source, outcome: outcome as 'YES' | 'NO' | 'FAIR_PRICE', payout: Number(payout), note })
      if (cloudLedger) await saveNbaCloudRecord('review', reviewed)
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
    <button type="button" onClick={() => void save()}>Save settlement review</button>{error && <p role="alert">{error}</p>}
  </fieldset>
}

export default function NbaFreezePanel({ scan, view = 'scan', requestedIds, onRequestedChange, cloudLedger, onCloudChange }: { scan: NbaScan | null;
  view?: 'scan' | 'history'; requestedIds?: string[]; onRequestedChange?: (id: string, requested: boolean) => void;
  cloudLedger?: NbaCloudLedger; onCloudChange?: (ledger: NbaCloudLedger) => void }) {
  const [evidence, setEvidence] = useState<Record<string, NbaEvidence>>({})
  const [initial] = useState(() => {
    if (cloudLedger) return { records: [] as NbaFreeze[], reviews: [] as NbaReview[], audits: [] as NbaAuditReport[], error: '' }
    try { return { records: readNbaFreezes(localStorage), reviews: readNbaReviews(localStorage), audits: readNbaAudits(localStorage), error: '' } }
    catch (failure) { return { records: [] as NbaFreeze[], reviews: [] as NbaReview[], audits: [] as NbaAuditReport[], error: failure instanceof Error ? failure.message : 'Cannot read NBA ledger' } }
  })
  const [localRecords, setRecords] = useState<NbaFreeze[]>(initial.records)
  const [localReviews, setReviews] = useState<NbaReview[]>(initial.reviews)
  const [localAudits, setAudits] = useState<NbaAuditReport[]>(initial.audits)
  const records = cloudLedger?.freezes ?? localRecords
  const reviews = cloudLedger?.reviews ?? localReviews
  const audits = cloudLedger?.audits ?? localAudits
  const [auditBusy, setAuditBusy] = useState(false)
  const [auditMessage, setAuditMessage] = useState('')
  const [auditNotices, setAuditNotices] = useState<Record<string, string>>({})
  const history = summarizeNbaHistory(records, reviews)
  const shadowReports = history.entries.flatMap(({ freeze, decision }) => decision.shadow ?
    audits.filter((audit) => audit.id === `${freeze.id}:${decision.gameId}:shadow` && audit.variant === 'shadow') : [])
  const shadowUnits = shadowReports.reduce((sum, audit) => {
    const entry = history.entries.find(({ freeze, decision }) => `${freeze.id}:${decision.gameId}:shadow` === audit.id)
    return sum + (entry?.decision.shadow ? audit.payout / entry.decision.shadow.allInCost - 1 : 0)
  }, 0)

  const [error, setError] = useState(initial.error)
  const update = (id: string, changes: Partial<NbaEvidence>) => setEvidence((old) => ({ ...old, [id]: { ...empty, ...old[id], ...changes } }))
  async function freeze() {
    if (!scan || error) return
    try {
      const selections = requestedIds === undefined ? evidence : Object.fromEntries(scan.games.map((game) =>
        [game.gameId, { ...empty, ...evidence[game.gameId], requestedPaper: requestedIds.includes(game.gameId) }]))
      const record = freezeNbaStudy(scan, selections, new Date().toISOString())
      if (cloudLedger) {
        await saveNbaCloudRecord('freeze', record)
        onCloudChange?.({ ...cloudLedger, freezes: [...cloudLedger.freezes, record] })
      } else setRecords(appendNbaFreeze(localStorage, record))
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Cannot freeze NBA snapshot') }
  }
  function download() {
    const all = cloudLedger?.freezes ?? readNbaFreezes(localStorage)
    const settled = cloudLedger?.reviews ?? readNbaReviews(localStorage)
    const reports = cloudLedger?.audits ?? readNbaAudits(localStorage)
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 'nba-paper-v1', freezes: all, reviews: settled, audits: reports }, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url; link.download = 'edgeboard-nba-paper-audit.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  async function auditPicks() {
    if (auditBusy || error) return
    setAuditBusy(true); setAuditMessage(''); setAuditNotices({})
    let settled = 0; let pending = 0; let needsReview = 0
    const failures: string[] = []
    let working: NbaCloudLedger = { freezes: records, reviews, audits }
    for (const { freeze, decision } of history.entries) for (const variant of ['primary', 'shadow'] as const) {
      const side = variant === 'shadow' ? decision.shadow : decision.selected
      const id = `${freeze.id}:${decision.gameId}${variant === 'shadow' ? ':shadow' : ''}`
      if (!side || working.audits.some((item) => item.id === id)) continue
      try {
        const query = `date=${encodeURIComponent(freeze.scan.date)}&gameId=${encodeURIComponent(decision.gameId)}&ticker=${encodeURIComponent(side.ticker)}`
        const response = await fetch(`/api/nba-audit?${query}`, { credentials: 'same-origin' })
        if (!response.ok) throw new Error('Public audit source unavailable or session expired')
        const result: NbaAuditResponse = await response.json()
        if (result.state === 'pending') { if (variant === 'primary') pending++; setAuditNotices((old) => ({ ...old, [id]: result.reason ?? 'Waiting for final settlement' })); continue }
        if (result.state === 'needs_review') { if (variant === 'primary') needsReview++; setAuditNotices((old) => ({ ...old, [id]: result.reason ?? 'Manual verification needed' })); continue }
        if (cloudLedger) {
          const temporary = cloudValidationStorage(working)
          const report = variant === 'primary' ? auditTrackedPick(temporary, freeze, decision.gameId, result) :
            auditShadowPick(temporary, freeze, decision.gameId, result)
          if (variant === 'primary') {
            const nextReviews = readNbaReviews(temporary)
            const added = nextReviews.find((item) => !working.reviews.some((old) => old.id === item.id))
            if (added) { await saveNbaCloudRecord('review', added); working = { ...working, reviews: nextReviews }; onCloudChange?.(working) }
          }
          await saveNbaCloudRecord('audit', report)
          working = { ...working, audits: [...working.audits, report] }; onCloudChange?.(working)
        } else if (variant === 'primary') auditTrackedPick(localStorage, freeze, decision.gameId, result)
        else auditShadowPick(localStorage, freeze, decision.gameId, result)
        setAuditNotices((old) => ({ ...old, [id]: 'Final contract and NBA score verified' }))
        if (variant === 'primary') settled++
      } catch (failure) {
        const reason = failure instanceof Error ? failure.message : 'Audit unavailable'
        failures.push(`${decision.gameId}${variant === 'shadow' ? ' shadow' : ''}: ${reason}`)
        setAuditNotices((old) => ({ ...old, [id]: `Audit failed: ${reason}` }))
      }
    }
    try { if (!cloudLedger) { setReviews(readNbaReviews(localStorage)); setAudits(readNbaAudits(localStorage)) } }
    catch (failure) { failures.push(failure instanceof Error ? failure.message : 'Cannot read NBA audit') }
    setAuditMessage(`${settled} audited · ${pending} pending${pending ? ' (retry after final settlement)' : ''} · ${needsReview} need manual verification${failures.length ? ` · ${failures.join('; ')}` : ''}`)
    setAuditBusy(false)
  }
  return <div className="nba-freeze-panel">
    <h3>{view === 'scan' ? 'NBA slate decision freeze' : 'NBA paper bet history'} · {cloudLedger ? 'cloud-backed' : 'browser-local'}</h3>
    {view === 'scan' && <>
    <p className="help">Add the choices you want to the paper slip above, then freeze the fresh scan before tip. Each selected side stakes 1 paper unit at its snapshot all-in cost (10 whole contracts); a win can return more or less than +1 net unit. Missing evidence keeps it a forced STUDY, not a qualified edge. Export the audit JSON—browser data can be cleared.</p>
    {scan ? <div className="nba-evidence-grid">{scan.games.map((game) => {
      const item = evidence[game.gameId] ?? empty
      return <fieldset key={game.gameId} aria-label={`${game.away} @ ${game.home} paper evidence`}>
        <legend>{game.away} @ {game.home}</legend>
        <label className="nba-checkbox"><input type="checkbox" checked={requestedIds === undefined ? item.requestedPaper : requestedIds.includes(game.gameId)} onChange={(event) => requestedIds === undefined ? update(game.gameId, { requestedPaper: event.target.checked }) : onRequestedChange?.(game.gameId, event.target.checked)} />Request paper experiment for {game.away} @ {game.home}</label>
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
    <div className="nba-freeze-actions">{view === 'scan' && scan && <button type="button" onClick={() => void freeze()} disabled={!!error || (requestedIds !== undefined && requestedIds.length === 0)}>{requestedIds === undefined ? 'Freeze three-game NBA snapshot' : `Freeze ${requestedIds.length} selected paper ${requestedIds.length === 1 ? 'bet' : 'bets'} · 1 unit each`}</button>}
      {view === 'history' && <button type="button" onClick={() => void auditPicks()} disabled={auditBusy || !!error || !history.entries.some((entry) =>
        !audits.some((audit) => audit.id === `${entry.freeze.id}:${entry.decision.gameId}`) ||
        (entry.decision.shadow && !audits.some((audit) => audit.id === `${entry.freeze.id}:${entry.decision.gameId}:shadow`)))}>{auditBusy ? 'Auditing tracked picks…' : 'Audit finished picks'}</button>}
      <button type="button" onClick={() => { try { download() } catch { setError('Cannot export NBA audit JSON') } }} disabled={!records.length}>Download NBA audit JSON</button></div>
    {view === 'history' && <><p className="help">Audit checks final contract settlement against the final NBA score. The board tracks results and units only; ask me here for model analysis. No real orders.</p>{auditMessage && <p role="status">{auditMessage}</p>}</>}
    {error && <p role="alert">{error}</p>}
    {view === 'scan' && <p className="help">Frozen NBA scans: {records.length} · PAPER EXPERIMENT · {records.flatMap((record) => record.decisions).filter((d) => d.status === 'PAPER_EXPERIMENT').length}. Requested but incomplete sides remain STUDY and can be reviewed in history.</p>}
    {view === 'history' && <>
      <div className="nba-history-stats" aria-label="NBA paper win loss tracker"><strong>Wins: {history.wins}</strong><strong>Losses: {history.losses}</strong><strong>Pending: {history.pending}</strong><strong>Fair price: {history.fairPrice}</strong><strong>Net units: {signedUnits(history.simulatedNetUnits)}</strong></div>
      {history.entries.some((entry) => entry.decision.shadow) && <p className="help">Shadow comparison · {shadowReports.length} verified of {history.entries.filter((entry) => entry.decision.shadow).length} frozen challengers · Shadow wins: {shadowReports.filter((audit) => audit.outcome === 'WIN').length} · Shadow losses: {shadowReports.filter((audit) => audit.outcome === 'LOSS').length} · Shadow net units: {signedUnits(shadowUnits)}. Separate 1u hypothetical stakes; not included in the baseline net or actual bets.</p>}
      <p className="help">Paper only · 1u staked per tracked pick, not a $1 profit target. Win = payout ÷ frozen all-in entry cost − 1u; loss = −1u. Pending picks add 0 to settled net, not a loss. Quoted prices and fees were estimated; no real fill.</p>

      {history.entries.length === 0 ? <p>No paper picks tracked here. Choices discussed in chat are not ledger entries. Scan and tap Track on a pick before tip.</p> :
        <NbaHistoryBoard entries={history.entries} audits={audits} notices={auditNotices} renderReview={({ freeze, decision, review }) =>
          !review && decision.selected ?
            <NbaSettlementForm record={freeze} gameId={decision.gameId} ticker={decision.selected.ticker} side={decision.selected.side} cloudLedger={cloudLedger} onSaved={(saved) => cloudLedger ? onCloudChange?.({ ...cloudLedger, reviews: [...cloudLedger.reviews, saved] }) : setReviews((old) => [...old, saved])} /> : null} />}
    </>}
    {view === 'scan' && records.length > 0 && <div className="nba-freeze-history"><h4>Frozen decisions</h4>{records.map((record) => <article key={record.id}><time dateTime={record.frozenAt}>{new Date(record.frozenAt).toLocaleString()}</time>
      <ul>{record.decisions.map((decision) => <li key={decision.gameId}><strong>{decision.selected && record.scan.games.find((game) => game.gameId === decision.gameId) ? nbaSideLabel(decision.selected, record.scan.games.find((game) => game.gameId === decision.gameId)!) : 'No priced pick'}</strong> · {decision.status} · {decision.gameId}
        <details><summary>Frozen contract &amp; evidence</summary><p>{decision.selected?.ticker ?? 'No sized side'} {decision.selected?.side.toUpperCase()} · 10 paper contracts · {decision.reasons.join('; ')}</p></details>
      </li>)}</ul></article>)}</div>}
  </div>
}
