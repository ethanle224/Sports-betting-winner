import { useState } from 'react'
import { appendNbaFreeze, appendNbaReview, freezeNbaStudy, nbaReturnUnits, nbaSideLabel, readNbaFreezes, readNbaReviews, summarizeNbaHistory,
  type NbaEvidence, type NbaFreeze, type NbaReview, type NbaScan } from './nba-paper'
import { auditSummary, auditTrackedPick, readNbaAudits, type NbaAuditReport, type NbaAuditResponse } from './nba-audit'
import { cloudValidationStorage, saveNbaCloudRecord, type NbaCloudLedger } from './nba-cloud-ledger'

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
  const history = summarizeNbaHistory(records, reviews)
  const auditStats = auditSummary(audits)
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
    setAuditBusy(true); setAuditMessage('')
    let settled = 0; let pending = 0; let needsReview = 0
    const failures: string[] = []
    let working: NbaCloudLedger = { freezes: records, reviews, audits }
    for (const { freeze, decision } of history.entries) {
      if (!decision.selected || working.audits.some((item) => item.id === `${freeze.id}:${decision.gameId}`)) continue
      try {
        const query = `date=${encodeURIComponent(freeze.scan.date)}&gameId=${encodeURIComponent(decision.gameId)}&ticker=${encodeURIComponent(decision.selected.ticker)}`
        const response = await fetch(`/api/nba-audit?${query}`, { credentials: 'same-origin' })
        if (!response.ok) throw new Error('Public audit source unavailable or session expired')
        const result: NbaAuditResponse = await response.json()
        if (result.state === 'pending') { pending++; continue }
        if (result.state === 'needs_review') { needsReview++; continue }
        if (cloudLedger) {
          const temporary = cloudValidationStorage(working)
          const report = auditTrackedPick(temporary, freeze, decision.gameId, result)
          const nextReviews = readNbaReviews(temporary)
          const added = nextReviews.find((item) => !working.reviews.some((old) => old.id === item.id))
          if (added) { await saveNbaCloudRecord('review', added); working = { ...working, reviews: nextReviews }; onCloudChange?.(working) }
          await saveNbaCloudRecord('audit', report)
          working = { ...working, audits: [...working.audits, report] }; onCloudChange?.(working)
        } else auditTrackedPick(localStorage, freeze, decision.gameId, result)
        settled++
      } catch (failure) { failures.push(`${decision.gameId}: ${failure instanceof Error ? failure.message : 'Audit unavailable'}`) }
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
      {view === 'history' && <button type="button" onClick={() => void auditPicks()} disabled={auditBusy || !!error || !history.entries.some((entry) => !audits.some((audit) => audit.id === `${entry.freeze.id}:${entry.decision.gameId}`))}>{auditBusy ? 'Auditing tracked picks…' : 'Audit finished picks'}</button>}
      <button type="button" onClick={() => { try { download() } catch { setError('Cannot export NBA audit JSON') } }} disabled={!records.length}>Download NBA audit JSON</button></div>
    {view === 'history' && <><p className="help">Read-only: checks each tracked pick against its exact Kalshi settlement and official NBA final score. Live or mismatched games stay pending; no real orders or automatic model changes.</p>{auditMessage && <p role="status">{auditMessage}</p>}</>}
    {error && <p role="alert">{error}</p>}
    {view === 'scan' && <p className="help">Frozen NBA scans: {records.length} · PAPER EXPERIMENT · {records.flatMap((record) => record.decisions).filter((d) => d.status === 'PAPER_EXPERIMENT').length}. Requested but incomplete sides remain STUDY and can be reviewed in history.</p>}
    {view === 'history' && <><p className="help">Only explicitly requested, pre-tip frozen NBA sides count. 1 unit staked per selection = the all-in 10-contract snapshot cost; net units = selected-side payout divided by that cost, minus 1. Loss = −1u; a win varies by price. Legacy reviews are normalized for this display without changing their audit records. No real fills or orders.</p>
      <div className="nba-history-stats" aria-label="NBA paper win loss tracker"><strong>Wins: {history.wins}</strong><strong>Losses: {history.losses}</strong><strong>Pending: {history.pending}</strong><strong>Fair price: {history.fairPrice}</strong><strong>Simulated net units: {history.simulatedNetUnits.toFixed(3)}</strong></div>
      {audits.length > 0 && <section className="nba-audit-summary" aria-label="Next-slate learning summary"><h4>Next-slate learning · {auditStats.count} audited</h4><p>Model vs frozen price Brier: {auditStats.modelBrier?.toFixed(3) ?? '—'} vs {auditStats.snapshotPriceBrier?.toFixed(3) ?? '—'} across {auditStats.binaryCount} binary results. Tiny samples do not prove an edge or identify a cause. Check the per-pick gaps below; test adjustments on future games rather than rewriting today’s predictions.</p></section>}
      {history.entries.length === 0 && <p>No paper picks tracked yet in this browser. Choices discussed in chat are not tracked bets. Scan and tap Track on a pick before tip.</p>}</>}
    {records.length > 0 && (view === 'scan' || history.entries.length > 0) && <div className="nba-freeze-history"><h4>Frozen decisions (newest last)</h4>{records.filter((record) => view === 'scan' || record.decisions.some((decision) => decision.selected && decision.evidence?.requestedPaper)).map((record) => <article key={record.id}><time dateTime={record.frozenAt}>{new Date(record.frozenAt).toLocaleString()}</time>
      <ul>{record.decisions.filter((decision) => view === 'scan' || (decision.selected && decision.evidence?.requestedPaper)).map((decision) => <li key={decision.gameId}><strong>{decision.selected && record.scan.games.find((game) => game.gameId === decision.gameId) ? nbaSideLabel(decision.selected, record.scan.games.find((game) => game.gameId === decision.gameId)!) : 'No priced pick'}</strong> · {decision.status} · {decision.gameId}
        {view === 'history' && decision.evidence?.requestedPaper && decision.selected && <strong> · {reviews.find((item) => item.id === `${record.id}:${decision.gameId}`)?.outcome === 'FAIR_PRICE' ? 'FAIR PRICE' : reviews.find((item) => item.id === `${record.id}:${decision.gameId}`)?.payout === 1 ? 'WIN' : reviews.find((item) => item.id === `${record.id}:${decision.gameId}`)?.payout === 0 ? 'LOSS' : 'PENDING'} · {decision.status === 'STUDY' ? 'Forced study · not qualified' : 'Paper experiment · not validated'}</strong>}
        <details><summary>Frozen contract &amp; evidence</summary><p>{decision.selected?.ticker ?? 'No sized side'} {decision.selected?.side.toUpperCase()} · 10 paper contracts · {decision.reasons.join('; ')}</p></details>
        {reviews.find((item) => item.id === `${record.id}:${decision.gameId}`) && <p>1u stake · simulated net units: {nbaReturnUnits(reviews.find((item) => item.id === `${record.id}:${decision.gameId}`)!).toFixed(3)} · 10-contract snapshot · no fill · {audits.some((item) => item.id === `${record.id}:${decision.gameId}`) ? 'public-source verified settlement' : 'operator-attested settlement'}</p>}
        {audits.find((item) => item.id === `${record.id}:${decision.gameId}`) && (() => {
          const audit = audits.find((item) => item.id === `${record.id}:${decision.gameId}`)!
          const game = record.scan.games.find((item) => item.gameId === decision.gameId)!
          return <section className="nba-audit-report" aria-label={`Audit ${decision.gameId}`}><h5>{audit.outcome} · Cause cannot be established from one result</h5>
            <p>{audit.actual ? `Actual: ${game.home} ${audit.actual.home} · ${game.away} ${audit.actual.away}. Total ${audit.actual.total}, home margin ${audit.actual.homeMargin}.` : 'Nonbinary fair-price resolution; no final basketball score attributed.'}</p>
            <p>Frozen model: {(audit.model.selectedProbability * 100).toFixed(1)}% probability for this side; snapshot price {(audit.model.snapshotPrice * 100).toFixed(1)}¢. Projected total {audit.model.expectedTotal?.toFixed(1) ?? 'unknown'}, actual minus projected {audit.model.totalResidual?.toFixed(1) ?? 'unknown'}; projected home margin {audit.model.expectedMargin?.toFixed(1) ?? 'unknown'}, actual minus projected {audit.model.marginResidual?.toFixed(1) ?? 'unknown'}.</p>
            <p>{audit.explanation} Pregame evidence gaps: {audit.gaps.length ? audit.gaps.join(', ') : 'none marked unknown/estimated'}.</p>
            <h6>For the next slate</h6><ul>{audit.recommendations.map((item) => <li key={item}>{item}</li>)}</ul>
            <p>Sources: <a href={audit.marketSource} target="_blank" rel="noreferrer">exact Kalshi contract</a> · <a href={audit.scheduleSource} target="_blank" rel="noreferrer">NBA final</a> · checked {new Date(audit.observedAt).toLocaleString()}</p>
          </section>
        })()}
        {decision.evidence?.requestedPaper && decision.selected && !reviews.some((item) => item.id === `${record.id}:${decision.gameId}`) &&
          Date.now() > Date.parse(record.scan.games.find((game) => game.gameId === decision.gameId)?.startsAt ?? '') &&
          <NbaSettlementForm record={record} gameId={decision.gameId} ticker={decision.selected.ticker} side={decision.selected.side} cloudLedger={cloudLedger} onSaved={(review) => cloudLedger ? onCloudChange?.({ ...cloudLedger, reviews: [...cloudLedger.reviews, review] }) : setReviews((old) => [...old, review])} />}
      </li>)}</ul></article>)}</div>}
  </div>
}
