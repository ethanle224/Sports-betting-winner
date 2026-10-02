# Edgeboard — Kalshi Sports Research

A read-only, on-demand NFL market scanner and manual paper-trading ledger for Kalshi sports research.

> **Data notice:** The signed-in app has an on-demand, read-only Kalshi NFL discovery/quote API. The paper ledger still requires manual probability estimates, news/rule review and settlement; no automatic picks, scheduled scanner, live score feed, or real orders. Browser localStorage holds up to two daily scan snapshots and 20 inspected raw orderbooks; clearing browser data deletes them. Nothing here is deployed automatically.

## Experiment 01: three fixed checklists

Enter **every candidate**, including rejected ones, before the event. All three strategies evaluate the *same snapshot* and freeze their decisions at entry. A candidate can qualify for more than one strategy; their results are therefore correlated, not independent bets.

Shared gates: exact contract/side, quote observed within 30 minutes (no future timestamps), manual rules/news/depth-and-fee checks, valid inputs, and winning payout of at least **1.7× all-in cost** for ordinary plays. This is a payout-on-win target, not an expected ROI target. The quote time is the time the price was actually observed, not when you enter it. Costs must include price, fees and intended-size execution; there is no automatic quote, fee or fill verification.

### Paper allocation (version 2)

- Starting bankroll **$1,000 per strategy**; **1 unit = $25** intended paper stake, with per-candidate allocation 0.00–2.00 units in 0.01 increments. Zero is an abstention, not a funded pick. Maximum intended stake is **$50** per candidate. Units measure dollars risked, **not** a count of contracts.
- Only **exactly 2.00 units** with an explicit high-confidence flag and recorded, specific rationale may use the **1.65×** all-in winning-payout floor. Other unit sizes retain 1.7×. Conviction never waives the probability-edge, quote freshness, depth, news or rule gates; these are experimental rules, not a proven sizing model.
- Freeze whole contracts as `floor(intended stake / entered all-in cost per contract)` when the candidate is logged. The actual paper stake can be slightly below the target. Simulated P&L uses the frozen contracts and entered cost, with $1 payout for a normal win. A tiny allocation that buys no whole contract is rejected. The 10-contract scanner quote is **not** sufficient evidence of executable depth for a larger unit-sized entry: inspect the orderbook at the intended quantity before checking depth/fees.
- Existing browser entries without unit sizing retain their original **10-contract** accounting. Do not retroactively apply the new rules or sizes to them. Each checklist is simulated independently when one candidate passes more than one. There is currently no shared cross-strategy exposure cap or verified fill feed.

- **A · Value baseline:** manually estimated win probability exceeds all-in cost by at least 5 percentage points.
- **B · Independent consensus:** manually estimated probability exceeds cost by 4pp, *and* separately sourced independent probability exceeds cost by 6pp. Missing source rejects B.
- **C · Crowd caution:** passes A, *and* a sourced sportsbook **dollar** split shows no more than 65% of money on our exact side. Missing split rejects C. This does not assume rigging or automatically bet against the crowd. Ticket counts and Kalshi trade volume are not valid substitutes for dollar splits.

These thresholds are **unvalidated experimental settings**, not discovered edges. Maintain the rules unchanged during a forward-testing block; version any later change instead of retroactively re-scoring old decisions. Enter the source and observation time for independent probabilities and splits. If a source is stale, absent, or not the same market, leave it blank and let the dependent strategy reject.

Mark unusual/partial/tied settlements `void` pending verification. Rejected candidates never contribute to P&L. Compare each strategy on settled sample size, net ROI, drawdown and forecast calibration after a sizable forward sample; a tiny positive ROI is not evidence of an edge. Never use this local prototype to place real orders.

## Daily NFL research scope

The agent chooses candidate games and lines; the user does **not** need to supply picks. Screen only NFL games scheduled for the day, including **both sides** of relevant contracts. The nine target types are: full-game winner, spread, total; first-half winner, spread, total; second-half winner, spread, total. Markets unavailable for a game are recorded as unavailable, not silently ignored.

1. **Pregame:** Discover that day's games and listed markets via public Kalshi data. Record contract resolution rules, quote time, executable order-book depth and fee-aware cost. Compare with independent, timestamped probability evidence for the *same exact contract*. Evaluate each candidate through A/B/C and record qualifying paper picks **before** the game. No qualifying edge means no pick.
2. **Halftime:** Treat second-half markets as a **new decision**, using first-half score, injuries, possession/lineup context and current second-half order books. Capture this information only when known; never insert it into a pregame prediction or backdate a paper pick. If timely live data or a credible independent estimate is unavailable, abstain.
3. **After settlement:** Resolve every logged candidate from official contract rules, track each strategy's settled net P&L and calibration, then classify losses as bad price, bad probability estimate, stale/incomplete information, rule mismatch, poor fill assumption, or ordinary variance. A loss by itself is **not** evidence that the model should change. Propose a new version only for a repeated, testable, preventable failure and evaluate it on later games without rewriting previous decisions.

The **Scan NFL day** control now discovers all nine series for one selected original game date, paginates every series, and fails closed on incomplete API coverage. It lists unavailable families with zero counts rather than silently omitting them. Event-ticker date is the **originally scheduled** date, not confirmed kickoff time; a rescheduled game needs separate verification. Select a contract to inspect an orderbook: 10-contract executable bid-complement depth for YES/NO plus a *provisional* general taker-fee estimate (series-specific fees may differ). Half-time listings are visible for planning but must be scanned again at halftime; no score or injury feed is connected. The UI does not score a contract as a paper pick from Kalshi's own price. The manual checkboxes are not verified market data. The API is session-protected and read-only; Vite's standalone dev server does not run the `/api` functions (use a Vercel-compatible local runtime or deployed environment for the UI scan).

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
