import type { ReactNode } from 'react'
import { nbaReturnUnits, nbaSideLabel, type NbaReview, type NbaScanGame } from './nba-paper'
import type { NbaAuditReport } from './nba-audit'
import type { summarizeNbaHistory } from './nba-paper'
import { signedUnits } from './nba-board-format'

type Entry = ReturnType<typeof summarizeNbaHistory>['entries'][number]
type Props = { entries: Entry[]; audits: NbaAuditReport[]; notices: Record<string, string>;
  renderReview: (entry: Entry) => ReactNode }
const labelDate = (date: string) => new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric',
}).format(new Date(`${date}T12:00:00Z`))
const status = (review: NbaReview | null) => review?.outcome === 'FAIR_PRICE' ? 'Fair price' :
  review?.payout === 1 ? 'Win' : review?.payout === 0 ? 'Loss' : 'Pending'

function PickDetails({ entry, audit, renderReview }: { entry: Entry; audit?: NbaAuditReport; renderReview: Props['renderReview'] }) {
  const { freeze, decision, review } = entry
  const game = freeze.scan.games.find((item) => item.gameId === decision.gameId) as NbaScanGame
  const side = decision.selected!
  return <details className="nba-board-details"><summary>Contract &amp; settlement</summary>
    <div className="nba-board-detail-content">
      <p><strong>Frozen contract:</strong> {side.side.toUpperCase()} · <code>{side.ticker}</code> · estimated all-in {(side.allInCost * 100).toFixed(2)}¢ per contract · 10 paper contracts, no actual fill.</p>
      {audit ? <p><strong>Final score:</strong> {audit.actual ? `${game.away} ${audit.actual.away} · ${game.home} ${audit.actual.home}` : 'Fair-price settlement (no binary score)'}. <a href={audit.marketSource} target="_blank" rel="noreferrer">Contract ↗</a> · <a href={audit.scheduleSource} target="_blank" rel="noreferrer">NBA score ↗</a></p>
        : <p>{review ? 'Manual settlement recorded; public-source audit not yet recorded.' : 'Awaiting verified final settlement. Pending is not a loss.'}</p>}
      {!review && renderReview(entry)}
    </div>
  </details>
}

export default function NbaHistoryBoard({ entries, audits, notices, renderReview }: Props) {
  const groups = entries.reduce<Record<string, Entry[]>>((byDate, entry) => {
    (byDate[entry.freeze.scan.date] ??= []).push(entry)
    return byDate
  }, {})
  return <div className="nba-board" aria-label="NBA paper picks board">{Object.entries(groups).sort(([a], [b]) => b.localeCompare(a)).map(([date, picks]) => {
    const rows = [...(picks ?? [])].sort((a, b) => a.decision.gameId.localeCompare(b.decision.gameId))
    const groupUnits = rows.reduce((sum, entry) => sum + (entry.review ? nbaReturnUnits(entry.review) : 0), 0)
    return <section className="nba-board-group" key={date}>
      <h4>{labelDate(date)} <span>{rows.length} {rows.length === 1 ? 'pick' : 'picks'} · {signedUnits(groupUnits)} settled net</span></h4>
      <div className="nba-board-scroll"><table aria-label={`Paper picks for ${labelDate(date)}`}>
        <thead><tr><th scope="col">Selected Kalshi side</th><th scope="col">Model</th><th scope="col">Pregame reference</th><th scope="col">Result</th><th scope="col">Stake</th><th scope="col">Net units</th><th scope="col">Shadow comparison</th><th scope="col">Source</th></tr></thead>
        <tbody>{rows.map((entry) => {
          const { freeze, decision, review } = entry
          const game = freeze.scan.games.find((item) => item.gameId === decision.gameId)!
          const id = `${freeze.id}:${decision.gameId}`
          const audit = audits.find((item) => item.id === id)
          const shadowAudit = audits.find((item) => item.id === `${id}:shadow` && item.variant === 'shadow')
          const outcome = status(review)
          return <tr key={id} className={`nba-board-${outcome.toLowerCase().replace(' ', '-')}`}>
            <td><div className="nba-board-pick"><strong>{nbaSideLabel(decision.selected!, game)}</strong><span>{game.away} @ {game.home} · {decision.status === 'STUDY' ? 'Study, not qualified' : 'Paper experiment'}</span></div>
              <PickDetails entry={entry} audit={audit} renderReview={renderReview} />{notices[id] && <p className="nba-board-notice" role="status">{notices[id]}</p>}</td>
            <td className="nba-board-reference">{game.selectionPolicy === 'nba-primary-v4-player-totals-v2' ? 'Player Simulation v2' : 'Old score-only / legacy'}</td>
            <td className="nba-board-reference">{game.pregameLine ? <>
              <strong>{game.home} {game.pregameLine.homeSpread > 0 ? '+' : ''}{game.pregameLine.homeSpread}</strong>
              <span>{game.away} {game.pregameLine.awaySpread > 0 ? '+' : ''}{game.pregameLine.awaySpread}</span>
              {game.pregameLine.total !== undefined && <span>Game total: {game.pregameLine.total ?? 'not captured'}</span>}
              <a href={game.pregameLine.source} target="_blank" rel="noreferrer">{game.pregameLine.provider}</a>
              <small>Observed {new Date(game.pregameLine.observedAt).toLocaleString()}</small>
            </> : 'Not captured before tip'}</td>
            <td><span className={`nba-board-status nba-board-status-${outcome.toLowerCase().replace(' ', '-')}`}>{outcome}</span></td>
            <td>1.00u</td>
            <td className="nba-board-units">{review ? signedUnits(nbaReturnUnits(review)) : '—'}</td>
            <td className="nba-board-reference">{decision.shadow ? <>
              <p>{nbaSideLabel(decision.shadow, game)} · {shadowAudit ? shadowAudit.outcome === 'FAIR_PRICE' ? 'Fair price' : shadowAudit.outcome === 'WIN' ? 'Win' : 'Loss' : 'Pending'} · {shadowAudit ? signedUnits(shadowAudit.payout / decision.shadow.allInCost - 1) : '—'}</p>
              <small>1u hypothetical · all-in {(decision.shadow.allInCost * 100).toFixed(2)}¢ · not in baseline</small>
              {shadowAudit && <a href={shadowAudit.marketSource} target="_blank" rel="noreferrer">Shadow contract ↗</a>}
            </> : '—'}</td>
            <td className="nba-board-source">{audit ? 'Final verified' : review ? 'Manual review' : 'Awaiting final'}</td>
          </tr>
        })}</tbody>
      </table></div>
    </section>
  })}</div>
}
