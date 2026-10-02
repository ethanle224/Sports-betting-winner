# Edgeboard Project Record

## What this is

**Edgeboard** is the name of this project’s paper-only Kalshi sports research dashboard. It is not a sportsbook, broker, or live trading bot.

Its job is to record the same pre-event market snapshot through fixed checklists, preserve every acceptance/rejection decision, and evaluate results honestly after settlement.

## Current product boundary

- Manual, browser-local paper ledger.
- Signed-in, read-only public Kalshi market and orderbook API; no live score feed. The new pregame forecast layer is local until separately deployed.
- No account access, real orders, account balance, or automatic settlement.
- Browser `localStorage` retains entries locally; clearing browser data removes them.
- The GitHub/Vercel UI must not contain passwords, private keys, API keys, or other secret values.

## Paper experiment: version 1

| Strategy | Must pass |
| --- | --- |
| **A — Value baseline** | Model probability is at least 5 percentage points above all-in executable cost. |
| **B — Independent consensus** | Model probability is at least 4pp above cost **and** a separately sourced probability is at least 6pp above cost. |
| **C — Crowd caution** | Passes A and a sourced sportsbook dollar split puts no more than 65% of money on our exact side. |

### Shared gates

Every candidate needs:

1. Exact contract, market side, and resolution rules recorded.
2. Quote observed within 30 minutes; no future timestamps.
3. Rules, news/injuries, depth, and fee checks explicitly completed.
4. Valid all-in cost and model probability.
5. Winning payout of at least 1.7× all-in cost; a documented exactly-2.00-unit conviction play may use 1.65× without waiving other gates.
6. A paper entry before the event — including rejected candidates.

A strategy can mark a candidate `PAPER` or `REJECT`. Shared candidates are correlated, not separate independent bets. These thresholds are experimental settings, not proven edges.

### Unit allocation (experiment version 2)

- Starting bankroll $1,000 for each independently compared strategy. 1 unit = $25 intended risk; 0.00–2.00 units per candidate in 0.01-unit steps. 0 units abstains; maximum intended risk per entry is $50.
- A 2.00-unit entry requires the explicit high-confidence flag and written supporting rationale to qualify; its minimum winning payout is 1.65× all-in cost. All other sizes require at least 1.7×. Edge, rules, news, depth and quote-time checks remain mandatory.
- Freeze whole contracts by rounding down intended dollar stake divided by entered fee-aware per-contract cost. P&L uses frozen quantity, not the nominal unit target. Older saved entries keep their original 10-contract P&L. Inspect depth at the proposed whole-share quantity, not an arbitrary sample size.
- This is manual experimental sizing, not an empirically calibrated confidence algorithm. The local model calculates experimental full-game probabilities for exact listed lines; it does not choose or size paper picks.
- New unit-sized paper entries require a named independent model source/method and calculation timestamp within 24 hours. These are manually entered audit evidence, not a verified model. The selected day's scanner inventories every open listed market across nine NFL families; its quote quantity is shares per selected contract, now adjustable from 1–1000 for on-demand orderbook inspection, not a limit on the number of games or markets found. Quote fees and ledger size are not yet automatically reconciled.
- The read-only local scanner now models full-game winners, spreads and totals separately by listed threshold using prior completed-game points scored and allowed, with shrinkage and historical paired-score residuals. Unsupported/mismatched contracts and both half-game phases stay unrated. The score baseline omits first downs, efficiency, injury/weather and QB context. It beat a naive league baseline on 272 chronological 2025 games but **lost to archived bookmaker odds** (home-win Brier 0.2254 versus 0.2116). Therefore it is not a validated edge or automatic checklist approval. Details and source: `README.md`.

## NFL research checklist

For each day’s NFL slate, assess both sides where available for:

- Full game: winner, spread, total
- First half: winner, spread, total
- Second half: winner, spread, total

**Alternate-line screening:** Do not reduce each spread or total to one headline number. Enumerate every listed alternate spread and over/under threshold for the same game and phase, and treat each ticker, side, threshold, and settlement rule as a separate candidate. A safer line changes both the probability of winning and its purchase price; compare fee-aware executable cost, payout floor, and independently estimated probability for that **exact** threshold. Never transfer a forecast for over 45.5 to over 43.5, or a full-game forecast to a first-half/second-half line. Compare qualifying choices within a game and control their shared exposure rather than presenting correlated alternatives as independent bets. If a sportsbook allows a custom line that Kalshi does not list, it is not a Kalshi paper candidate.

### Pregame

- [ ] Discover relevant public Kalshi markets.
- [ ] Record exact contract, resolution rules, quote time, executable depth, and fee-aware cost.
- [ ] Compare against independent, timestamped evidence for the same contract.
- [ ] Log both qualified and rejected paper candidates before kickoff.
- [ ] Abstain if data, depth, rules, or independent evidence are insufficient.

### Halftime

- [ ] Treat second-half markets as a new decision.
- [ ] Record score, material injury/lineup context, and current orderbook snapshot only when actually known.
- [ ] Do not insert halftime information into a pregame decision or backdate a candidate.
- [ ] Abstain if fresh data or a credible independent estimate is missing.

### After settlement

- [ ] Resolve each paper entry from the contract’s official rules.
- [ ] Track settled sample size, net paper P&L, drawdown, and forecast calibration per strategy.
- [ ] Classify losses: price, probability estimate, stale/incomplete data, rule mismatch, fill assumption, or variance.
- [ ] Change a rule only for a repeated, testable failure; version the new rule and test on future events.

## Login plan

The current deployed Vite frontend is public static content. A client-side password check would be cosmetic only, because a visitor can still download the frontend assets.

A real login needs Vercel server-side functions for login, session validation, and logout, with an HTTP-only signed cookie. It will protect user sessions and future API/data endpoints. It does **not** turn previously public static files into private server content by itself.

### Required Vercel environment variables

Set these for **Production**, **Preview**, and **Development**:

| Name | Purpose | Never commit |
| --- | --- | --- |
| `EDGEBOARD_ADMIN_PASSWORD` | Verifies the one admin login server-side. | Value |
| `EDGEBOARD_SESSION_SECRET` | Random server-only signing key for tamper-resistant session cookies. | Value |

Do **not** prefix either with `VITE_`; Vite exposes `VITE_*` variables to browser code.

Generate the session secret in a password manager, not in Git or chat. A safe example command to run locally is:

```bash
openssl rand -base64 48
```

Paste that output directly into Vercel’s `EDGEBOARD_SESSION_SECRET` field, then discard it from your clipboard/history if possible.

## Deployment status

- GitHub repository: `ethanle224/Sports-betting-winner`
- Current branch: `main`
- Vercel’s earlier anonymous deployment was temporary. Persistent deploys require the repository to be connected to Ethan’s authenticated Vercel account.

## Next engineering milestones

1. Add the server-side login/session routes after Vercel is connected and both environment-variable names exist.
2. Wire the public, read-only Kalshi collector to persist timestamped market and orderbook snapshots.
3. Add sport/league/contract classification and quarantine ambiguous contracts.
4. Calculate fee-aware executable cost, risk limits, and immutable paper decisions.
5. Add walk-forward calibration and post-cost evaluation before considering any live-trading work.
