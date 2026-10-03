import { useState } from 'react'
import type { ScannedMarket } from '../server/nfl-core'
import type { MarketForecast } from '../server/nfl-forecast'
import type { BookmakerLine } from '../server/nfl-bookmaker'
import type { MatchupContext } from '../server/nfl-efficiency'
import type { WeightedTeamForm } from '../server/nfl-preseason'

type DailyScan = { date: string; collectedAt: string; coverage: { complete: boolean; count: number };
  series: { ticker: string; kind: string; phase: string; count: number }[]; markets: ScannedMarket[];
  forecasts?: MarketForecast[]; modelSource?: string; modelFetchedAt?: string;
  bookmakerLines?: BookmakerLine[]; bookmakerStatus?: string; bookmakerSource?: string;
  contexts?: { event: string; home: string; away: string; context: MatchupContext | null;
    homeForm?: WeightedTeamForm | null; awayForm?: WeightedTeamForm | null }[];
  efficiencyStatus?: 'current' | 'refreshed' | 'unavailable'; efficiencySnapshotThrough?: string | null;
  preseasonStatus?: 'observed' | 'unavailable'; preseasonObservedAt?: string; preseasonSources?: string[] }
type Quote = { ticker: string; quantity: number; observedAt: string; source: string; raw: unknown;
  yes: { price: number; estimatedAllIn: number; estimatedFee: number } | null;
  no: { price: number; estimatedAllIn: number; estimatedFee: number } | null }
const KEY = 'edgeboard-nfl-scan-v1'
const QUOTES_KEY = 'edgeboard-nfl-quotes-v1'

function savedScans(): DailyScan[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(value) ? value.filter((s) => s && typeof s === 'object' && s.coverage?.complete === true && Array.isArray(s.markets)) : [] }
  catch { return [] }
}

export default function NflScanner() {
  const [date, setDate] = useState(() => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
  const [history, setHistory] = useState<DailyScan[]>(savedScans)
  const [scan, setScan] = useState<DailyScan | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quantity, setQuantity] = useState(40)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run() {
    setBusy(true); setError(''); setQuote(null)
    try {
      const response = await fetch(`/api/nfl-scan?date=${encodeURIComponent(date)}&forecast=1`, { credentials: 'same-origin' })
      if (!response.ok) throw new Error(`Scan unavailable (HTTP ${response.status}). No partial slate recorded.`)
      const result: DailyScan = await response.json()
      if (!result.coverage?.complete || !Array.isArray(result.series) || !Array.isArray(result.markets) || result.series.length !== 9 || !Array.isArray(result.forecasts) || result.forecasts.length !== result.markets.length) throw new Error('Incomplete scan or forecast; no partial slate recorded.')
      const next = [result, ...history.filter((item) => item.date !== result.date)].slice(0, 2)
      localStorage.setItem(KEY, JSON.stringify(next))
      setHistory(next); setScan(result)
    } catch (err) { setError(err instanceof Error ? err.message : 'Scan failed.'); setScan(null) }
    finally { setBusy(false) }
  }

  async function inspect(ticker: string) {
    setError(''); setQuote(null)
    try {
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) throw new Error('Enter 1–1000 whole contracts for this quote.')
      const response = await fetch(`/api/nfl-scan?ticker=${encodeURIComponent(ticker)}&quantity=${quantity}`, { credentials: 'same-origin' })
      if (!response.ok) throw new Error(`Orderbook unavailable (HTTP ${response.status})`)
      const result: Quote = await response.json()
      let previous: Quote[] = []
      try { const stored: unknown = JSON.parse(localStorage.getItem(QUOTES_KEY) || '[]'); if (Array.isArray(stored)) previous = stored }
      catch { /* Discard corrupted old cache, never the new quote. */ }
      localStorage.setItem(QUOTES_KEY, JSON.stringify([result, ...previous].slice(0, 20)))
      setQuote(result)
    } catch (err) { setError(err instanceof Error ? err.message : 'Orderbook unavailable') }
  }

  const visible = scan ?? history.find((item) => item.date === date) ?? null
  const forecastByTicker = new Map(visible?.forecasts?.map((item) => [item.ticker, item]) ?? [])
  const grouped = (visible?.markets ?? []).reduce<Record<string, ScannedMarket[]>>((acc, item) => {
    const game = item.eventTicker.replace(/^KXNFL(?:GAME|SPREAD|TOTAL|1H(?:SPREAD|TOTAL)?|2H(?:SPREAD|TOTAL)?)-/, '')
    ;(acc[game] ??= []).push(item)
    return acc
  }, {})
  return <section className="board" aria-labelledby="scanner-heading">
    <p className="eyebrow">00 / DISCOVER</p><h2 id="scanner-heading">NFL day scanner</h2>
    <p className="help">Scan every listed contract across nine NFL market families. An independent sportsbook spread/total anchors available exact pregame winner, spread, and total forecasts; the older scores-only baseline is labeled separately when odds are missing. Halves are unrated. Updated football efficiency and current-season-first form (with low-weight preseason games) are context, not probability adjustments. Neither forecast is a validated edge or paper pick. Inspect depth for ONE contract at the intended size; indicative asks are not fills.</p>
    <div className="scan-controls"><label>NFL game date <input type="date" value={date} onChange={(event) => { setDate(event.target.value); setScan(null); setQuote(null) }} /></label><button className="primary" type="button" disabled={busy} onClick={() => void run()}>{busy ? 'Scanning…' : 'Scan NFL day'}</button></div>
    {error && <p role="alert">{error}</p>}
    {visible && <>
      <p className="help">Complete scan from {new Date(visible.collectedAt).toLocaleString()} · {visible.coverage.count} listed contracts · {Object.keys(grouped).length} events. Stored in this browser only; prices age immediately.</p>
      <p className="help">{visible.forecasts ? `${visible.forecasts.filter((item) => item.status === 'MODELED').length} experimental pregame forecasts · ${visible.forecasts.filter((item) => item.status === 'UNRATED').length} unrated.` : 'Older scan: no independent forecasts.'} No automatic paper picks: model has not beaten archived bookmaker odds in walk-forward testing. No A/B/C pass is claimed without verified executable quotes and independent consensus.</p>
      {visible.bookmakerStatus && <p className="help">External sportsbook odds: {visible.bookmakerStatus}. ESPN gives no quote-update time here; collection time does not prove odds freshness. {visible.bookmakerSource && <a href={visible.bookmakerSource} target="_blank" rel="noreferrer">Source</a>}</p>}
      {visible.efficiencyStatus && <p className="help">Efficiency {visible.efficiencyStatus}{visible.efficiencySnapshotThrough ? ` through ${visible.efficiencySnapshotThrough}` : ': latest completed-game source unavailable; stale stats hidden'}. Final scores and sportsbook odds are checked afresh with each scan.</p>}
      {visible.preseasonStatus && <p className="help">Preseason results: {visible.preseasonStatus}. Only completed games known before the selected date count; preseason scores are weaker evidence because rosters and play-calling can differ. {visible.preseasonSources?.[0] && <a href={visible.preseasonSources[0]} target="_blank" rel="noreferrer">Source</a>}</p>}
      <div className="scan-controls"><label>Quote size (whole contracts) <input type="number" min="1" max="1000" step="1" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label></div>
      <div className="series-grid">{visible.series.map((item) => <span key={item.ticker}>{item.kind} <b>{item.count}</b></span>)}</div>
      {Object.entries(grouped).map(([event, markets]) => {
        const matchup = visible.contexts?.find((item) => item.event === event)
        const line = visible.bookmakerLines?.find((item) => item.home === matchup?.home && item.away === matchup?.away)
        const context = matchup?.context
        return <details key={event} className="scan-event"><summary>{event} · {markets?.length ?? 0} contracts</summary>
          {line && <p className="help">{line.provider} sportsbook: {line.home} {line.homeSpread < 0 ? '' : '+'}{line.homeSpread.toFixed(1)} spread · {line.total.toFixed(1)} total · observed {new Date(line.observedAt).toLocaleString()}. External baseline, not a Kalshi quote.</p>}
          {matchup?.homeForm && matchup.awayForm && <div className="help"><p>Current-season-first form: 4× this regular season, 1× last season, 0.5× preseason per game. Descriptive scoring only; these weights have NOT improved the tested forecast and do not change its probability.</p>
            {[matchup.awayForm, matchup.homeForm].map((form) => <p key={form.team}>{form.team}: {form.currentGames} current · {form.previousGames} previous · {form.preseasonGames} preseason · weighted {form.pointsFor.toFixed(1)} scored / {form.pointsAgainst.toFixed(1)} allowed per game.</p>)}</div>}
          {context && <div className="help"><p>Football context through {context.snapshotThrough} (not used to adjust forecast). EPA = expected points added per play; higher offense and lower defense-allowed is better.</p>
            <p><strong>first downs/game</strong>: {context.away.team} {context.away.offense.firstDownsPerGame.toFixed(1)} vs {context.home.team} allowed {context.away.opposingDefense.firstDownsPerGame.toFixed(1)}; {context.home.team} {context.home.offense.firstDownsPerGame.toFixed(1)} vs {context.away.team} allowed {context.home.opposingDefense.firstDownsPerGame.toFixed(1)}.</p>
            <p>Success rate: {context.away.team} {(context.away.offense.successRate * 100).toFixed(0)}% vs {context.home.team} allows {(context.away.opposingDefense.successRate * 100).toFixed(0)}%; {context.home.team} {(context.home.offense.successRate * 100).toFixed(0)}% vs {context.away.team} allows {(context.home.opposingDefense.successRate * 100).toFixed(0)}%.</p>
            <p>{context.away.team} offense EPA {context.away.offense.epaPerPlay.toFixed(2)} vs {context.home.team} defense allowed {context.away.opposingDefense.epaPerPlay.toFixed(2)} · {context.away.team} offense vs {context.home.team} defense · {context.away.offense.playsPerGame.toFixed(1)} plays/game.</p>
            <p>{context.home.team} offense EPA {context.home.offense.epaPerPlay.toFixed(2)} vs {context.away.team} defense allowed {context.home.opposingDefense.epaPerPlay.toFixed(2)} · {context.home.offense.playsPerGame.toFixed(1)} plays/game.</p></div>}
          {matchup && !context && <p className="help">Efficiency context unavailable or out of date; no stats inferred.</p>}
          <div className="scan-market-list">{markets?.map((market) => { const forecast = forecastByTicker.get(market.ticker); return <article key={market.ticker}><div><strong>{market.kind}: {market.title}</strong><small>{market.ticker} · {market.phase === 'halftime' ? 'Halftime review only' : 'Pregame review'}</small><small>Indicative YES ask {market.indicativeAsk === null ? 'unavailable' : `${(market.indicativeAsk * 100).toFixed(1)}¢`} · displayed size {market.indicativeSize ?? 'unknown'}</small><small>{forecast?.status === 'MODELED' ? `Experimental YES ${(forecast.probabilityYes! * 100).toFixed(1)}% · NO ${(forecast.probabilityNo! * 100).toFixed(1)}%${forecast.tieProbability ? ` · tie ${(forecast.tieProbability * 100).toFixed(1)}% (half payout)` : ''} · ${forecast.modelVersion} · ${forecast.modelSource ?? 'source unknown'} · ${forecast.trainingGames} past games` : `Unrated: ${forecast?.reason ?? 'forecast unavailable'}`}</small><details><summary>Contract rules</summary><p>{market.rules || 'Not available: abstain'}</p></details></div><button type="button" onClick={() => void inspect(market.ticker)}>Inspect book</button></article> })}</div>
        </details>
      })}
      {visible.markets.length === 0 && <p className="help">No listed NFL contracts for this day. No pick.</p>}
    </>}
    {quote && <div className="quote-panel"><h3>{quote.ticker}</h3><p>Orderbook observed {new Date(quote.observedAt).toLocaleString()} · {quote.quantity} contracts requested. Fee estimate assumes general taker multiplier 1; verify the actual series schedule and resolution rules. Prices are NOT independent win probabilities or guaranteed fills.</p><p>YES: {quote.yes ? `${(quote.yes.estimatedAllIn * 100).toFixed(2)}¢ estimated all-in` : 'insufficient depth'} · NO: {quote.no ? `${(quote.no.estimatedAllIn * 100).toFixed(2)}¢ estimated all-in` : 'insufficient depth'}</p></div>}
  </section>
}
