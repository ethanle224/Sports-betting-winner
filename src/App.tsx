import { useEffect, useState, type FormEvent } from 'react'
import { getSession, login, logout } from './auth'
import { evaluate, STRATEGIES, type Assessment, type PaperCandidate } from './checklists'
import './styles.css'

type Outcome = 'pending' | 'win' | 'loss' | 'void'
type Entry = { id: string; candidate: PaperCandidate; results: Assessment[]; outcome: Outcome }
const STORAGE_KEY = 'edgeboard-paper-v1'
const CONTRACTS = 10

function loadEntries(): Entry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is Entry =>
      !!item && typeof item === 'object' && typeof item.id === 'string' &&
      typeof item.candidate?.matchup === 'string' && Array.isArray(item.results) &&
      ['pending', 'win', 'loss', 'void'].includes(item.outcome))
  } catch { return [] }
}

function Dashboard({ onLogout }: { onLogout: () => Promise<void> }) {
  const [entries, setEntries] = useState<Entry[]>(loadEntries)
  const [notice, setNotice] = useState('')

  function save(next: Entry[]) {
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
    }
    const next = [{ id: crypto.randomUUID(), candidate, results: evaluate(candidate), outcome: 'pending' as Outcome }, ...entries]
    save(next)
    if (localStorage.getItem(STORAGE_KEY) === JSON.stringify(next)) form.reset()
  }

  function settle(id: string, outcome: Outcome) {
    save(entries.map((entry) => entry.id === id ? { ...entry, outcome } : entry))
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#overview" aria-label="Edgeboard home"><span className="brand-mark">E</span><span>EDGEBOARD</span></a>
        <div className="topbar-actions"><div className="status"><span className="dot" /> PAPER MODE · MANUAL DATA · NO ORDERS</div><button className="logout" type="button" onClick={() => void onLogout()}>Log out</button></div>
      </header>
      <section className="hero" id="overview">
        <div>
          <p className="eyebrow">KALSHI SPORTS RESEARCH / EXPERIMENT 01</p>
          <h1>Three filters.<br /><em>One honest record.</em></h1>
          <p className="lede">Run the same candidate through three frozen checklists. Record every rejection and settlement. These are hypotheses, not proven betting edges.</p>
        </div>
        <aside className="risk-card"><span>FIXED PAPER SIZE</span><strong>{CONTRACTS} contracts</strong><div>Manual snapshots only. Local to this browser; clearing its data erases the log. No live market connection.</div></aside>
      </section>
      <section className="checklist-grid" aria-label="Paper strategies">
        {STRATEGIES.map((strategy) => {
          const picks = entries.filter((entry) => entry.results.some((result) => result.id === strategy.id && result.status === 'PAPER'))
          const settled = picks.filter((entry) => entry.outcome === 'win' || entry.outcome === 'loss')
          const profit = settled.reduce((sum, entry) => sum + CONTRACTS * (entry.outcome === 'win' ? 1 - entry.candidate.allInCost : -entry.candidate.allInCost), 0)
          const stake = settled.reduce((sum, entry) => sum + CONTRACTS * entry.candidate.allInCost, 0)
          return <article className="strategy" key={strategy.id}>
            <h2>{strategy.name}</h2><p>{strategy.rule}</p>
            <div className="strategy-stats"><span>{picks.length} paper picks</span><span>{settled.length} settled</span></div>
            <strong>{settled.length ? `${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}` : '—'}</strong>
            <small>{settled.length ? `Net simulation · ${(profit / stake * 100).toFixed(1)}% ROI` : 'No settled picks · no performance claim'}</small>
          </article>
        })}
      </section>
      <section className="board" aria-labelledby="entry-heading">
        <div className="board-heading"><div><p className="eyebrow">01 / CAPTURE</p><h2 id="entry-heading">Log a candidate</h2></div></div>
        <p className="help">Enter the exact contract, quote observation time, and executable all-in per-contract cost (price + applicable fees/depth). Type your own model estimate. A separate source is required for B; a sourced dollar split for this exact side is required for C. Unknown inputs reject those strategies, never default to zero.</p>
        <form onSubmit={logSnapshot} className="entry-form">
          <label>Matchup<input name="matchup" required placeholder="Team A @ Team B" /></label>
          <label>Exact contract<input name="contract" required placeholder="Kalshi ticker / resolution" /></label>
          <label>Side<input name="side" required placeholder="Team A YES / Over 45.5" /></label>
          <label>Quote observed at<input name="quoteTime" type="datetime-local" required /></label>
          <label>All-in cost per contract (¢)<input name="cost" type="number" min="0.01" max="99.99" step="0.01" required /></label>
          <label>Model win probability (%)<input name="model" type="number" min="0.01" max="99.99" step="0.01" required /></label>
          <label>Independent probability (%)<input name="consensus" type="number" min="0.01" max="99.99" step="0.01" /></label>
          <label>Independent source<input name="consensusSource" placeholder="Source + quote time" /></label>
          <label>Dollar share on our side (%)<input name="crowd" type="number" min="0" max="100" step="0.01" /></label>
          <label>Dollar split source<input name="crowdSource" placeholder="Reporting book(s) + time" /></label>
          <div className="confirmations">
            <label><input type="checkbox" name="rules" /> Contract rules checked</label>
            <label><input type="checkbox" name="news" /> News checked</label>
            <label><input type="checkbox" name="depth" /> Depth and fees checked</label>
          </div>
          <button className="primary" type="submit">Log paper snapshot</button>
          {notice && <p role="alert">{notice}</p>}
        </form>
      </section>
      <section className="board" aria-labelledby="log-heading">
        <p className="eyebrow">02 / AUDIT</p><h2 id="log-heading">All candidates</h2>
        <p className="help">Decisions are captured at entry time, not recalculated after the result. Settlement applies only to strategies that marked PAPER. Winning payout assumes $1 per contract; mark exceptional settlements void until verified.</p>
        <div className="table-wrap"><table><thead><tr><th>SNAPSHOT / CONTRACT</th><th>COST / MODEL / PAYOUT</th><th>A · VALUE</th><th>B · CONSENSUS</th><th>C · CROWD</th><th>OUTCOME</th></tr></thead><tbody>
          {entries.map((entry) => <tr key={entry.id}>
            <td><strong>{entry.candidate.matchup}</strong><span>{entry.candidate.contract} · {entry.candidate.side}</span><span>{new Date(entry.candidate.observedAt).toLocaleString()}</span></td>
            <td>{(entry.candidate.allInCost * 100).toFixed(2)}¢ / {(entry.candidate.modelProbability * 100).toFixed(1)}% / {entry.results[0]?.payoutMultiple?.toFixed(2) ?? '—'}×</td>
            {STRATEGIES.map((strategy) => { const result = entry.results.find((item) => item.id === strategy.id); return <td key={strategy.id}><b className={result?.status === 'PAPER' ? 'positive' : 'muted'}>{result?.status ?? '—'}</b><span className="reasons">{result?.reasons.join('; ') || 'All checks passed'}</span></td> })}
            <td><strong>{entry.outcome.toUpperCase()}</strong><div className="outcome-actions">{(['win', 'loss', 'void'] as const).map((outcome) => <button type="button" key={outcome} onClick={() => settle(entry.id, outcome)} aria-label={`Mark ${outcome}`}>{outcome}</button>)}</div></td>
          </tr>)}
          {entries.length === 0 && <tr><td className="empty" colSpan={6}>No candidates logged yet.</td></tr>}
        </tbody></table></div>
        <p className="help">{entries.filter((entry) => entry.outcome === 'win' || entry.outcome === 'loss').length} settled snapshots · {entries.reduce((total, entry) => total + (entry.outcome === 'win' || entry.outcome === 'loss' ? entry.results.filter((result) => result.status === 'PAPER').length : 0), 0)} eligible strategies settled. Not independent bets when strategies agree on a candidate.</p>
      </section>
      <footer>MANUAL LOCAL PAPER LOG · NO KALSHI CONNECTION · NO REAL ORDERS · NOT FINANCIAL ADVICE</footer>
    </main>
  )
}

function App() {
  const [session, setSession] = useState<{ authenticated: boolean; username?: string } | null>(null)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

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
  if (session.authenticated) return <Dashboard onLogout={handleLogout} />

  return <main className="auth-shell"><section className="login-card" aria-labelledby="login-title"><a className="brand" href="#login"><span className="brand-mark">E</span><span>EDGEBOARD</span></a><p className="eyebrow">ADMIN ACCESS</p><h1 id="login-title">Paper research, locked down.</h1><p>Sign in to access the local paper-trading ledger. No live orders are available.</p><form onSubmit={submitLogin}><label>Username<input name="username" autoComplete="username" defaultValue="Admin" required /></label><label>Password<input name="password" autoComplete="current-password" type="password" required /></label><button className="primary" disabled={submitting} type="submit">{submitting ? 'Signing in…' : 'Sign in'}</button>{message && <p role="alert">{message}</p>}</form></section></main>
}

export default App