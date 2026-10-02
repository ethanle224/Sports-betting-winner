# Edgeboard — Kalshi Sports Research

A read-only, on-demand NFL market scanner and manual paper-trading ledger for Kalshi sports research.

> **Data notice:** The signed-in app has an on-demand, read-only Kalshi NFL discovery/quote API and experimental pregame score forecasts. The paper ledger still requires manual review, independently verified cost/evidence, and settlement; no automatic picks, scheduled scanner, live score feed, or real orders. Browser localStorage holds up to two daily scan snapshots and 20 inspected raw orderbooks; clearing browser data deletes them. Local changes are not automatically deployed.

## Experiment 01: three fixed checklists

Enter **every candidate**, including rejected ones, before the event. All three strategies evaluate the *same snapshot* and freeze their decisions at entry. A candidate can qualify for more than one strategy; their results are therefore correlated, not independent bets.

Shared gates: exact contract/side, quote observed within 30 minutes (no future timestamps), manual rules/news/depth-and-fee checks, valid inputs, and winning payout of at least **1.7× all-in cost** for ordinary plays. New unit-sized entries also require a named independent model source/method and calculation time within 24 hours; labeling the Kalshi price as a model source rejects the candidate. This is provenance entered by the operator, **not** verification of the model or an automated probability calculation. This is a payout-on-win target, not an expected ROI target. The quote time is the time the price was actually observed, not when you enter it. Costs must include price, fees and intended-size execution; there is no automatic quote, fee or fill verification.

### Paper allocation (version 2)

- Starting bankroll **$1,000 per strategy**; **1 unit = $25** intended paper stake, with per-candidate allocation 0.00–2.00 units in 0.01 increments. Zero is an abstention, not a funded pick. Maximum intended stake is **$50** per candidate. Units measure dollars risked, **not** a count of contracts.
- Only **exactly 2.00 units** with an explicit high-confidence flag and recorded, specific rationale may use the **1.65×** all-in winning-payout floor. Other unit sizes retain 1.7×. Conviction never waives the probability-edge, quote freshness, depth, news or rule gates; these are experimental rules, not a proven sizing model.
- Freeze whole contracts as `floor(intended stake / entered all-in cost per contract)` when the candidate is logged. The actual paper stake can be slightly below the target. Simulated P&L uses the frozen contracts and entered cost, with $1 payout for a normal win. A tiny allocation that buys no whole contract is rejected. The scanner now accepts a requested **whole-share quantity (1–1000)** for each separate orderbook inspection: inspect at the intended quantity before checking depth/fees. Quote size does not limit how many markets are discovered. The displayed fee is provisional, and requested-size quote and manually entered ledger price/quantity are not yet automatically reconciled.
- Existing browser entries without unit sizing retain their original **10-contract** accounting. Do not retroactively apply the new rules or sizes to them. Each checklist is simulated independently when one candidate passes more than one. There is currently no shared cross-strategy exposure cap or verified fill feed.

- **A · Value baseline:** manually estimated win probability exceeds all-in cost by at least 5 percentage points.
- **B · Independent consensus:** manually estimated probability exceeds cost by 4pp, *and* separately sourced independent probability exceeds cost by 6pp. Missing source rejects B.
- **C · Crowd caution:** passes A, *and* a sourced sportsbook **dollar** split shows no more than 65% of money on our exact side. Missing split rejects C. This does not assume rigging or automatically bet against the crowd. Ticket counts and Kalshi trade volume are not valid substitutes for dollar splits.

These thresholds are **unvalidated experimental settings**, not discovered edges. Maintain the rules unchanged during a forward-testing block; version any later change instead of retroactively re-scoring old decisions. Enter the source and observation time for independent probabilities and splits. If a source is stale, absent, or not the same market, leave it blank and let the dependent strategy reject.

Mark unusual/partial/tied settlements `void` pending verification. Rejected candidates never contribute to P&L. Compare each strategy on settled sample size, net ROI, drawdown and forecast calibration after a sizable forward sample; a tiny positive ROI is not evidence of an edge. Never use this local prototype to place real orders.

## Daily NFL research scope

The agent chooses candidate games and lines; the user does **not** need to supply picks. Screen only NFL games scheduled for the day, including **both sides** of relevant contracts. The nine target types are: full-game winner, spread, total; first-half winner, spread, total; second-half winner, spread, total. Markets unavailable for a game are recorded as unavailable, not silently ignored.

For spreads and totals, screen **every listed alternate threshold** rather than only the headline spread/total. Each line, side, period, ticker and resolution rule is its own candidate: a more favorable threshold usually changes both its win probability and its cost. Compare the executable, fee-aware cost and independent probability for that **exact** contract; a probability for one line cannot be reused for another. Choose qualifying alternatives with the best defensible value and avoid stacking correlated positions on the same game. Custom sportsbook lines not listed on Kalshi cannot be recorded as available Kalshi paper trades. The scanner now shows experimental line-specific pregame forecasts, but validated ranking and automatic picks remain unbuilt.

1. **Pregame:** Discover that day's games and listed markets via public Kalshi data. Record contract resolution rules, quote time, executable order-book depth and fee-aware cost. Compare with independent, timestamped probability evidence for the *same exact contract*. Evaluate each candidate through A/B/C and record qualifying paper picks **before** the game. No qualifying edge means no pick.
2. **Halftime:** Treat second-half markets as a **new decision**, using first-half score, injuries, possession/lineup context and current second-half order books. Capture this information only when known; never insert it into a pregame prediction or backdate a paper pick. If timely live data or a credible independent estimate is unavailable, abstain.
3. **After settlement:** Resolve every logged candidate from official contract rules, track each strategy's settled net P&L and calibration, then classify losses as bad price, bad probability estimate, stale/incomplete information, rule mismatch, poor fill assumption, or ordinary variance. A loss by itself is **not** evidence that the model should change. Propose a new version only for a repeated, testable, preventable failure and evaluate it on later games without rewriting previous decisions.

The **Scan NFL day** control discovers all nine series for one selected original game date, paginates every series, and fails closed on incomplete API/model coverage. It lists unavailable families with zero counts rather than silently omitting them. It inventories **all currently open listed contracts**, not just ten. The old “10 contracts” was the quantity of shares used in **one** orderbook depth quote. Orderbooks are fetched **on demand per selected market** at the requested size, not for every listed market in the scan. Event-ticker date is the **originally scheduled** date, not confirmed kickoff time; a rescheduled game needs separate verification. Select a contract to inspect executable bid-complement depth for YES/NO plus a *provisional* general taker-fee estimate (series-specific fees may differ). Half-time listings are visible for planning but must be scanned again at halftime; no score or injury feed is connected. The UI does not score a contract as a paper pick from Kalshi's own price. The manual checkboxes are not verified market data. The API is session-protected and read-only; Vite's standalone dev server does not run the `/api` functions (use a Vercel-compatible local runtime or deployed environment for the UI scan).

### Experimental pregame scoring baseline

`api/nfl-model.ts` reads regular-season final scores and the schedule from [nflverse nfldata games.csv](https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv). At each selected game date it uses **only earlier dates**, up to two calendar years back. It estimates league scoring and home advantage, then each offense's recent 16-game points scored versus the opponent's recent 16-game points conceded, shrunk toward league average by eight prior games. Paired historical score residuals yield a discrete projected-score sample; the same sample is scored separately against each exact listed game-winner, spread, and total threshold. Fewer than 24 historical games or six team games, mismatched contract rules/team/line, and all first-/second-half contracts are **unrated**. Source fetch time, model version, and unrated reason accompany the read-only response. The model does **not** use Kalshi prices as input.

This baseline does **not** include first downs, conversions, EPA, injuries, quarterback status, pace, weather, opponent-adjusted strength, or a halftime score. Recent points and points allowed are a *first* feature set, not a complete football model. Winner ties can settle for half payout; the UI displays tie probability separately and does not turn forecasts into paper entries. Probabilities from this empirical sample may be overconfident at extreme lines. Indicative asks are not size-aware executable costs. No automatic A/B/C decisions or unit-sizing recommendations are issued from these forecasts.

A chronological **2025 regular-season** diagnostic (272 completed games; training dates strictly earlier than each target game) returned home-win Brier **0.2254**, compared with **0.2485** for a rolling league-home baseline and **0.2116** for no-vig archived bookmaker moneylines. Projected-total mean absolute error was **10.53 points** versus **11.00** for rolling league-total average. Archived odds timing is unknown and this is not a tradeable-edge backtest; the model **lost to the bookmaker benchmark**. Do not treat an apparent price gap, especially at an extreme alternate line, as a vetted paper bet without additional independent validation, actual depth/fees, and the rest of the checklists.

## Local development

```bash
npm install
npm run dev
```

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Planned integration

The research collector and paper-trading ledger live in a separate local Python workstream. Before live data is displayed, it will be filtered through timestamping, contract-rule checks, execution-cost estimates, risk controls, and a documented paper-trading gate.
