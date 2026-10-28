# Edgeboard NBA model repair — October 27, 2026

## Bottom line

The audit and engineering repair are complete and tested locally. **No superior predictive replacement or profitable edge has been established.** The first opponent-adjusted challenger failed its historical gate and is explicitly rejected for promotion. Primary spread/moneyline choices are paused by the new forward-paper policy; the old baseline remains recorded for comparison. Existing positive-gap primary totals are preserved exactly, not manufactured as replacements.

**Deployment state:** local working artifact only; not committed, pushed or deployed. The production tracker and frozen history were not edited. Current worktree: `C:/Users/Ethan Le/AppData/Local/Temp/edgeboard-nba-ui-release`. A durable source/evidence ZIP accompanies this report because this worktree is under Temp.

## 1. What was actually reviewed

- All available immutable tracker exports covering October 20–25: **43 primary decisions and 15 overlapping shadow decisions**. Duplicate export objects and repeated whole-slate context are reconciled, never deleted from source history.
- The distinct October 24 totals-only research card: **8 additional research rows**, kept on its own track. One had no positive estimated gap; it is shown rather than hidden.
- **66 outcome rows** in `ALL_DECISIONS_66.csv`. These are not 66 independent bets: primary and shadow overlap games, and the research card is a different policy/quote collection.
- Re-fetched all 58 primary/shadow contracts from public Kalshi and all six ESPN date boards: **58/58 final statuses, payouts, scores and primary rule texts matched**. Separate totals: **8/8 final outcomes matched**. Raw responses are retained.
- Replayed **1,070 recorded candidate-side prices and probabilities** from frozen books/forecasts; no replay consistency failures. Missing historical prices, source commits and training inputs were not invented.
- Browser permission prevented a new authenticated cloud export. Any newer tracker entries not present in the saved export are outside this review. The public future scan is not a fresh private-ledger dump.

## 2. Actual performance — do not pool these tracks

Primary: **16–27, −6.24 simulated units**.

| Primary market | Tickets | W–L | Net units |
|---|---:|---:|---:|
| spread | 23 | 5–18 | -12.69u |
| moneyline | 9 | 3–6 | -0.29u |
| total | 11 | 8–3 | +6.73u |

- Existing higher-hit-rate shadows: **8–7, −0.99u**, separate from primary.
- Separate October 24 totals research: **2–6, −3.66u** across all eight shown rows; **2–5, −2.66u** across its seven positive-gap candidates. This contradicts any claim that totals are already a proven winning strategy, even though selected tracker totals remain 8–3.
- One unit is one simulated entry stake including frozen estimated entry fees. Normalized one-unit returns differ from fixed-ten-contract dollar returns. No fill, slippage or exact series fee was verified at entry.

- `nba-scores-v1`: 14 primary tickets, 7–7, +1.87u. Dates and inputs differ; this is not a same-time A/B comparison.
- `nba-scores-v2`: 29 primary tickets, 9–20, -8.11u. Dates and inputs differ; this is not a same-time A/B comparison.

## 3. What is wrong, and what is not established

### Supported decision/model weaknesses

1. **The largest estimated gap was treated too readily as value.** Ranking probability minus cost across many contracts preferentially selects large model/market disagreements. Across the primary sample, mean selected probability was 52.07% while only 37.21% won. For spreads, mean probability was about 54.5% but only 5/23 won. This is an overconfidence warning in this selected sample, not a fitted universal correction.
2. **The forecast lacks essential numeric context.** The baseline uses recent scored/allowed points with shrinkage. Opponent quality is not adjusted in v2; current injury/lineup impact, verified roster changes, possession-adjusted pace/efficiency and rest/travel are not numerical inputs. Reported injury text is not verified player-impact measurement.
3. **The original validation was insufficient for price-aware selection.** Full-schedule winner accuracy cannot establish that selected underdogs or alternate spreads have positive expected return. A cheap price is not evidence the model found a bargain.
4. **Small samples encouraged selective stories.** Neither the tracker totals nor the higher-hit-rate shadow justify promotion. The separate losing totals card must remain visible. New arbitrary five-point/ten-percentage-point filters or automatic opposite-side picks were not fitted to these losses.
5. **Historic reproducibility was incomplete.** Old version labels do not encode complete source-build and training-input identity. New captures retain input/calibration/config evidence, explicit code hashes, raw inspected books and priced-contract inventory.

### What was not found or cannot honestly be claimed

- No contract-side, score, settlement or unit-arithmetic mismatch in the inspected frozen records. Losing is not, by itself, proof of a software sign bug.
- A final score explains why a contract lost its condition, not whether injuries, coaching, shooting luck or price selection caused that game's result. Per-ticket residuals and missing evidence are retained; causal injury explanations remain unknown.
- The current general Kalshi fee PDF describes centicent rounding. The existing 0.0001-dollar precision was not falsely changed to whole-cent rounding on the basis of older documentation. Actual per-series/multi-fill charges remain an estimate.

## 4. Implemented changes

- `server/nba-policy.ts:8`: versioned `nba-primary-v3-sides-paused` policy. Spread/ML primaries abstain, while `baselineStudySide` retains the old choice. An already selected valid positive-gap total is unchanged. No replacement total or reversed side is invented.
- `src/nba-paper.ts:79`: freeze and tracking boundaries reapply the same policy. Matching mutations to baseline/selection cannot bypass finite-value, side, price, fee, edge, rules and half-point checks. Legacy records without the new policy still read unchanged.
- `src/NbaResearch.tsx:187`: the UI explains abstention instead of falsely reporting missing books or offering a primary Track button for a quarantined side.
- `server/nba-challenger.ts:68`: isolated opponent-adjusted ridge margin model with fixed settings, chronological six-hour embargo, deterministic input ordering/deduplication, invalid/conflicting-row rejection, neutral-site symmetry and bounded solver checks. Baseline totals and total uncertainty stay exact. **This candidate is rejected for promotion**, not presented as an improvement.
- `api/nba-scan.ts`: same-quote, same-inspected-side-universe baseline/challenger comparisons; all remain research-only. New `modelEvidence` retains the bundled-score hash, current-season final inputs, calibration and recipe. Challenger gate is `REJECTED_HISTORICAL_EVALUATION`.
- `server/nba-challenger-snapshot.ts:8`: offline calibration is bound to score/config identity. Stale or malformed artifacts disable the challenger. No 1,230-game residual refit occurs during a web request. Measured cold API import: **427 ms** after this change versus roughly 11.7 seconds for the old calibration step alone.
- `scripts/capture-nba-forward.ts:10`: explicit one-shot local research capture, with no DB writes, no tracker picks, no scheduler and no orders. The temporary process-local test session is restored in `finally`; this is not a concurrent server helper.
- `tsconfig.server.json` and `npm run typecheck`: NBA server/API/runtime scripts are now checked, not only frontend source.

## 5. The candidate was actually tested — and rejected

Bundled score archive: 3,690 games; 1,230 per season ending 2024/2025/2026. Baseline pretraining uses 2023–24. Uncertainty is learned from strictly chronological 2024–25 residuals. The final fixed candidate is evaluated on 2025–26, without fitting its parameters or uncertainty to those outcomes. There are **2,460 paired evaluation rows**, and 2023–24 is explicitly excluded from scored out-of-sample claims.

| 2025–26 historical metric | Old baseline | Candidate | Better |
|---|---:|---:|---|
| Margin mean absolute error | 11.510 | 11.782 | baseline |
| Winner Brier score | 0.20971 | 0.21638 | baseline |
| Winner log loss | 0.60796 | 0.62283 | baseline |

Lower is better for these errors. Total forecasts/uncertainty had **zero preservation mismatches**. Paired UTC-date bootstrap intervals are descriptive historical checks, not live significance guarantees. This season already existed in the archive, so it is **not a pristine live holdout**. No historical betting ROI was invented from score-only data. The candidate is retained as a rejected research control, not a production replacement, and was not retuned until this season looked favorable.

## 6. Live public-data smoke and validation

- Explicit October 28 scan: **12 games**, **12 paired challenger comparisons**, **5 baseline total study leads**, **7 primary abstentions**; **0 tracker writes and 0 orders**. All frozen decisions remain STUDY, not qualified picks.
- Two distinct observation files remain in `forward-captures/`; the second final-code smoke does not overwrite the first. Evaluation must use the first valid pre-tip observation per game/recipe, with later captures kept as observations rather than cherry-picked replacements.
- Public history refresh contained 52 eligible current-season finals in that smoke. Full verified inputs/times are in the capture, not inferred from later scores.
- Final full suite: **247 passed, 0 failed, 4 skipped across 33 files**. Four opt-in network tests were skipped, not counted as passing; explicit public scans and all-ticket outcome refresh were exercised separately.
- Lint, expanded typecheck and production build: **passed**. Logs and JSON are in `final-verification.json`, `vitest-final.json` and `verify-*.log`.
- Independent review: **passed** after the policy-boundary fix. Solver, chronology, calibration identity, total preservation and capture import safety were independently probed.
- `npm audit` also reported three high-severity dependency advisories (Vite/Undici/Zod); these are not model defects and were not silently broad-upgraded. They remain a separate security-maintenance item before any deployment decision.

## 7. How the next test stays honest

1. Keep actual money out and never chase the drawdown. Keep old version records and same-time controls; no silent retirement or historical rewrite.
2. Use on-demand `npm run capture:nba -- YYYY-MM-DD OUTPUT_DIRECTORY` in this working tree. It records research only. Existing pinned internal 1.0/2.0 manual comparisons are unchanged, not silently redirected to this new source.
3. Define a genuinely new feature-backed candidate before its next evaluation. Timestamped verified availability, roster continuity, rest and possession-adjusted efficiency need actual data and training evidence, not guessed point penalties.
4. Treat a prospective sample of at least 100 paired games over at least 20 slates only as a **manual review eligibility checkpoint**, not proof or automatic promotion. Compare same-price net units after estimated fees, calibration, selection coverage/abstentions and uncertainty by market family. Use a temporal/block sensitivity analysis; account for exploratory selection and missing references.
5. A candidate must pass its historical gate and then earn a new forward review. A favorable streak cannot automatically rescue this rejected v3 recipe. Any primary-side reactivation requires explicit review/approval.

## Evidence index

- `ALL_DECISIONS_66.csv`: compact outcome-by-outcome view, separate track labels.
- `immutable_ticket_evidence.json`/CSV: exact 58 frozen primary/shadow decisions, books, rules, residuals, source pointers and checks.
- `immutable_candidate_replay.json`: all 1,070 recorded candidate-side replays, never retroactive tracker fills.
- `all_ticket_official_refresh.json` plus its raw-response folder: new official checks on all 58 tickets.
- `standalone_totals_review.json`/CSV plus raw ESPN/Kalshi responses: all eight separate research rows.
- `historical-evaluation/`: paired score evaluation, calibration residuals and exact summary.
- `challenger-independent-review.json`, `challenger-independent-probe-results.json`, `policy-fix.json`: review/fix evidence.
- `forward-captures/`: unchanged first observation and later final-code smoke.

**Honest conclusion:** the repaired system has stronger evidence, abstention and validation controls. It does not yet have a validated better predictor or established profitable edge. That distinction is the central correction—not a disclaimer to hide behind.
