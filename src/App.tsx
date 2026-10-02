import { useMemo, useState } from 'react'
import './styles.css'

type Sport = 'All' | 'Basketball' | 'Football' | 'Tennis'

type Candidate = {
  matchup: string
  league: string
  sport: Exclude<Sport, 'All'>
  side: string
  marketPrice: number
  modelPrice: number
  edge: number
  liquidity: string
  start: string
}

const candidates: Candidate[] = [
  {
    matchup: 'Knicks @ Celtics',
    league: 'NBA',
    sport: 'Basketball',
    side: 'Celtics YES',
    marketPrice: 62,
    modelPrice: 67,
    edge: 5.0,
    liquidity: '$1,240',
    start: 'Tonight · 7:30 PM',
  },
  {
    matchup: 'Duke vs. North Carolina',
    league: 'NCAAB',
    sport: 'Basketball',
    side: 'Duke YES',
    marketPrice: 54,
    modelPrice: 58,
    edge: 4.0,
    liquidity: '$780',
    start: 'Tomorrow · 6:00 PM',
  },
  {
    matchup: 'Chiefs @ Bills',
    league: 'NFL',
    sport: 'Football',
    side: 'Bills YES',
    marketPrice: 49,
    modelPrice: 55,
    edge: 6.0,
    liquidity: '$2,410',
    start: 'Sun · 4:25 PM',
  },
  {
    matchup: 'Michigan @ Ohio State',
    league: 'NCAAF',
    sport: 'Football',
    side: 'Ohio State YES',
    marketPrice: 57,
    modelPrice: 60,
    edge: 3.0,
    liquidity: '$920',
    start: 'Sat · 12:00 PM',
  },
  {
    matchup: 'Alcaraz vs. Sinner',
    league: 'ATP',
    sport: 'Tennis',
    side: 'Alcaraz YES',
    marketPrice: 51,
    modelPrice: 57,
    edge: 6.0,
    liquidity: '$1,560',
    start: 'Fri · 2:00 PM',
  },
  {
    matchup: 'Gauff vs. Swiatek',
    league: 'WTA',
    sport: 'Tennis',
    side: 'Gauff YES',
    marketPrice: 46,
    modelPrice: 50,
    edge: 4.0,
    liquidity: '$1,130',
    start: 'Sat · 11:00 AM',
  },
]

const sports: Sport[] = ['All', 'Basketball', 'Football', 'Tennis']

function App() {
  const [sport, setSport] = useState<Sport>('All')
  const [query, setQuery] = useState('')

  const filteredCandidates = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return candidates.filter((candidate) => {
      const matchesSport = sport === 'All' || candidate.sport === sport
      const matchesQuery =
        normalizedQuery.length === 0 ||
        `${candidate.matchup} ${candidate.league} ${candidate.side}`.toLowerCase().includes(normalizedQuery)
      return matchesSport && matchesQuery
    })
  }, [query, sport])

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#overview" aria-label="Edgeboard home">
          <span className="brand-mark">E</span>
          <span>EDGEBOARD</span>
        </a>
        <div className="status"><span className="dot" /> PAPER MODE · NO LIVE ORDERS</div>
      </header>

      <section className="hero" id="overview">
        <div>
          <p className="eyebrow">KALSHI SPORTS RESEARCH</p>
          <h1>Find the gap.<br /><em>Test the edge.</em></h1>
          <p className="lede">A paper-only command center for tracking market probabilities, model estimates, and the execution reality in between.</p>
        </div>
        <aside className="risk-card" aria-label="Paper risk controls">
          <span>SIMULATED BANKROLL</span>
          <strong>$1,000.00</strong>
          <div><b>$25</b> max position <b>10</b> positions max</div>
        </aside>
      </section>

      <section className="stats" aria-label="Paper-trading summary">
        <article><span>QUALIFIED CANDIDATES</span><strong>06</strong><small>after risk + liquidity filters</small></article>
        <article><span>AVERAGE MODEL EDGE</span><strong className="positive">+4.7¢</strong><small>before fees and simulated fills</small></article>
        <article><span>OPEN PAPER EXPOSURE</span><strong>$0.00</strong><small>no positions are open</small></article>
      </section>

      <section className="board" aria-labelledby="candidate-heading">
        <div className="board-heading">
          <div>
            <p className="eyebrow">WATCHLIST</p>
            <h2 id="candidate-heading">Paper candidates</h2>
          </div>
          <label className="search">
            <span className="sr-only">Search candidates</span>
            <input
              aria-label="Search candidates"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search matchup or league"
              value={query}
            />
          </label>
        </div>

        <div className="filters" aria-label="Sport filter">
          {sports.map((name) => (
            <button className={sport === name ? 'active' : ''} key={name} onClick={() => setSport(name)} type="button">
              {name}
            </button>
          ))}
        </div>

        <div className="table-wrap">
          <table>
            <thead><tr><th>EVENT</th><th>SIDE</th><th>MARKET</th><th>MODEL</th><th>EDGE</th><th>LIQUIDITY</th><th>START</th></tr></thead>
            <tbody>
              {filteredCandidates.map((candidate) => (
                <tr key={candidate.matchup}>
                  <td><strong>{candidate.matchup}</strong><span>{candidate.league} · {candidate.sport}</span></td>
                  <td>{candidate.side}</td>
                  <td>{candidate.marketPrice}¢</td>
                  <td>{candidate.modelPrice}¢</td>
                  <td className="positive">+{candidate.edge.toFixed(1)}¢</td>
                  <td>{candidate.liquidity}</td>
                  <td>{candidate.start}</td>
                </tr>
              ))}
              {filteredCandidates.length === 0 && <tr><td className="empty" colSpan={7}>No paper candidates match that filter.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <footer>PROTOTYPE FIXTURE DATA · NOT CONNECTED TO KALSHI · NOT FINANCIAL ADVICE</footer>
    </main>
  )
}

export default App
