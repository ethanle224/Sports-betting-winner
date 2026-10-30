// Explicit one-shot paper research capture. No scheduler, DB or exchange credentials.
import { randomBytes, createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import handler from '../api/nba-scan.js'
import { createSessionToken } from '../server/auth-core.js'
import { freezeNbaStudy, type NbaScan } from '../src/nba-paper.js'
import { NBA_PLAYER_MARKETS_SELECTION_POLICY } from '../server/nba-policy.js'

export async function captureNbaForward(date: string, outputDirectory: string) {
  if (!/^20\d\d-\d\d-\d\d$/.test(date)) throw new Error('Use an explicit date YYYY-MM-DD')
  const prior = process.env.EDGEBOARD_SESSION_SECRET
  const ephemeralSecret = randomBytes(32).toString('hex')
  process.env.EDGEBOARD_SESSION_SECRET = ephemeralSecret
  let status = 0; let payload: unknown
  try {
    await handler({ method: 'GET', query: { date, quantity: '10' },
      headers: { cookie: `edgeboard_session=${createSessionToken('local-paper-research', ephemeralSecret)}` } }, {
      setHeader: () => {}, status: (code) => { status = code; return { json: (body) => { payload = body } } },
    })
  } finally {
    if (prior === undefined) delete process.env.EDGEBOARD_SESSION_SECRET
    else process.env.EDGEBOARD_SESSION_SECRET = prior
  }
  if (status !== 200) throw new Error(`Public scan failed (${status}): ${JSON.stringify(payload)}`)
  const scan = payload as NbaScan
  // A v6 artifact is a v5 cross-market cohort, never a relabelled legacy or mixed scan.
  if (!Array.isArray(scan?.games) || scan.games.some((game) => game.selectionPolicy !== NBA_PLAYER_MARKETS_SELECTION_POLICY)) {
    throw new Error('Forward capture requires exclusively v5 cross-market policy games; legacy, missing or mixed policies are not relabelled.')
  }
  // Freeze validation rejects past tips, stale prices and incomplete records.
  // No requestedPaper evidence: this cannot create a tracker pick or an order.
  const freeze = freezeNbaStudy(scan, {}, new Date().toISOString())
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const files = ['vercel.json', 'api/nba-scan.ts', 'server/nba-model.ts', 'server/nba-challenger.ts', 'server/nba-policy.ts',
    'server/nba-kalshi.ts', 'server/nba-market-books.ts', 'server/nba-player-totals.ts', 'server/nba-player-fetch.ts', 'server/nba-current-history.ts', 'server/nba-factors.ts', 'server/nba-shot-profile.ts',
    'server/nba-challenger-snapshot.ts', 'server/data/nba-challenger-calibration.json',
    'src/nba-paper.ts', 'src/nba-simulation-summary.ts', 'scripts/capture-nba-forward.ts']
  const codeSha256 = Object.fromEntries(await Promise.all(files.map(async (file) =>
    [file, createHash('sha256').update(await readFile(path.join(root, file))).digest('hex')])))
  const artifact = { schema: 'nba-forward-comparison-v6', paperOnly: true, orderCapability: false,
    researchProtocol: { version: 'nba-player-markets-forward-v4', modelVersion: 'nba-player-totals-v2',
      selectionPolicy: NBA_PLAYER_MARKETS_SELECTION_POLICY,
      marketScope: 'ALL_SUPPORTED_OPEN_MARKETS', status: 'PAPER_ONLY_EXPERIMENT', promotionGate: 'USER_APPROVED_PAPER_ONLY',
      rankingRule: 'net gap descending; ticker ASCII ascending; YES before NO', userApprovedPaperSelector: true,
      historicalRecordsRewritten: false, checkpoint: '2026-11-01',
      automaticPromotion: false, onePrimaryPerGame: true,
      cohorts: ['immutable v5 cross-market main paper selections and abstentions', 'old score-only selection on the same scan', 'old totals-only comparator on the same scan'],
      ranking: 'Freeze both UNCALIBRATED market-specific payout probability from paired score draws and probability minus estimated all-in cost; do not equate chance with gap or fit a winning cutoff after settlement.',
      evaluation: 'First valid pre-tip observation per game/policy; v5 is the user-approved cross-market main paper selector across supported moneyline, spread and total quotes, not live trading; old model and totals-only comparator retained unchanged; compare models on identical contracts/quotes, report coverage differences; net units after estimated costs primary, W/L and Brier secondary; report missing inputs and cluster candidate comparisons by game.',
      independence: 'Alternative lines and complementary sides from the same game are not independent bets. Never pool primary and standalone study records.' },
    firstObservationRule: 'Use first valid pre-tip capture per game/model for evaluation; retain later captures separately.',
    codeSha256, freeze }
  await mkdir(outputDirectory, { recursive: true })
  const file = path.join(outputDirectory, `${date}_${freeze.frozenAt.replaceAll(':', '-')}_${randomBytes(4).toString('hex')}.json`)
  await writeFile(file, JSON.stringify(artifact, null, 2) + '\n', { flag: 'wx' })
  const summary = { file, date, games: scan.games.length,
    primaries: scan.games.filter((game) => game.studySide).length,
    abstentions: scan.games.filter((game) => !game.studySide).length,
    challengerComparisons: scan.games.filter((game) => game.challenger).length,
    playerSimulatedGames: scan.games.filter((game) => game.playerTotals?.simulation.status === 'estimated').length,
    playerUnknownGames: scan.games.filter((game) => game.playerTotals?.simulation.status === 'unknown').length,
    playerTrials: scan.games.reduce((sum, game) => sum + (game.playerTotals?.simulation.simulations ?? 0), 0),
    playerQuotedComparisons: scan.games.filter((game) => (game.playerTotals?.marketComparison?.candidates.length ?? 0) > 0).length,
    paperOnly: true, trackerWrites: 0, orders: 0 }
  return summary
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [date, outputDirectory] = process.argv.slice(2)
  if (!date || !outputDirectory) throw new Error('Usage: npm run capture:nba -- YYYY-MM-DD OUTPUT_DIRECTORY')
  console.log(JSON.stringify(await captureNbaForward(date, outputDirectory), null, 2))
}
