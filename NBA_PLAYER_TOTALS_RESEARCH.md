# Player Simulation v2 — v5 cross-market paper-primary research

## Purpose and boundary

**Player Simulation v2 is the user-approved main NBA paper selector across all supported full-game moneyline, spread and total markets**, under `nba-primary-v5-player-markets-v2` (v5). Status is `PAPER_ONLY_EXPERIMENT`; the gate is `USER_APPROVED_PAPER_ONLY`. This is an **UNCALIBRATED**, recent-rotation-conditional paper experiment, not a verified lineup forecast, calibrated odds, neural-model fine-tune, demonstrated betting edge or live-trading policy. Select at most one eligible positive estimated post-cost-gap side per game. Abstain on invalid inputs, unsupported or unquoted markets, or no positive gap. There is no fallback to the old model, no forced market choice, no real order capability and no scheduled operation. The old score-only selection and old totals-only comparator remain comparison evidence, not competing v5 main choices. Historical tickets and immutable artifacts are not rewritten.

## Inputs and reproducibility

- Each on-demand pregame scan uses finalized current-season history available before observation minus a six-hour safety buffer. Need at least two reconciled games per team; use at most the latest five. This is a small-sample research minimum, not a quality guarantee.
- Validate game identity/date/final status, player shooting/points, and player/team aggregate reconciliation. Missing required sources produce `unknown`, not an invented zero or a fallback player forecast.
- Use individual historical minutes, 2PA/3PA/FTA and shooting rates; preserve the sampled whole-team rotation and normalize to regulation minutes. Sample shots/makes with fixed shrinkage and shared attempt variation. Include bounded overtime for ties.
- V2 explicitly records team points scored and points allowed ("given up" is the same statistic), both per game and normalized to 48 minutes. Historical overtime does not inflate the regulation scoring baseline.
- When verified team turnovers exist on both sides of every sample game, estimate paired possessions from `FGA + 0.44 * FTA - OREB + TO`, averaging the two teams and normalizing to 48 minutes. This is a box-score estimate, not tracked possessions. Missing turnovers leave pace unknown; player turnover totals are not silently substituted for team totals.
- Move the player scoring baseline 15% toward the matchup pace midpoint, then blend toward the midpoint of own offensive efficiency and opponent allowed efficiency with weight `0.15 * n / (n + 5)`, where `n` is the smaller team game count. Without complete pace evidence, use only that small blend toward normalized points-for/points-allowed rates. These fixed coefficients are declared research assumptions, not fitted or validated improvements.
- V2 gives the old opponent allowed-shooting adjustment zero separate weight: points allowed already capture made shots. OREB enters possession estimation only; observed FGA already include second chances, so no extra rebound-derived attempts are added.
- Parse signed player `+/-` and reconcile a complete team column to five times the final score margin. Preserve missing values as unknown. Historical `+/-`, assists, steals, blocks, fouls, rebound context and team paint are recorded without independent score bonuses. A box-score `+/-` cannot identify a player's individual points allowed or causal on/off impact; it does not alter scores or the random seed.
- **Player paint attempts remain unknown. All 2PA are not paint.** Injuries, confirmed starters, trades and minutes restrictions are not inferred from old box scores. The simulation remains conditional on recent historical rotations, not a verified forecast of today's lineup. The app's venue, rest, H2H and injury notes are separate context, not hidden numerical adjustments. This is not an "all factors" model.
- Exactly 1,000 trials when the required inputs are valid. Store seed, input summaries/rotations, source URLs, observation/cutoff, simulated scores/totals and model version in the scan. For identical inputs the run is reproducible. Simulation error is not model uncertainty; 1,000 runs do not create 1,000 independent outcome observations.
- Every pregame v5 scan reads all mapped supported open moneyline, spread and total order books, rather than a top-N or near-reference shortlist. `marketInspection` records `mode: ALL_SUPPORTED_OPEN_MARKETS`, listed/inspected counts and `complete: true`. This completeness claim covers supported mapped markets, not every exchange product. Unsupported props, first-half/other period markets and integer/push contracts remain excluded; absent or unfillable YES/NO quotes are not fabricated.
- Estimate each supported contract outcome directly from the **same paired home/away score draws**: final winner for moneyline, signed score margin against the spread, and combined points against the total. These market-specific frequencies are conditional simulation estimates, not calibrated odds. No market probability feeds the score simulation.
- Price every executable supported YES/NO side at the requested size, preserving sized quotes, fee estimates, all-in costs and exact rules. Rank by **net gap descending; ticker ASCII ascending; YES before NO**, where net gap is the estimated payout probability minus estimated all-in per-contract cost. Chance rank is distinct from gap rank; alternatives and complementary sides are displayed even when their gap is nonpositive. Only a valid positive-gap leader can be the one main paper selection.
- `game.candidates` and `game.studySide` are the v5 cross-market primary result; `playerTotals.marketComparison` records that v5 policy, candidates, selection/abstention, paper-only status/gate and ranking rule. The preserved `playerTotals.comparison` is the old totals-only comparator. Never substitute it for a missing v5 choice or relabel a prior bounded `crossMarketShadow` as v5 primary evidence. For model comparisons, use the same captured contract/quote subset and explicitly report coverage differences.

## Freeze before outcomes

The one-shot `capture:nba` artifact stores the complete scan and code SHA-256 values, including `server/nba-market-books.ts`, the policy/simulation/quote implementations, calibration data and `vercel.json`. It performs no tracker/DB/order writes. Captures use append-only, exclusive file creation. Keep the first valid pre-tip observation per game/policy for evaluation; preserve later rescans separately, never pick the version that eventually won. Clicking Track in the app saves the v5 choice with its simulation and old-model comparison in one immutable paper record. Comparison models do not create extra tracked picks. Previously frozen v3, v4 and legacy records retain their original policies and selections.

The score simulation version remains **`nba-player-totals-v2`**; the active cross-market policy is **`nba-primary-v5-player-markets-v2`**. New forward artifacts have **schema v6** and research protocol **`nba-player-markets-forward-v4`**, recording explicit user approval, all-supported-market scope, paper-only status/gate, deterministic ranking, model/policy versions and code hashes. Capture fails closed on missing, legacy or mixed game policies instead of labeling them a v5 cohort. Earlier schema-v5/v4 totals-only policy data (`nba-primary-v4-player-totals-v2`) and `nba-player-totals-shadow-v1`/`nba-player-totals-shadow-v2` artifacts remain separate and unchanged. The history UI labels v5 as `Player Simulation v2 · v5 cross-market`, distinct from the v4 totals-only cohort.

The UI reports paired team score means, total median and central 80% simulation range, plus simulated home-win frequency; those ranges describe model draws, not calibrated real-game confidence. V5 displays all quoted YES/NO candidates with uncalibrated chance, estimated fee, all-in cost and net gap, ordered across market types. Highest simulated payout probability is displayed separately from largest estimated after-cost gap. Missing inputs, empty supported markets and nonpositive gaps are explicit abstentions, not totals-only fallback choices.

For analysis keep these cohorts distinct:

1. Main **v5 cross-market** paper decisions, including abstentions under the active policy.
2. Old score-only model's same-time selection, retained for comparison only.
3. Old totals-only comparator on the captured scan; it does not choose the v5 main side.
4. Historical **v4 totals-only main** paper records, retained under their original policy.
5. Standalone historical total-study cards and prior shadow records, reported separately.

Freeze every candidate's probability **and** estimated net gap. Highest probability, largest estimated gap, and selected baseline pick can differ. Do not select a probability/edge cutoff after viewing wins. Alternative lines, complementary sides and repeat scans are correlated observations, not additional independent games.

## Sunday checkpoint — November 1, 2026

Manual review only; no cron and no automatic promotion.

- Report eligible games, unknown/missing inputs, settled/pending/fair-price outcomes and abstentions.
- For each cohort, report W/L and net units after estimated entry costs using the existing 1u stake convention. Never count a hypothetical quote as an actual fill.
- Compare baseline/player probability on the **same contract** against final settlement (Brier/calibration), and each model's frozen one-per-game choice. Report sportsbook/executable-price benchmarks where frozen, not reconstructed closing data.
- Inspect probability-ranked versus gap-ranked cross-market candidates, but cluster alternative-contract comparisons by game and report exact sample sizes. A high-probability pick can win often and still lose units when overpriced.
- Diagnose whether apparent improvement comes from projection quality, selection, price, small sample, or differing coverage. Do not tune on this checkpoint and describe that same sample as validation.
- The user explicitly approved v2 under v5 as the cross-market main paper selector; that approval is not statistical validation. Neither prior totals results nor a cross-market trend validates this new cohort or establishes profitability. If evidence remains sparse or contradictory, report it honestly. Further policy changes or retirement of the comparison model require explicit approval.

## Historical caution

The following audits and release checks describe earlier totals-only/shadow policies, not v5 cross-market results. No new v5 performance claim follows from them.

Prior immutable primary-ledger totals and standalone total-study cards are different populations. Historical winning totals alone do not establish that the highest estimated totals rank wins more reliably. A rank/outcome audit must use original frozen pregame estimates and trustworthy settlements; absent evidence remains unknown.

The bounded October 28 audit checked 464 frozen candidate-side values against the original October 24 study (8 games). Highest-probability choices were 8–0 / +0.414052u; highest-net-gap choices were 3–5 / −2.333257u; the actual near-reference card policy was 2–6 / −3.660450u. These are distinct retrospective baskets, not a new rule or independent 464-game sample. Only eight selected tickers had exact cached exchange corroboration; other lines are labeled score-implied. Separately, tracked primary totals were 8–3 / +6.732208u across 11 tickets. The audit report and row-level provenance are at `C:/Users/Ethan Le/AppData/Local/Temp/edgeboard-player-study-audit/REPORT.md`; no outcome-selected cutoff was adopted.

## Historical v1 engineering verification — October 28, 2026

- Final full local gates: **346 tests passed, 4 skipped**; lint, browser/server typechecks, production build, and whitespace check passed. Local built UI HTTP smoke returned 200; interaction tests cover successful/unknown shadows without extra tracker controls.
- Final real public scan of October 28: **12 games; 9 valid player simulations × 1,000 trials; 3 unknown; 94 same-quote total candidate sides across the 9 valid games**. Unknown cases failed minute/boxscore reconciliation; no minutes were imputed. This is engineering coverage, not settled performance evidence.
- All 9,000 simulated totals exactly reproduced an earlier unchanged-input scan despite later observation/quote times. Candidate price, total fee, per-contract all-in cost, and rule text matched the baseline quotes. All captured code hashes matched the final runtime files.
- Final source artifact: `C:/Users/Ethan Le/AppData/Local/Temp/edgeboard-player-forward/2026-10-28_2026-10-28T16-14-26.057Z_8b894a37.json`.
- Tomorrow's October 29 smoke also completed 1,000 trials for all 3 games, but its observed inventory had no safely mapped total contracts. No total quotes/picks were fabricated.
- Shared player fetches retain two slate-wide slots through JSON consumption, honor caller cancellation, skip canceled queued work, and discard late canceled results. Regression tests cover slow/ignored-abort bodies. Collector timeouts and source failure remain `unknown`.
- Local changes only: no commit, push, deployment, tracker/database writes, scheduler or real orders. This does not establish better calibration, an edge, or profitability.

## Initial v2 shadow engineering checks — before main-selector approval

- Full local gate: **366 tests passed, 4 skipped**; lint, browser/server typechecks, production build and whitespace check passed. The two NBA routes also compile under NodeNext. `npm audit` reports no known vulnerabilities after patch-level dependency updates. The built local page returns HTTP 200; UI behavior is covered by automated interaction tests, not a claimed manual signed-in browser inspection.
- First real public-data v2 capture: **12 games; 8 valid simulations × 1,000 paired draws; 84 same-quote total sides**. Every successful game used the pace-and-efficiency path and retained signed plus/minus samples. All paired scores and totals reconcile; artifact code hashes match source.
- Four unknowns are explicit: three have player-minute/DNP evidence problems; Golden State–Minnesota additionally fails a historical team/player foul reconciliation. The public summary for event `401909850` reports Memphis 29 team fouls versus 30 summed player PF, and Golden State 26 versus 27. The discrepancy is not silently repaired.
- First v2 artifact: `C:/Users/Ethan Le/AppData/Local/Temp/edgeboard-player-v2-forward/2026-10-28_2026-10-28T16-47-25.358Z_3994a425.json`. Captures are outside source control, append-only and separate from v1 evidence. The smoke check made no tracker/database or order writes.
- A second live scan at `2026-10-28T16:52:37.970Z` reproduced all eight seeds and all 8,000 paired score/total draws exactly; all captured code hashes still match. Quote changes do not select a new random seed. Unknown cases also remained unknown.
- These are software/data-coverage checks, not settled forward performance. No profitability, calibration improvement or verified current-lineup adjustment is established.

## Historical totals-only main-v2 (v4 policy) release verification — October 28, 2026

- Full stable-source gates: **419 tests passed, 4 skipped**, plus lint, browser/server typecheck, production build, whitespace check and NodeNext compile of both NBA routes. `npm audit` reports zero known vulnerabilities. The built local page responds HTTP 200 with the current release bundle.
- Final read-only main-selector capture: **12 games, 8 v2 main paper choices, 4 abstentions, 8,000 paired simulated games, 84 same-quote total sides**. All 12 old-model choices remain captured for comparison. V2 choices are totals only; unavailable or invalid model evidence does not fall back to an old-model pick.
- Final artifact: `C:/Users/Ethan Le/AppData/Local/Temp/edgeboard-v2-main-final/2026-10-28_2026-10-28T19-10-10.688Z_5762e53b.json`. Every captured runtime hash matches source, all paired scores reconcile, all 84 comparison sides preserve the baseline prices/fees/rules, and all 8,000 draws exactly reproduce the earlier main-v2 scan. No tracker/database or order writes occurred in these captures.
- Freeze/tracking checks recompute permitted v2 probabilities and selection, reconcile raw sized books and rules, reject altered or omitted executable candidate evidence, and retain legacy v3 validation. Historical records are not migrated into the new model cohort. The history table labels each record's frozen model.
- Review repairs cover non-OK and late-aborted HTTP body cancellation while holding the two physical fetch slots, and reject impossible nonzero AST/TO/STL/BLK/PF on DNP rows even when team totals agree. Missing optional statistics remain unknown.
- These checks establish implementation and data coverage, not a calibrated win rate or profitable strategy. V2 is the main **paper** selector by explicit user choice, not by a proven forward-performance promotion gate.
