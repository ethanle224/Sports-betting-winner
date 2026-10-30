import { verifySessionToken } from '../server/auth-core.js'
import { createHash } from 'node:crypto'
import { collectOpeningNbaMarkets, mapNbaSchedule, NBA_KALSHI_BASE, rankOpeningNbaGame, chooseNbaShadowSide, compareNbaPlayerTotals, type NbaMarket } from '../server/nba-kalshi.js'
import { collectNbaPlayerTotals, playerTotalChance, type NbaPlayerTotalsCache } from '../server/nba-player-totals.js'
import { createNbaPlayerFetcher } from '../server/nba-player-fetch.js'
import { collectNbaFactors, type NbaFactor } from '../server/nba-factors.js'
import { collectNbaCurrentHistory } from '../server/nba-current-history.js'
import { applyNbaSelectionPolicy, applyNbaPlayerSelectionPolicy, applyNbaPlayerMarketsSelectionPolicy } from '../server/nba-policy.js'
import { collectNbaMarketBooks } from '../server/nba-market-books.js'
import { forecastNbaChallenger, NBA_CHALLENGER_CONFIG } from '../server/nba-challenger.js'
import { loadNbaChallengerSnapshot } from '../server/nba-challenger-snapshot.js'
import challengerSnapshot from '../server/data/nba-challenger-calibration.json' with { type: 'json' }
import { collectNbaShotMatchup, shotGame } from '../server/nba-shot-profile.js'
import { fitNbaCalibration, forecastNbaGame, recentNbaMeetings, type NbaGame } from '../server/nba-model.js'
import snapshot from '../server/data/nba-games.json' with { type: 'json' }

type Request = { method?: string; headers?: { cookie?: string }; query?: { date?: string | string[]; quantity?: string | string[] } }
type Response = { setHeader: (name: string, value: string) => void; status: (code: number) => { json: (body: unknown) => void } }
type ScheduledEvent = { id?: string; date?: string; season?: { type?: number }; status?: { type?: { state?: string } };
  competitions?: { neutralSite?: boolean; competitors?: { homeAway?: string; team?: { id?: string; location?: string; name?: string; abbreviation?: string } }[] }[] }
const history = snapshot.games as NbaGame[]
const calibration = fitNbaCalibration(history)
const snapshotSha256 = createHash('sha256').update(JSON.stringify(history)).digest('hex')
const challengerCalibration = loadNbaChallengerSnapshot(challengerSnapshot, snapshotSha256)


function selectedMarkets(markets: NbaMarket[], gameId: string, forecast: NonNullable<ReturnType<typeof forecastNbaGame>>, referenceTotal: number | null) {
  const available = markets.filter((m) => m.gameId === gameId)
  const moneyline = available.filter((m) => m.kind === 'moneyline')
  const spread = available.filter((m) => m.kind === 'spread').sort((a, b) => Math.abs((a.line ?? 0) - Math.abs(forecast.expectedMargin)) - Math.abs((b.line ?? 0) - Math.abs(forecast.expectedMargin))).slice(0, 4)
  const totals = available.filter((m) => m.kind === 'total')
  const byModel = [...totals].sort((a, b) => Math.abs((a.line ?? 0) - forecast.expectedTotal) - Math.abs((b.line ?? 0) - forecast.expectedTotal)).slice(0, 4)
  const byMarket = referenceTotal === null ? [] : [...totals].sort((a, b) => Math.abs((a.line ?? 0) - referenceTotal) - Math.abs((b.line ?? 0) - referenceTotal)).slice(0, 4)
  return [...new Map([...moneyline, ...spread, ...byModel, ...byMarket].map((item) => [item.ticker, item])).values()]
}

export default async function handler(request: Request, response: Response): Promise<void> {
  response.setHeader('Cache-Control', 'private, no-store')
  if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); response.status(405).json({ error: 'Method not allowed' }); return }
  const secret = process.env.EDGEBOARD_SESSION_SECRET
  const cookie = request.headers?.cookie?.split(';').map((s) => s.trim()).find((s) => s.startsWith('edgeboard_session='))?.slice(18)
  if (!secret || !verifySessionToken(cookie, secret)) { response.status(401).json({ error: 'Unauthorized' }); return }
  const date = request.query?.date
  if (typeof date !== 'string' || !/^20\d\d-\d\d-\d\d$/.test(date) ||
    !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date || date < '2026-10-20' || date > '2027-04-11') {
    response.status(400).json({ error: 'Use a 2026–27 regular-season date (YYYY-MM-DD)' }); return
  }
  const scheduleSource = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date.replaceAll('-', '')}`
  const quantityText = request.query?.quantity ?? '10'
  if (typeof quantityText !== 'string' || !/^[1-9]\d{0,2}$/.test(quantityText) || Number(quantityText) > 100) {
    response.status(400).json({ error: 'Quantity must be 1–100 whole contracts' }); return
  }
  const quantity = Number(quantityText)
  try {
    const scheduleResponse = await fetch(scheduleSource, { signal: AbortSignal.timeout(12000) })
    if (!scheduleResponse.ok) throw new Error('Schedule unavailable')
    const schedule: { events?: ScheduledEvent[] } = await scheduleResponse.json()
    if (!Array.isArray(schedule.events)) throw new Error('Schedule incomplete')
    const mappedGames = mapNbaSchedule(date, schedule.events)
    const observedHistoryAt = new Date().toISOString()
    const futureTips = schedule.events!.filter((event) => mappedGames.some((game) => game.gameId === event.id) &&
      event.status?.type?.state === 'pre' && Date.parse(event.date ?? '') > Date.parse(observedHistoryAt))
      .map((event) => event.date!).sort()
    const current = futureTips.length ? await collectNbaCurrentHistory(futureTips[0], observedHistoryAt) :
      { games: [] as NbaGame[], sources: [] as string[], observedAt: observedHistoryAt }
    const activeHistory = [...history, ...current.games]
    const shotCache = new Map<string, Promise<ReturnType<typeof shotGame>>>()
    const playerCache: NbaPlayerTotalsCache = new Map()
    const playerFetcher = createNbaPlayerFetcher()
    const inventory = mappedGames.length ? await collectOpeningNbaMarkets(date, mappedGames) :
      { observedAt: new Date().toISOString(), source: NBA_KALSHI_BASE, series: [], markets: [] as NbaMarket[] }
    // All supported open contracts, not the legacy nearest-line subset. A failed
    // or expired collection returns no partial picks. Reads are public GET only.
    const pregameIds = new Set(schedule.events.filter((event) => event.status?.type?.state === 'pre' &&
      Date.parse(event.date ?? '') > Date.now()).map((event) => event.id))
    const allBooks = await collectNbaMarketBooks(inventory.markets.filter((m) => pregameIds.has(m.gameId)).map((m) => m.ticker))
    const games = await Promise.all(mappedGames.map(async (mapped) => {
      const matching = schedule.events!.filter((item) => item.id === mapped.gameId)
      const event = matching[0]
      const competition = event?.competitions?.[0]
      const homeId = competition?.competitors?.find((item) => item.homeAway === 'home')?.team?.id
      const awayId = competition?.competitors?.find((item) => item.homeAway === 'away')?.team?.id
      if (matching.length !== 1 || homeId !== mapped.homeId || awayId !== mapped.awayId || event.season?.type !== 2 ||
        typeof competition?.neutralSite !== 'boolean' || !event.date || !Number.isFinite(Date.parse(event.date))) throw new Error('Selected game mapping changed')
      const beforeTip = event.status?.type?.state === 'pre' && Date.parse(event.date) > Date.now()
      const forecast = beforeTip ? forecastNbaGame({ home: homeId, away: awayId, tip: event.date, neutral: competition.neutralSite }, activeHistory, calibration, 'nba-scores-v2') : null
      const playerPromise = beforeTip ? collectNbaPlayerTotals(
        { home: homeId, away: awayId, tip: event.date, neutral: competition.neutralSite },
        activeHistory, observedHistoryAt, playerFetcher, playerCache) : null
      const challengerModel = forecast && challengerCalibration ? forecastNbaChallenger(
        { home: homeId, away: awayId, tip: event.date, neutral: competition.neutralSite },
        activeHistory, forecast, calibration, challengerCalibration) : null
      const contextPromise = collectNbaFactors(mapped, activeHistory, new Date().toISOString())
      const { pregameLine, ...context } = await contextPromise
      const shotPromise = beforeTip ? collectNbaShotMatchup(homeId, awayId, activeHistory,
        new Date().toISOString(), fetch, shotCache) : Promise.resolve({ status: 'unknown' as const, detail: 'Past tip; no new pregame shot-profile evidence.' })
      const chosen = forecast ? selectedMarkets(inventory.markets, mapped.gameId, forecast, pregameLine?.total ?? null) : []
      const shadowExtra = !forecast || !pregameLine ? [] : inventory.markets.filter((market) =>
        market.gameId === mapped.gameId && market.kind === 'spread' && market.line !== undefined &&
        Math.abs((market.team === 'home' ? -1 : 1) * market.line - pregameLine.homeSpread) <= 3 &&
        !chosen.some((item) => item.ticker === market.ticker))
        .sort((a, b) => Math.abs((a.team === 'home' ? -1 : 1) * a.line! - pregameLine.homeSpread) -
          Math.abs((b.team === 'home' ? -1 : 1) * b.line! - pregameLine.homeSpread)).slice(0, 4)
      const gameMarkets = inventory.markets.filter((market) => market.gameId === mapped.gameId)
      const inspectedMarkets = gameMarkets.filter((market) => Object.prototype.hasOwnProperty.call(allBooks.books, market.ticker))
      const rawBooks = Object.fromEntries(inspectedMarkets.map((m) => [m.ticker, allBooks.books[m.ticker]]))
      const bookObservedAt = allBooks.observedAt
      // Keep the original score-only and totals-v4 comparisons on their original
      // bounded quote subsets; new v5 selection alone sees every supported line.
      const baselineBooks = Object.fromEntries(chosen.map((m) => [m.ticker, rawBooks[m.ticker]]))
      const ranked = rankOpeningNbaGame(mapped, inventory.markets, baselineBooks, forecast, quantity, beforeTip ? pregameLine : null)
      const expandedBooks = Object.fromEntries([...chosen, ...shadowExtra].map((m) => [m.ticker, rawBooks[m.ticker]]))
      const expanded = shadowExtra.length ? rankOpeningNbaGame(mapped, inventory.markets, expandedBooks, forecast, quantity, pregameLine) : ranked
      // Compare side forecasts on exactly the same observed contract subset and quotes.
      // Extra reference-line reads never affect the frozen original baseline rank.
      const sideMarkets = inventory.markets.filter((market) => market.kind !== 'total')
      const comparisonBaseline = rankOpeningNbaGame(mapped, sideMarkets, expandedBooks, forecast, quantity, pregameLine)
      const challengerRanking = challengerModel ? rankOpeningNbaGame(mapped, sideMarkets, expandedBooks,
        challengerModel.forecast, quantity, pregameLine) : null
      const challenger = challengerModel && challengerRanking ? { ...challengerModel, status: 'SHADOW_ONLY' as const,
        promotionGate: 'REJECTED_HISTORICAL_EVALUATION' as const,
        studySide: challengerRanking.studySide && challengerRanking.studySide.estimatedNetEdge > 0 ? challengerRanking.studySide : null,
        candidates: challengerRanking.candidates,
        comparisonBaseline: { studySide: comparisonBaseline.studySide && comparisonBaseline.studySide.estimatedNetEdge > 0 ?
          comparisonBaseline.studySide : null, candidates: comparisonBaseline.candidates } } : null
      const baselineShadowSide = chooseNbaShadowSide(expanded.candidates, ranked.studySide, inventory.markets, pregameLine)
      const extraCandidates = expanded.candidates.filter((candidate) => !ranked.candidates.some((item) =>
        item.ticker === candidate.ticker && item.side === candidate.side))
      const shotZones = await shotPromise
      const playerSimulation = playerPromise ? await playerPromise : null
      const legacySelection = applyNbaSelectionPolicy(ranked.studySide, quantity)
      const totalsPolicy = applyNbaPlayerSelectionPolicy(ranked.candidates, playerSimulation, quantity)
      const policy = applyNbaPlayerMarketsSelectionPolicy(gameMarkets,
        beforeTip && Date.parse(event.date) > Date.now() ? rawBooks : {}, playerSimulation, quantity)
      const playerTotals = playerSimulation ? { simulation: playerSimulation,
        comparison: { ...compareNbaPlayerTotals(ranked.candidates, (kind, line) => playerTotalChance(playerSimulation, kind, line), 'main'),
          rankingRule: 'net gap descending; ticker ASCII ascending; YES before NO',
          candidates: totalsPolicy.candidates, studySide: totalsPolicy.studySide,
          baselineStudySide: ranked.studySide, baselinePolicyStudySide: legacySelection.studySide, legacySelection,
          baselineShadowSide, baselineExpandedCandidates: [...ranked.candidates, ...extraCandidates] },
        marketComparison: { ...policy, status: 'PAPER_ONLY_EXPERIMENT' as const, promotionGate: 'USER_APPROVED_PAPER_ONLY' as const,
          rankingRule: 'net gap descending; ticker ASCII ascending; YES before NO' } } : null
      const side = policy.studySide
      const matchingMarket = side && inventory.markets.find((market) => market.ticker === side.ticker && market.gameId === mapped.gameId)
      const observedAt = new Date().toISOString()
      const unknown = (detail: string): NbaFactor => ({ status: 'unknown', detail })
      const meetings = recentNbaMeetings({ home: homeId, away: awayId, tip: event.date, neutral: competition.neutralSite }, activeHistory)
      const marginDifference = forecast && pregameLine ? Math.abs(forecast.expectedMargin + pregameLine.homeSpread) : null
      const factors = { ...context, shotZones,
        marketDisagreement: marginDifference !== null && pregameLine ? {
          status: 'estimated',
          detail: `Old score-only comparison home margin ${forecast!.expectedMargin.toFixed(1)} vs ${pregameLine.provider} implied home margin ${(-pregameLine.homeSpread).toFixed(1)} (${marginDifference.toFixed(1)} points apart). ` +
            `${marginDifference >= 7 ? 'MATERIAL DISAGREEMENT: roster and model inputs need human review; do not treat a cheap alternate spread as proof of value.' : 'This is a benchmark, not an injury/roster-adjusted projection.'}`,
          source: pregameLine.source, observedAt: pregameLine.observedAt } as NbaFactor : unknown('Independent sportsbook spread unavailable; model–market disagreement cannot be checked.'),
        venueH2H: { status: 'verified', detail: `Venue ${competition.neutralSite ? 'neutral' : mapped.homeCity + ' home'}; ${meetings.length} prior meetings in the score archive. Context only, zero extra model weight.`,
          source: snapshot.sources?.[0]?.url ?? scheduleSource, observedAt } as NbaFactor,
        contractRules: matchingMarket && side?.rules === matchingMarket.rules_primary && side.rulesSecondary === matchingMarket.rules_secondary ? { status: 'verified', detail: 'Exact selected Kalshi ticker and primary/secondary rules observed; fair-price resolution remains possible.',
          source: `${NBA_KALSHI_BASE}/markets/${encodeURIComponent(matchingMarket.ticker)}`, observedAt: inventory.observedAt } as NbaFactor : unknown('Exact selected contract text unavailable.'),
        fairPrice: matchingMarket && /fair price/i.test(matchingMarket.rules_secondary) ? { status: 'verified', detail: 'Contract text permits fair-price resolution if the scheduled game does not start within the specified window; payout cannot be known in advance.',
          source: `${NBA_KALSHI_BASE}/markets/${encodeURIComponent(matchingMarket.ticker)}`, observedAt: inventory.observedAt } as NbaFactor : unknown('Fair-price clause not confirmed in selected rules.'),
        fees: side ? { status: 'estimated', detail: '7% general taker-fee formula applied to sized quote; exact series charges and hypothetical execution are not confirmed.',
          source: 'https://kalshi.com/docs/kalshi-fee-schedule.pdf', observedAt } as NbaFactor : unknown('No sized side for fee estimate.'),
        depth: side && rawBooks[side.ticker] && bookObservedAt[side.ticker] ? { status: 'verified', detail: `${quantity}-contract displayed orderbook depth was observed for this side and included in the sized price; not a fill guarantee.`,
          source: `${NBA_KALSHI_BASE}/markets/${encodeURIComponent(side.ticker)}/orderbook`, observedAt: bookObservedAt[side.ticker] } as NbaFactor : unknown('Selected-side sized depth unavailable.'),
        fillability: unknown('No real order is placed. Future depth, slippage and final executable price cannot be verified ahead of a fill.') }
      return { ...ranked, ...policy, shadowSide: null, challenger, playerTotals,
        baselineStudySide: ranked.studySide, baselinePolicyStudySide: legacySelection.studySide, legacySelection,
        pricedSides: policy.candidates.length,
        marketInspection: { mode: 'ALL_SUPPORTED_OPEN_MARKETS' as const, listed: gameMarkets.length,
          inspected: inspectedMarkets.length, complete: inspectedMarkets.length === gameMarkets.length },
        home: mapped.homeCity, away: mapped.awayCity, startsAt: event.date, forecast,
        pregameLine: beforeTip ? pregameLine : null,
        factors,
        inspected: inspectedMarkets.map((m) => ({ ticker: m.ticker, source: `${NBA_KALSHI_BASE}/markets/${m.ticker}/orderbook`, book: rawBooks[m.ticker],
          observedAt: bookObservedAt[m.ticker] })) }
    }))
    response.status(200).json({ date, quantity, observedAt: new Date().toISOString(), marketObservedAt: inventory.observedAt,
      historyObservedAt: current.observedAt,
      modelEvidence: { snapshotSha256, snapshotHashEncoding: 'sha256(JSON.stringify(snapshot.games))',
        currentGames: current.games, baselineCalibration: calibration, challengerConfig: NBA_CHALLENGER_CONFIG,
        challengerPromotionGate: 'REJECTED_HISTORICAL_EVALUATION',
        challengerCalibration: challengerCalibration ? { trainingSeason: challengerCalibration.trainingSeason,
          baselineTrainingSeason: challengerCalibration.baselineTrainingSeason, sampleSize: challengerCalibration.sampleSize,
          marginSd: challengerCalibration.marginSd, asOf: challengerCalibration.asOf } : null },
      historySources: [...(snapshot.sources?.map((item) => item.url) ?? []), ...current.sources],
      currentSeasonFinals: current.games.length,
      sources: { schedule: scheduleSource, markets: inventory.source, feeSchedule: 'https://kalshi.com/docs/kalshi-fee-schedule.pdf' },
      series: inventory.series, marketInventory: inventory.markets, games, status: 'STUDY_ONLY_NO_QUALIFIED_PICKS' })
  } catch { response.status(502).json({ error: 'NBA public scan incomplete or selected-date schedule mapping changed; no partial picks returned' }) }
}
