# Proactive Risk Brief — HEALTH_CARE

Generated 2026-09-16 by `snowflake-risk-predictor` (incremental run #2). 4 issues need attention today.

## 1. Replacement claims are taking much longer to get paid — Medium impact

Claims that are replacements or corrections to a previous claim are taking substantially longer to get paid than typical claims — about 34% of replacement claims currently in the pipeline are at risk of a slow payment, compared to about 11% of claims overall. Every claim flagged for payment-delay risk this pass was a replacement claim, most concentrated among imaging and diagnostic-imaging providers. This is consistent with replacement claims re-entering a review process that runs longer than a standard first-time claim.

**Estimated exposure**: approximately $110,700 in submitted charges may be affected if the pattern continues.
**Affected**: 45 claims, concentrated among imaging and diagnostic-imaging providers.
**What to check first**: Check whether replacement claims are routed through the same review queue as standard claims, or whether a dedicated fast-path for corrections would help.

## 2. Resubmitted claims are much more likely to be denied again — High impact

Claims that have already been resubmitted once are far more likely to be denied a second time — about 55% of resubmitted claims currently in the pipeline are at elevated risk, compared to roughly 10% of claims overall. This pattern is concentrated among specialist, lab, and imaging providers. A claim resubmission usually means something was wrong the first time, and the underlying issue often isn't being fully fixed before it goes back out.

**Estimated exposure**: approximately $57,700 in submitted charges may be affected if the pattern continues.
**Affected**: 33 claims, concentrated among specialist, laboratory, and imaging providers.
**What to check first**: Review these 33 claims before they go back out, prioritizing specialist/lab/imaging providers where the pattern is strongest — check whether the original denial reason was actually corrected before resubmission, rather than resubmitting as-is.

## 3. Individual-market members and a cluster of employer groups are lapsing coverage at well above the average rate — Medium impact

Members enrolled through the individual market — people who bought coverage on their own rather than through an employer — stop renewing their coverage at roughly one-and-a-half times the rate of the overall member population (about 10% versus 7%). A smaller cluster of 6 specific employer groups shows an even sharper pattern: members in those groups lapse coverage at nearly double the average rate. This is a real, repeatable pattern found directly in several years of enrollment history, and it shows up again independently when looking at which currently-enrolled members carry the same risk characteristics.

**Important caveat on this one**: unlike the other findings in this brief, we could not build a reliable score that ranks *individual* members by risk — the underlying pattern is real at the segment level (individual-market book, these 6 groups), but a model that tries to say "this specific person is at risk" is not trustworthy yet. Treat this as "these segments deserve a closer look," not "here is a precise list of who will leave."

**Estimated exposure**: approximately $3.79 million in annualized premium is tied to the 361 currently-active members in the flagged segments (250 in the individual-market book, 111 across the 6 flagged groups) — again, this is exposure if the historical pattern continues, not money already lost.
**Affected**: 361 currently-active members across the individual-market segment and 6 employer groups (GRP00069, GRP00073, GRP00075, GRP00084, GRP00042, GRP00102).
**What to check first**: Review renewal outreach, pricing, and service experience for the individual-market book and these 6 groups specifically. This needs a closer look with better data (payment history, member engagement/contact signals) before a per-member action list can be trusted — no single fix is obvious from the data alone yet.

## 4. A couple of drug classes are rejecting more often at the pharmacy counter — Low impact

A small but consistent slice of prescriptions for diuretics (blood-pressure/fluid medications) and SNRIs (a class of antidepressants) are rejecting at the pharmacy counter noticeably more than typical — roughly 2.7 times the usual rate for both drug classes. The dollar amounts involved are small per prescription, but the pattern is real: a rejected prescription is a member who doesn't get their medication that day, which matters more than the dollar figure suggests.

**Estimated exposure**: approximately $2,700 in billed amounts — small in dollar terms, but worth a look for member-experience reasons.
**Affected**: 118 prescriptions across the two drug classes, out of the last 60 days of pharmacy fills.
**What to check first**: Check whether a recent formulary or prior-authorization change affected diuretics or SNRIs specifically. This is a thin, early signal — treat it as something to watch, not yet act on aggressively.

---

# Technical Detail (Data Team Reference)

*Everything below is the modeling record behind the brief above — for whoever maintains this pipeline or wants to verify a number. A business reader doesn't need anything past this point.*

## This run (incremental #2, 2026-09-16)

Triggered by `snowflake-data-profiler` pass 9 (2026-09-16) newly profiling `FACT_PREMIUM`, `FACT_MEMBER_MONTH`, and 5 `MART_*` tables. Full discovery scan re-run fresh as always. Findings:

- **Re-verified, not retrained**: `denial_risk`, `payment_delay_risk`, `pharmacy_reject_risk`. `MEDICAL_CLAIM_HEADER` row count is byte-identical to the prior run (99,271); the open-claim scoring population is the exact same 401 claims (`SUBMITTED` 110 + `PENDED` 57 + `ADJUDICATED` 234); `PHARMACY_CLAIM` fill-date range and volume are unchanged. All 3 models are 2 days old, well inside the 7-day freshness window. Rescored (Phase 5 onward only) — flagged sets, rates, and exposure dollars came back byte-identical to the prior run (verified line-by-line, not assumed).
- **New candidate, modeled**: `coverage_lapse_risk` (see Target 4 below) — found via `MEMBER_ELIGIBILITY`, not the newly-profiled tables directly, but discovered while specifically investigating the enrollment domain those tables sit in.
- **New candidates, checked and rejected**: premium non-payment risk (`FACT_PREMIUM.TRANSACTION_STATUS` is constant — no non-payment concept exists in this schema) and member-month/premium mismatch (`FACT_MEMBER_MONTH` has no outcome-shaped column). Full reasoning in `reports/HEALTH_CARE/risk_manifest.json`'s `skipped` list.
- **Re-checked, still skipped**: the previously-skipped underpayment-vs-contracted-rate candidate was specifically re-evaluated against `FACT_PREMIUM` per this run's instructions — `FACT_PREMIUM` is a premium-billing table structurally unrelated to claim adjudication and does not change that calculus.
- **Deferred, not rejected**: a future-year high-cost-member prediction using `MART_MEMBER_YEAR_SUMMARY.IS_HIGH_COST_FLAG` with trailing-year features is a real, plausible target but needs a cross-year join pattern not attempted this run.

## Target 1 — `denial_risk`

- **Table**: `MEDICAL_CLAIM_HEADER`. **Prediction point**: `SUBMISSION_DATE`. **Target**: `DENIAL_REASON_CODE IS NOT NULL`.
- **Training data**: 15,000 most-recent claims by submission date, 12.32% positive.
- **Held-out metrics**: ROC-AUC 0.689, PR-AUC 0.229 (baseline 0.126), Brier 0.105. Well under the 0.95 leakage threshold.
- **Leakage check**: `IS_ELIGIBILITY_VALID_FLAG` was included as a feature and specifically checked for leakage per the run instructions — it did not dominate feature importance (outside the top 10) and the overall AUC stayed moderate, so it was kept.
- **Top features**: `risk_score` (490), `total_billed_amount` (481), `provider_trailing_denial_rate` (418, a point-in-time trailing feature — confirms this feature class is genuinely predictive), `primary_specialty` (150), `chronic_condition_count` (111).
- **Leakage columns excluded**: `ADJUDICATION_DATE`, `PAYMENT_DATE`, `CLAIM_STATUS`, `DENIAL_REASON_CODE`, `TOTAL_ALLOWED_AMOUNT`, `TOTAL_PLAN_PAID_AMOUNT`, `TOTAL_MEMBER_RESPONSIBILITY_AMOUNT`, `DEDUCTIBLE_AMOUNT`, `COPAY_AMOUNT`, `COINSURANCE_AMOUNT`, `COB_PRIMARY_PAID_AMOUNT`.
- **Scoring population**: 401 claims with `CLAIM_STATUS IN ('ADJUDICATED','SUBMITTED','PENDED')` — reconfirmed unchanged this run.
- **Threshold**: top decile by score (cutoff 0.269). 41 of 401 flagged (10.2%).
- **Full concentration table** (categorical columns with ≥20 total claims in-segment, sorted by lift):

  | Segment | Flagged/Total | Rate | Lift |
  |---|---|---|---|
  | `claim_type = RESUBMISSION` | 33/60 | 55.0% | **5.38x** |
  | `provider_type = IMAGING` | 5/31 | 16.1% | 1.58x |
  | `primary_specialty = Diagnostic Imaging Center` | 5/31 | 16.1% | 1.58x |
  | `provider_type = SPECIALIST` | 14/95 | 14.7% | 1.44x |
  | `claim_category = OUTPATIENT_SURGERY` | 4/27 | 14.8% | 1.45x |
  | `utilization_cohort = HIGH_COST` | 15/110 | 13.6% | 1.33x |
  | `claim_category = LAB` | 10/72 | 13.9% | 1.36x |
  | `primary_segment = MEDICARE` | 19/149 | 12.8% | 1.25x |

  `RESUBMISSION` is the dominant, headline pattern by a wide margin — every other segment is a modest 1.2–1.6x lift.

## Target 2 — `payment_delay_risk`

- **Table**: `MEDICAL_CLAIM_HEADER`, scoped to `WHERE DENIAL_REASON_CODE IS NULL AND PAYMENT_DATE IS NOT NULL` for training. **Prediction point**: `SUBMISSION_DATE`. **Target**: `DATEDIFF(day, SUBMISSION_DATE, PAYMENT_DATE) > 44` — 44 days is the real, computed 80th percentile of the historical submission-to-payment gap (`PERCENTILE_CONT(0.8)`), not an assumed number.
- **Training data**: 15,000 most-recent resolved+paid claims, 15.87% positive.
- **Held-out metrics**: ROC-AUC 0.568 (weak — overall ranking is noisy), PR-AUC 0.245 (baseline 0.128), Brier 0.107.
- **Top features**: `risk_score` (70), `provider_trailing_slow_rate` (58), `total_billed_amount` (56), `primary_specialty` (15), `line_count` (12).
- **Leakage columns excluded**: same list as `denial_risk` (all adjudication/payment-time fields).
- **Scoring population**: same 401 open claims as `denial_risk` — reconfirmed unchanged this run.
- **Threshold**: top decile by score (cutoff at the 90th percentile). 45 of 401 flagged (11.2%).
- **Full concentration table**:

  | Segment | Flagged/Total | Rate | Lift |
  |---|---|---|---|
  | `claim_type = REPLACEMENT` | 45/131 | 34.4% | **3.06x** |
  | `utilization_cohort = CATASTROPHIC` | 12/40 | 30.0% | 2.67x |
  | `claim_category = OUTPATIENT_SURGERY` | 7/27 | 25.9% | 2.31x |
  | `provider_type = IMAGING` | 8/31 | 25.8% | 2.30x |
  | `procedure_category = SURGERY` | 9/37 | 24.3% | 2.17x |
  | `claim_category = IMAGING` | 5/22 | 22.7% | 2.03x |

  `REPLACEMENT` is the headline: **100% of all 45 flagged claims this run were replacement-type claims** — a remarkably clean split given the model's own overall ranking quality (ROC-AUC 0.568) is otherwise weak. Read this as: the model doesn't rank most claims well, but it's caught this one real, strong effect cleanly.

## Target 3 — `pharmacy_reject_risk`

- **Table**: `PHARMACY_CLAIM`. **Prediction point**: `FILL_DATE`. **Target**: `REJECT_REASON_CODE IS NOT NULL`.
- **Training data**: 30,000 most-recent pharmacy claims (larger sample than the other two targets, needed given the rare outcome), 0.83% positive (250 of 30,000).
- **Held-out metrics**: ROC-AUC 0.568, **PR-AUC 0.0096** vs. a 0.0065 baseline — trust PR-AUC over ROC-AUC here per `train.py`'s own guidance for rare outcomes; this is a genuinely thin signal, the weakest of the original three models.
- **Top features**: `billed_amount` (857), `pharmacy_trailing_reject_rate` (493), `refill_number` (285), `class_trailing_reject_rate` (181), `quantity_dispensed` (147).
- **Leakage columns excluded**: `PAID_DATE`, `CLAIM_STATUS`, `IS_REVERSAL_FLAG`, `ALLOWED_AMOUNT`, `PLAN_PAID_AMOUNT`, `MEMBER_RESPONSIBILITY_AMOUNT`, `REJECT_REASON_CODE`.
- **Scoring population**: no genuine "pending" status exists for pharmacy claims (`CLAIM_STATUS` is only `REJECTED`/`PAID`/`REVERSED`/`REVERSAL_TRANSACTION` — adjudication is effectively real-time) — used the most recent 60 days of fills (4,695 claims) as the "current" monitoring population, per the spec's fallback for immediately-resolved outcomes. Reconfirmed unchanged this run (same fill-date range, same row count).
- **Threshold**: top decile by score. 470 of 4,695 flagged (10.0%).
- **Full concentration table** (`therapeutic_class`, ≥20 claims in-segment):

  | Segment | Flagged/Total | Rate | Lift |
  |---|---|---|---|
  | `BIOLOGIC IMMUNOMODULATORS` | 10/33 | 30.3% | 3.03x |
  | `DIURETICS` | 72/266 | 27.1% | **2.70x** |
  | `SNRI` | 46/171 | 26.9% | 2.69x |
  | `ACE INHIBITORS` | 16/77 | 20.8% | 2.08x |

  `DIURETICS` was chosen as the headline over `BIOLOGIC IMMUNOMODULATORS` (marginally higher lift, 3.03x) because it carries far more volume and flagged count (266/72 vs. 33/10) — a more reliable concentration, not just a small-sample artifact. `SNRI` folded into the same brief line as a second, comparably-sized pattern.

## Target 4 — `coverage_lapse_risk` (new this run)

- **Table**: `MEMBER_ELIGIBILITY`. **Prediction point**: `EFFECTIVE_DATE` (start of the coverage segment). **Target**: no follow-on eligibility segment exists for the member after this segment's `TERMINATION_DATE` — i.e., the coverage genuinely ends rather than rolling into a renewal, plan change, or group change.
- Discovered while investigating the enrollment/premium domain the profiler's newest pass (`FACT_PREMIUM`, `FACT_MEMBER_MONTH`) newly covered — the outcome itself lives on `MEMBER_ELIGIBILITY`, which was already known to the profiler but had not previously been examined by this agent as a prediction target.
- **Training data**: 12,043 terminated eligibility segments with `TERMINATION_DATE` at least 180 days in the past (to avoid right-censoring — a termination from last month hasn't had enough time for a real renewal record to show up yet). 6.71% positive (808 of 12,043).
- **Held-out metrics**: ROC-AUC 0.509, PR-AUC 0.085 (baseline 0.082), Brier 0.077. **This model's row-level ranking is barely better than random** — at an 80%-recall threshold on the held-out test set, the cutoff falls to essentially 0, meaning the model would need to flag the entire population to catch most real lapses. This does not meet the bar for a per-member risk score and is flagged accordingly in the brief.
- **Top features**: `AGE_AT_EFFECTIVE` (350), `GROUP_ID` (133), `VERSION_NUMBER` (110), `SIC_INDUSTRY_CODE` (74), `PLAN_ID` (65), `RESIDENCE_STATE` (63), `ELIGIBLE_LIVES` (62).
- **Leakage columns excluded**: `TERMINATION_DATE`, `COVERAGE_MONTHS_COUNT` (directly derived from the outcome — it IS the segment length), `IS_CURRENT_FLAG` (structurally target-adjacent: false for every training row, true for every scoring row), `IS_DUPLICATE_FLAG`, `RECORD_CREATED_DATE`, `RECORD_UPDATED_DATE` (ambiguous timing relative to `EFFECTIVE_DATE`, excluded per the "ambiguous → treat as leakage" rule).
- **Scoring population**: 1,978 currently-active eligibility segments (`IS_CURRENT_FLAG = TRUE`).
- **Why this made the brief despite the weak model**: a segment-level concentration computed directly from historical rates (independent of the model's score) is real and reproducible — `GROUP_TIER = INDIVIDUAL` lapses at 10.4% vs. 6.7% overall (n=1,647). A cluster of 6 employer groups lapses at 12.1–15.4% (n=49–157 each). This same concentration shows up independently in which currently-active members the weak model still ranks highest — 44% of its top-decile flags (87 of 198) are `GROUP_TIER = INDIVIDUAL`, versus only 12.6% of the active population (250 of 1,978) — two independent views agreeing is the basis for including this, with an explicit confidence caveat rather than a confident per-member list.
- **Full concentration table** (historical rate by segment, ≥20 rows, sorted by rate):

  | Segment | Rate | Overall | Lift | n |
  |---|---|---|---|---|
  | `GROUP_ID = GRP00069` | 15.4% | 6.7% | 2.30x | 123 |
  | `GROUP_ID = GRP00102` | 14.5% | 6.7% | 2.17x | 117 |
  | `PLAN_ID = PLN0506` | 14.3% | 6.7% | 2.13x | 56 |
  | `GROUP_ID = GRP00005` | 14.3% | 6.7% | 2.13x | 49 |
  | `GROUP_ID = GRP00075` | 13.9% | 6.7% | 2.07x | 144 |
  | `CHANGE_REASON = PRODUCT_CHANGE_TO_INDIVIDUAL` | 12.5% | 6.7% | 1.86x | 72 |
  | `GROUP_ID = GRP00084` | 12.1% | 6.7% | 1.80x | 157 |
  | `GROUP_TIER = INDIVIDUAL` | 10.4% | 6.7% | 1.55x | 1,647 |
  | `PLAN_TYPE = EPO` | 8.7% | 6.7% | 1.30x | 2,564 |

  `GROUP_TIER = INDIVIDUAL` was chosen as the primary headline over the individual `GROUP_ID`s because of its volume (1,647 historical rows / 250 currently-active members vs. 49–157 each) — the specific-group pattern is folded in as the secondary, sharper-lift finding.
- **Exposure basis**: latest known monthly `BILLED_PREMIUM_AMOUNT` per currently-active member (from `FACT_PREMIUM`, most recent `COVERAGE_MONTH`), annualized (×12) and summed across the 361 flagged currently-active members (250 individual-market + 111 across the 6 flagged groups). Individual-market alone: $2,736,528/yr across 250 members. The 6 groups: $1,053,331/yr across 111 members. Combined: $3,789,860/yr.

## Emitted artifacts

- `HEALTH_CARE.ANALYTICS.RISK_SIGNALS` — 4 new rows this `run_ts` (3 re-verified targets + 1 new target), additive on top of the 3 rows from the prior run.
- `ml/models/{denial_risk,payment_delay_risk,pharmacy_reject_risk,coverage_lapse_risk}.joblib` + matching `_card.json` sidecars.
- `ml/configs/{denial_risk,payment_delay_risk,pharmacy_reject_risk,coverage_lapse_risk}.json`.
- `ml/data/*_training.csv`, `ml/data/*_current.csv`, `ml/scores/*_scored.csv` (including new `coverage_lapse_risk_training.csv`/`_current.csv`/`_scored.csv`).
- `reports/HEALTH_CARE/risk_manifest.json` (updated incrementally — full changelog in its `discovery_note`).

## Caveats

- Training extracts for the 3 original targets were capped (15,000–30,000 rows, most recent by date) rather than pulling full history (99K/137K rows), to keep query-result sizes practical for this session — a future run with more compute budget could use the full history for a materially better model, especially for `pharmacy_reject_risk` given its rare outcome. `coverage_lapse_risk` used its full available history (12,043 rows — the entire eligible training population, no cap needed).
- Thresholds are top-decile-by-score for the 3 claim/pharmacy targets, a data-driven default, not a business-specified cost ratio — if the claims team has a real cost ratio in mind, the threshold should be revisited. `coverage_lapse_risk` deliberately does NOT use a score-based threshold for its headline finding, for the reasons above.
- `payment_delay_risk`'s overall ranking quality (ROC-AUC 0.568) is weak — only the specific `REPLACEMENT` concentration is a strong, trustworthy finding; the model's score for an arbitrary individual claim outside that pattern should be treated with real skepticism.
- `pharmacy_reject_risk` is thin (0.83% positive rate, PR-AUC barely above baseline) — treat its finding as an early signal, not a confirmed pattern, until more rejected-prescription history accumulates.
- `coverage_lapse_risk` is the weakest model in this manifest by row-level ranking quality (ROC-AUC 0.509) — it is kept in the brief only because the segment-level pattern is independently reproducible two different ways, not because the model itself is trustworthy at the individual level. A future pass should try richer point-in-time features (payment/contact history, prior claim activity) before trusting a per-member list from this target.
- `snowflake-kpi-analyst`'s spec should be checked/updated to confirm it knows `RISK_SIGNALS` exists and can be queried for follow-up questions — not verified as part of this run.
