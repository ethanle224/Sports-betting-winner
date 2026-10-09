import { useEffect, useState, type FormEvent } from 'react'
import { getSession, login, logout } from './auth'
import { evaluate, paperSize, PAPER_BANKROLL, STRATEGIES, UNIT_DOLLARS, type PaperCandidate } from './checklists'
import { exportPaperLog, LOSS_REASONS, recordSettlement, summarizePaper, type Outcome, type PaperEntry, type ReviewReason } from './paper-log'
import NflScanner from './NflScanner'
import NbaResearch from './NbaResearch'
import './styles.css'
import './nba-styles.css'

const STORAGE_KEY = 'edgeboard-paper-v1'
const SPORT_KEY = 'edgeboard-active-sport'

function loadEntries(): PaperEntry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is PaperEntry =>
      !!item && typeof item === 'object' && typeof item.id === 'string' &&
      typeof item.candidate?.matchup === 'string' && Array.isArray(item.results) &&
      ['pending', 'win', 'loss', 'partial', 'void'].includes(item.outcome))
  } catch { return [] }
}

function SettlementPanel({ entry, onSave }: { entry: PaperEntry; onSave: (next: PaperEntry) => void }) {
  const [outcome, setOutcome] = useState<Exclude<Outcome, 'pending'>>(entry.outcome === 'pending' ? 'win' : entry.outcome)
  const [error, setError] = useState('')
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    try {
      const next = recordSettlement(entry, { outcome, source: String(data.get('source') || ''),
        payout: Number(data.get('payout')), reason: (outcome === 'loss' ? data.get('reason') : 'none') as ReviewReason,
        note: String(data.get('note') || '') })
      onSave(next)
      setError('')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Settlement not saved') }
  }
  return <details className="settlement-panel"><summary>Settle / review</summary>
    <form onSubmit={submit}>
      <label>Result<select name="outcome" value={outcome} onChange={(event) => setOutcome(event.target.value as Exclude<Outcome, 'pending'>)}>
        <option value="win">Win · $1</option><option value="loss">Loss · $0</option><option value="partial">Partial payout</option><option value="void">Void · stake returned</option>
      </select></label>
      {outcome === 'partial' && <label>Payout per contract ($)<input name="payout" type="number" min="0.01" max="0.99" step="0.01" required defaultValue={entry.settlement?.payout ?? 0.5} /></label>}
      <label>Settlement source<input name="source" placeholder="Official result URL or identifiable reference" defaultValue={entry.settlement?.source ?? ''} /></label>
      {outcome === 'loss' && <label>Loss diagnosis<select name="reason" defaultValue={entry.review?.reason && entry.review.reason !== 'none' ? entry.review.reason : 'unknown'}>
        {LOSS_REASONS.map(({ id, label }) => <option value={id} key={id}>{label}</option>)}
      </select></label>}
      <label>Postmortem evidence<textarea name="note" rows={3} placeholder="What was known at decision time vs what was learned later? Unknown is valid; don't force a story." defaultValue={entry.review?.note ?? ''} /></label>
      <button type="submit">Save settlement</button>{error && <small role="alert">{error}</small>}
    </form>
  </details>
}

function Dashboard({ onLogout }: { onLogout: () => Promise<void> }) {
  const [entries, setEntries] = useState<PaperEntry[]>(loadEntries)
  const [notice, setNotice] = useState('')
  const summary = summarizePaper(entries)

  function save(next: PaperEntry[]) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      setEntries(next)
      setNotice('')
    } catch { setNotice('Browser storage is full or unavailable. This snapshot was NOT saved.') }
  }

  function logSnapshot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const read = (key: string) => String(data.get(key) || '').trim()
    const optionalPercent = (key: string) => read(key) === '' ? null : Number(read(key)) / 100
    const optionalShare = (key: string) => read(key) === '' ? null : Number(read(key))
    const candidate: PaperCandidate = {
      matchup: read('matchup'), contract: read('contract'), side: read('side'),
      observedAt: new Date(read('quoteTime')).toISOString(),
      allInCost: Number(read('cost')) / 100,
      modelProbability: Number(read('model')) / 100,
      consensusProbability: optionalPercent('consensus'), consensusSource: read('consensusSource'),
      crowdMoneyPercent: optionalShare('crowd'), crowdSource: read('crowdSource'),
      rulesChecked: data.has('rules'), newsChecked: data.has('news'), depthChecked: data.has('depth'),
      units: Number(read('units')), highConfidence: data.has('highConfidence'), confidenceRationale: read('confidenceRationale'),
      modelSource: read('modelSource'), modelObservedAt: read('modelTime') ? new Date(read('modelTime')).toISOString() : '',
      pregameThesis: read('pregameThesis'), quoteSource: read('quoteSource'),
    }
    const contracts = paperSize(candidate.units ?? 1, candidate.allInCost).contracts
    const next = [{ id: crypto.randomUUID(), createdAt: new Date().toISOString(), candidate, results: evaluate(candidate), outcome: 'pending' as Outcome, contracts }, ...entries]
    save(next)
    if (localStorage.getItem(STORAGE_KEY) === JSON.stringify(next)) form.reset()
  }

  function settle(nextEntry: PaperEntry) {
    save(entries.map((entry) => entry.id === nextEntry.id ? nextEntry : entry))
  }

  function downloadLog() {
    const url = URL.createObjectURL(new Blob([exportPaperLog(entries)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'edgeboard-paper-log.json'
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#overview" aria-label="Edgeboard home"><span className="brand-mark">E</span><span>EDGEBOARD</span></a>
        <div className="topbar-actions"><div className="status"><span className="dot" /> PAPER MODE · PUBLIC MARKET SCAN · NO ORDERS</div><button className="logout" type="button" onClick={() => void onLogout()}>Log out</button></div>
      </header>
      <section className="hero" id="overview">
        <div>
          <p className="eyebrow">KALSHI SPORTS RESEARCH / EXPERIMENT 01</p>
          <h1>Three filters.<br /><em>One honest record.</em></h1>
          <p className="lede">Run the same candidate through three frozen checklists. Record every rejection and settlement. These are hypotheses, not proven betting edges.</p>
        </div>
        <aside className="risk-card"><span>PAPER BANKROLL</span><strong>${PAPER_BANKROLL.toLocaleString()}</strong><div>1 unit = ${UNIT_DOLLARS} · 0.00–2.00 units per candidate · $50 maximum intended stake. Paper-only, browser-local ledger.</div></aside>
      </section>
      <NflScanner entries={entries} />
      <section className="checklist-grid" aria-label="Paper strategies">
        {STRATEGIES.map((strategy) => {
          const picks = entries.filter((entry) => entry.results.some((result) => result.id === strategy.id && result.status === 'PAPER'))
          const stats = summary.byStrategy[strategy.id]
          const stake = picks.filter((entry) => entry.outcome !== 'pending' && entry.outcome !== 'void').reduce((sum, entry) => sum + (entry.contracts ?? 10) * entry.candidate.allInCost, 0)
          return <article className="strategy" key={strategy.id}>
            <h2>{strategy.name}</h2><p>{strategy.rule}</p>
            <div className="strategy-stats"><span>{picks.length} paper picks</span><span>{stats.settled} settled · {stats.wins}W/{stats.losses}L</span></div>
            <strong>{stats.settled ? `${stats.net < 0 ? '-' : '+'}$${Math.abs(stats.net).toFixed(2)}` : '—'}</strong>
            <small>{stats.settled ? `Bankroll $${(PAPER_BANKROLL + stats.net).toFixed(2)} · ${stake ? `${(stats.net / stake * 100).toFixed(1)}% ROI` : 'No risked stake'} · Brier ${stats.brier?.toFixed(3) ?? '—'}` : 'No settled picks · no performance claim'}</small>
          </article>
        })}
      </section>
      <section className="board" aria-labelledby="entry-heading">
        <div className="board-heading"><div><p className="eyebrow">01 / CAPTURE</p><h2 id="entry-heading">Log a candidate</h2></div></div>
        <p className="help">Enter the exact contract, quote time and executable all-in cost (including fees/depth). Allocate 0.00–2.00 units: 1 unit = $25 intended risk, with whole contracts rounded down. Standard payout floor is 1.7×; only a documented 2-unit high-confidence play may use 1.65×. Probability-edge, rules, news and depth gates still apply. Type your own independent estimate; unknown inputs reject, never default to zero.</p>
        <form onSubmit={logSnapshot} className="entry-form">
          <label>Matchup<input name="matchup" required placeholder="Team A @ Team B" /></label>
          <label>Exact contract<input name="contract" required placeholder="Kalshi ticker / resolution" /></label>
          <label>Side<input name="side" required placeholder="Team A YES / Over 45.5" /></label>
          <label>Quote / rule evidence source<input name="quoteSource" placeholder="Observed orderbook or market reference" /></label>
          <label>Quote observed at<input name="quoteTime" type="datetime-local" required /></label>
          <label>All-in cost per contract (¢)<input name="cost" type="number" min="0.01" max="99.99" step="0.01" required /></label>
          <label>Model win probability (%)<input name="model" type="number" min="0.01" max="99.99" step="0.01" required /></label>
          <label>Independent model source / method<input name="modelSource" placeholder="Method, data source, version; not Kalshi price" /></label>
          <label>Model calculated at<input name="modelTime" type="datetime-local" /></label>
          <label className="wide-field">Pregame thesis &amp; risks<textarea name="pregameThesis" rows={3} placeholder="Why this exact side/line, known injury risks, and what would invalidate the forecast—record before kickoff." /></label>
          <label>Units (0.00–2.00)<input name="units" type="number" min="0" max="2" step="0.01" defaultValue="1.00" required /></label>
          <label>Conviction rationale (required at 2 units)<input name="confidenceRationale" placeholder="Specific independent evidence + timestamp" /></label>
          <label>Independent probability (%)<input name="consensus" type="number" min="0.01" max="99.99" step="0.01" /></label>
          <label>Independent source<input name="consensusSource" placeholder="Source + quote time" /></label>
          <label>Dollar share on our side (%)<input name="crowd" type="number" min="0" max="100" step="0.01" /></label>
          <label>Dollar split source<input name="crowdSource" placeholder="Reporting book(s) + time" /></label>
          <div className="confirmations">
            <label><input type="checkbox" name="rules" /> Contract rules checked</label>
            <label><input type="checkbox" name="news" /> News checked</label>
            <label><input type="checkbox" name="depth" /> Depth and fees checked</label>
            <label><input type="checkbox" name="highConfidence" /> Documented high-confidence 2-unit play</label>
          </div>
          <button className="primary" type="submit">Log paper snapshot</button>
          {notice && <p role="alert">{notice}</p>}
        </form>
      </section>
      <section className="board" aria-labelledby="log-heading">
        <div className="board-heading"><div><p className="eyebrow">02 / AUDIT</p><h2 id="log-heading">All candidates</h2></div><button className="export-button" type="button" onClick={downloadLog}>Download audit JSON</button></div>
        <p className="help">Decisions are frozen at entry, not recalculated after results. Manually verify the exact contract settlement and record its source; corrections add a new revision. Counts and P&amp;L include PAPER decisions only. Local browser data can be lost—download backups. Old one-click results have no verifiable source or revision history.</p>
        <div className="table-wrap"><table><thead><tr><th>SNAPSHOT / CONTRACT</th><th>COST / MODEL / PAYOUT</th><th>A · VALUE</th><th>B · CONSENSUS</th><th>C · CROWD</th><th>OUTCOME</th></tr></thead><tbody>
          {entries.map((entry) => { const net = summarizePaper([entry]).net; return <tr key={entry.id}>
            <td><strong>{entry.candidate.matchup}</strong><span>{entry.candidate.contract} · {entry.candidate.side}</span><span>{new Date(entry.candidate.observedAt).toLocaleString()}</span>{entry.createdAt && <span>Logged: {new Date(entry.createdAt).toLocaleString()}</span>}{entry.candidate.modelSource && <span>Model: {entry.candidate.modelSource} · {entry.candidate.modelObservedAt ? new Date(entry.candidate.modelObservedAt).toLocaleString() : 'time missing'}</span>}{entry.candidate.quoteSource && <span>Quote/rule source: {entry.candidate.quoteSource}</span>}{entry.candidate.pregameThesis && <span>Pregame: {entry.candidate.pregameThesis}</span>}</td>
            <td>{(entry.candidate.allInCost * 100).toFixed(2)}¢ / {(entry.candidate.modelProbability * 100).toFixed(1)}% / {entry.results[0]?.payoutMultiple?.toFixed(2) ?? '—'}×<span>{entry.candidate.units === undefined && entry.contracts === undefined ? 'Legacy · 10 contracts' : `${entry.candidate.units?.toFixed(2) ?? 'legacy'} units · ${entry.contracts ?? 10} contracts · $${((entry.contracts ?? 10) * entry.candidate.allInCost).toFixed(2)} staked`}</span></td>
            {STRATEGIES.map((strategy) => { const result = entry.results.find((item) => item.id === strategy.id); return <td key={strategy.id}><b className={result?.status === 'PAPER' ? 'positive' : 'muted'}>{result?.status ?? '—'}</b><span className="reasons">{result?.reasons.join('; ') || 'All checks passed'}</span></td> })}
            <td className="settlement-cell"><strong>{entry.outcome.toUpperCase()}</strong>{entry.outcome !== 'pending' && entry.results.some((result) => result.status === 'PAPER') && <span>Paper net {net < 0 ? '-' : '+'}${Math.abs(net).toFixed(2)}</span>}
              {entry.settlement && <span>Source: {entry.settlement.source} · {new Date(entry.settlement.observedAt).toLocaleString()}</span>}
              {entry.review?.reason && entry.review.reason !== 'none' && <span>Review: {LOSS_REASONS.find((reason) => reason.id === entry.review?.reason)?.label} · {entry.review.note}</span>}
              {entry.outcome !== 'pending' && !entry.settlement && <span>Legacy outcome: source not recorded</span>}
              <SettlementPanel entry={entry} onSave={settle} />
              {!!entry.history?.length && <details className="revision-list"><summary>{entry.history.length} logged revision(s)</summary><ol>{entry.history.map((event, index) => <li key={index}>{event.recordedAt}: {event.previousOutcome} → {event.outcome} · {event.settlement.source} · {event.review.reason} {event.review.note}</li>)}</ol></details>}
            </td>
          </tr> })}
          {entries.length === 0 && <tr><td className="empty" colSpan={6}>No candidates logged yet.</td></tr>}
        </tbody></table></div>
        <p className="help">{summary.settled} settled paper snapshots · {Object.values(summary.byStrategy).reduce((total, stats) => total + stats.settled, 0)} eligible strategies settled. Not independent bets when strategies agree on a candidate.</p>
      </section>
      <section className="board" aria-labelledby="review-heading">
        <p className="eyebrow">03 / LEARN</p><h2 id="review-heading">Outcome &amp; model review</h2>
        <p className="help">One candidate counts once, even when multiple strategies select it. W/L excludes voids and partial payouts. Brier scores only binary settled picks with a frozen probability; smaller is better, not proof of an edge. Loss labels are post-event hypotheses—not causal conclusions or automatic model updates. Investigate repeated, dated errors; change a version only after walk-forward testing.</p>
        <div className="review-stats"><article><span>WIN / LOSS</span><strong>{summary.wins} / {summary.losses}</strong><small>{summary.partial} partial · {summary.voids} void</small></article><article><span>NET PAPER P&amp;L</span><strong>{summary.net < 0 ? '-' : '+'}${Math.abs(summary.net).toFixed(2)}</strong><small>Across unique candidates</small></article><article><span>BRIER / REVIEW QUEUE</span><strong>{summary.brier?.toFixed(3) ?? '—'}</strong><small>{summary.reviewQueue} legacy losses need review</small></article></div>
        <h3>Loss diagnosis</h3><div className="reason-list">{LOSS_REASONS.map(({ id, label }) => <div key={id}><span>{label}</span><strong>{summary.reasons[id] ?? 0}</strong></div>)}</div>
        <h3>By frozen model source / version</h3><div className="reason-list">{Object.entries(summary.byModel).map(([model, stats]) => <div key={model}><span>{model}</span><strong>{stats.wins}W / {stats.losses}L · {stats.net < 0 ? '-' : '+'}${Math.abs(stats.net).toFixed(2)} · Brier {stats.brier?.toFixed(3) ?? '—'}</strong></div>)}{!Object.keys(summary.byModel).length && <p className="help">No settled paper picks yet.</p>}</div>
      </section>
      <footer>READ-ONLY KALSHI SCAN · MANUAL PAPER PICKS · NO REAL ORDERS · NOT FINANCIAL ADVICE</footer>
    </main>
  )
}

function App() {
  const [session, setSession] = useState<{ authenticated: boolean; username?: string } | null>(null)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sport, setSport] = useState<'nba' | 'nfl'>(() => localStorage.getItem(SPORT_KEY) === 'nfl' ? 'nfl' : 'nba')

  function selectSport(next: 'nba' | 'nfl') {
    setSport(next)
    try { localStorage.setItem(SPORT_KEY, next) } catch { /* Navigation remains usable without storage. */ }
  }

  useEffect(() => {
    void getSession().then(setSession)
  }, [])

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setSubmitting(true)
    setMessage('')
    const result = await login(String(data.get('username') || ''), String(data.get('password') || ''))
    setSubmitting(false)
    if (!result.ok) {
      setMessage(result.message || 'Login failed.')
      return
    }
    setSession({ authenticated: true, username: 'Admin' })
  }

  async function handleLogout() {
    await logout()
    setSession({ authenticated: false })
  }

  if (session === null) return <main className="auth-shell"><p>Checking session…</p></main>
  if (session.authenticated) return <>
    <nav className="sport-tabs shell" role="tablist" aria-label="Sport research">
      <button role="tab" type="button" aria-selected={sport === 'nba'} aria-controls="nba-research" onClick={() => selectSport('nba')}>NBA</button>
      <button role="tab" type="button" aria-selected={sport === 'nfl'} aria-controls="nfl-research" onClick={() => selectSport('nfl')}>NFL</button>
    </nav>
    {sport === 'nba' ? <NbaResearch onLogout={handleLogout} /> : <div id="nfl-research"><Dashboard onLogout={handleLogout} /></div>}
  </>

  return <main className="auth-shell"><section className="login-card" aria-labelledby="login-title"><a className="brand" href="#login"><span className="brand-mark">E</span><span>EDGEBOARD</span></a><p className="eyebrow">ADMIN ACCESS</p><h1 id="login-title">Paper research, locked down.</h1><p>Sign in to access the local paper-trading ledger. No live orders are available.</p><form onSubmit={submitLogin}><label>Username<input name="username" autoComplete="username" defaultValue="Admin" required /></label><label>Password<input name="password" autoComplete="current-password" type="password" required /></label><button className="primary" disabled={submitting} type="submit">{submitting ? 'Signing in…' : 'Sign in'}</button>{message && <p role="alert">{message}</p>}</form></section></main>
}

export default App