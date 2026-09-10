# HEALTH_CARE — KPI Anomaly, Audit & Forecast Report

Generated 2026-09-10 by `snowflake-kpi-anomaly-detector` (run manually in-session — the custom subagent isn't registered as an invokable type yet; executed by hand against the same instructions). Reads `reports/HEALTH_CARE/kpi_manifest.json` (generated_at 2026-09-10T02:10, well under the 7-day staleness bar). 13 KPIs, native grain = week, 90-day lookback anchored per-table to that table's own `MAX(date_column)`.

## 1. Executive summary

- **`fact_claim_payment.count_star` is critical and getting worse** — weekly payment volume has fallen ~66% (307→88) since late June, and the last full week sits just past the critical fence. This is this database's top item.
- That decline **reverses a 6-year growth trend**, not a reversion to normal — monthly and yearly views of the same table both show real, positive growth across 2020–2026. See §3.
- **Denial rate is quietly rising year-over-year** (statistically real, not seasonal) even though it looks perfectly flat week-to-week and month-to-month. Nothing here trips an alert today, but it's the kind of drift that matters before it does.
- **Claims and encounters reconcile cleanly overall** — header totals match summed line totals for 97.9% of claims — but 2,103 claims (2.1%) don't, including one $108,712 single-claim discrepancy worth a manual look.
- **Data freshness varies sharply by table**: only `FACT_CLAIM_PAYMENT` has current data (9 days old); the four other core tables are 69–72 days stale. Read every "current" reading below with that in mind — most of this report describes late June/early July, not today.
- Every other KPI (claim/line/encounter volume, dollar amounts, pharmacy activity) is stable-to-mildly-growing and unremarkable this run.

## 2. Alerting board

Every row shows its `why` and `confidence` alongside the label — a verdict without a stated reason isn't a finished classification.

| Verdict | KPI | Value | Band | Confidence | Why |
|---|---|---|---|---|---|
| **CRITICAL** | `fact_claim_payment.count_star` | 88 | crit_lower 89.56 | **high** | Last full-week value sits at/past the critical fence; native trend strongly real and falling (r²=0.70); month/year grain both show real growth (r²=0.45/0.37) — a reversal, not noise. High confidence because the source table is fresh (9d stale) with 13 well-populated buckets. |
| WARN | `pharmacy_claim.count_star` | 592 | warn_upper 589.64 | medium | Just past warn_upper (z≈3.23); native trend real (r²=0.20), month-grain stronger (r²=0.62) — a genuine if mild uptrend. Medium confidence: source table is 69 days stale. |
| watch (falling, inside band) | `fact_claim_payment.sum_paid_amount` | 187,039.29 | warn band [0, 497,459] | **high** | Native trend real and falling (r²=0.39) tracking the critical KPI above; month/year grain show real growth (r²=0.54/0.60) — same reversal pattern. |
| stable | 9 of the remaining 10 KPIs | — inside warn — | — | medium | Source tables (`MEDICAL_CLAIM_HEADER`, `MEDICAL_CLAIM_LINE`, `FACT_ENCOUNTER`, `PHARMACY_CLAIM`) are 69–72 days stale — capped at `medium` regardless of how clean the native-grain numbers look, since "current" here means late June/early July. Per-KPI `why` text is in `KPI_CURRENT_STATE`. |
| stable, low signal | `fact_encounter.avg_length_of_stay_days` | 0.0692 | inside warn | medium | No real trend at any tested grain (native r²=0.04, month r²=0.006, year r²=0.10) — the "stable" label here means "no signal detected," not "confirmed steady." Likely diluted by non-inpatient zero-LOS rows. |

**Freshness call-out** (unconditional, from Phase 0):

| Table | Days stale | Status |
|---|---|---|
| `MEDICAL_CLAIM_HEADER` | 72 | Stale |
| `MEDICAL_CLAIM_LINE` | 72 | Stale |
| `FACT_ENCOUNTER` | 72 | Stale |
| `PHARMACY_CLAIM` | 69 | Stale |
| `FACT_CLAIM_PAYMENT` | 9 | Fresh |

**Error & quality rates call-out** (unconditional, from `kpi_class = error_rate`): `medical_claim_header.avg_is_denied` — currently stable/inside-warn at native grain, listed here regardless per its class. See §3 for the year-over-year finding.

## 3. Forecasts

Default method: trend-projected band (native-grain slope ± 1.4826×MAD), 4 buckets (weeks) ahead. Almost every KPI qualifies for `recommend_ml_forecast` given how strong the underlying monthly trends turned out to be — that's a real finding on its own, not a formality.

Forecast confidence is capped by native-grain fit, not just inherited from baseline confidence: `r² < 0.1` at native grain caps it `low` regardless of how strong a longer-grain trend is (the projection itself is native-grain), `r² >= 0.3` with `high` baseline confidence allows `high`, everything else lands `medium`.

| KPI | Forecast (next week) | Band | Forecast confidence | Method flag |
|---|---|---|---|---|
| `medical_claim_header.count_star` | 419 | [395, 443] | low | recommend_ml_forecast |
| `medical_claim_header.sum_total_billed_amount` | 827,903 | [657,257, 998,547] | medium | recommend_ml_forecast |
| `medical_claim_header.sum_total_allowed_amount` | 350,414 | [304,230, 396,598] | low | recommend_ml_forecast |
| `medical_claim_header.sum_total_plan_paid_amount` | 303,322 | [270,889, 335,755] | low | recommend_ml_forecast |
| `medical_claim_header.avg_is_denied` | 0.1390 | [0.1183, 0.1598] | low | recommend_ml_forecast |
| `medical_claim_line.count_star` | 1,131 | [1,021, 1,240] | low | recommend_ml_forecast |
| `medical_claim_line.sum_plan_paid_amount` | 305,022 | [267,025, 343,019] | low | recommend_ml_forecast |
| `fact_encounter.count_star` | 319 | [308, 330] | low | recommend_ml_forecast |
| `fact_encounter.avg_length_of_stay_days` | 0.0725 | [0.0407, 0.1043] | low | trend_band (no grain shows real signal, r²<0.1 everywhere) |
| `fact_claim_payment.sum_paid_amount` | 166,030 | [80,501, 251,559] | **high** | recommend_ml_forecast |
| `fact_claim_payment.count_star` | 68.7 | [18.3, 119.2] | **high** | recommend_ml_forecast |
| `pharmacy_claim.count_star` | 595 | [585, 605] | medium | recommend_ml_forecast |
| `pharmacy_claim.sum_plan_paid_amount` | 92,418 | [75,484, 109,352] | low | recommend_ml_forecast |

Note the apparent paradox on the two `fact_claim_payment` rows: **high forecast confidence does not mean "trust this number,"** it means "the trend behind this projection is real and well-supported by the data" — which is exactly why the very next paragraph says to be careful with it. High confidence in a well-fit trend and low confidence in what that trend implies going forward are two different questions.

**Read `fact_claim_payment.count_star`'s forecast with real caution**: a straight-line projection of a native-grain trend that itself contradicts the long-run trend (§4) is exactly the situation where a naive trend-band forecast is least trustworthy — it's mechanically projecting the recent decline further down (68.7 next week) without knowing whether that decline continues, bottoms out, or reverts toward the historical growth pattern. This is the single best candidate in this database for an actual `SNOWFLAKE.ML.FORECAST` model rather than the default band.

## 4. Audit & reconciliation

**Cross-table reconciliation** — `medical_claim_header.sum_total_plan_paid_amount` vs. `SUM(medical_claim_line.plan_paid_amount)`, joined on `CLAIM_ID` (manifest correlation r=0.9998, n_overlap=14 — passes the ≥8-bucket validity gate comfortably, so this correlation is trusted evidence, not just a high number):

- 99,271 claims checked, 2,103 mismatched (**2.12% mismatch rate**), worst single-claim discrepancy **$108,712.14**.
- Read as: the two tables reconcile cleanly for the large majority of claims. The 2.1% that don't, and especially the $108K outlier, are worth a manual reconciliation pass — this could be adjustment/COB claims that legitimately differ, or a real data issue; this report can't distinguish the two without looking at the specific claims.

**Duplicate signal** (`IS_DUPLICATE_FLAG`):

| Table | Duplicate rate |
|---|---|
| `MEDICAL_CLAIM_HEADER` | 0.45% (444 / 99,271) |
| `MEMBER_ELIGIBILITY` | 0.39% (56 / 14,271) |

Both low. Not a driver of the volume/dollar KPIs on these tables this run.

**Key completeness**: `CLAIM_ID` and `MEMBER_ID` on `MEDICAL_CLAIM_HEADER` — 0 nulls out of 99,271 rows. Clean.

## 5. Attribution hypotheses

Wider net than just critical/warn KPIs this run — every KPI below `high` confidence, tagged `error_rate`, or showing a multi-grain divergence gets a hypothesis, evidence-strength tagged (`strong`/`moderate`/`weak`), never left blank.

**`fact_claim_payment.count_star` (critical, falling) — evidence: weak on cause, strong on the decline itself.** The decline is itself strongly evidenced (§2/§3: high confidence, r²=0.70, fresh data). *Why it's declining* is the open question: with only 4 weeks of overlap between `FACT_CLAIM_PAYMENT`'s data horizon (through 2026-09-01) and `MEDICAL_CLAIM_HEADER`'s (through 2026-06-30), the correlation between them (r=0.24, n_overlap=4) **fails the validity gate** (< 8 buckets) — this is explicitly *not* usable evidence, regardless of what the r-value alone might suggest. Two hypotheses remain, both weak-evidence / unconfirmed: (a) claims submission itself slowed after the June cutoff, which would only show up in payments after the usual submission-to-payment lag; (b) something specific to payment processing slowed independent of claim volume. The Audit findings in §4 don't point at either directly — the header/line reconciliation and duplicate checks are clean (strong evidence against a claims-side data-quality artifact, at least). Worth checking `AUDIT_LOAD_LOG`/`DQ_RULE_RESULT` next; not examined this pass — the honest answer here is "no strong explanation found in the manifest; investigate outside this run," not a manufactured cause.

**`medical_claim_header.sum_total_billed_amount` (historical spike, 2026-05-04) — evidence: moderate.** Same-week claim/line volume was normal (z≈2.0–2.3) while dollar amounts and average LOS both spiked sharply (z 4–13) — consistent with a handful of unusually high-cost claims, not a volume surge or data issue. The audit reconciliation (§4) doesn't flag this specific week (moderate supporting evidence against a data-quality explanation — moderate, not strong, because the reconciliation check wasn't run bucket-by-bucket, only in aggregate).

**`medical_claim_header.avg_is_denied` (year-over-year creep) — evidence: strong on the trend, weak on cause.** Year-grain trend is real (r²=0.83) and confirmed non-seasonal (month-of-year check found no cyclical pattern, ranging only 11.0–12.5% across all 12 months) — strong evidence this is a genuine secular drift, not noise or seasonality. *Why* it's rising isn't addressed by anything in the manifest — no correlated KPI or usage signal points at a cause. Honest answer: real, confirmed trend; unknown driver.

## 6. Data quality & confidence

This section exists to answer "how sure are we this is even right" directly, rather than leaving it scattered across other sections.

| KPI | Confidence | Why not higher (if applicable) |
|---|---|---|
| `fact_claim_payment.sum_paid_amount` | **high** | — fresh table (9d stale), 13 buckets, real trend fit |
| `fact_claim_payment.count_star` | **high** | — fresh table (9d stale), 13 buckets, strongest trend fit in the database |
| all other 11 KPIs | medium | Source table stale 69–72 days vs. the 14-day threshold — every reading described elsewhere in this report reflects late June/early July, not today, regardless of how clean the underlying numbers are |

No KPI this run landed at `low` confidence or failed validation (`validated = true` for all 13 — every `series_sql` returned usable, non-null aggregates). Full per-KPI distribution stats (mean/median/stddev/MAD/min/max/CV), month/year trend figures, and `validation_notes` are in `HEALTH_CARE.ANALYTICS.KPI_BASELINE` (this run's `run_ts`).

Threshold method for every KPI this run: robust z (median ± k×1.4826×MAD, k=3 warn / 3.5 crit) — no KPI's native-grain `|r2|` reached the 0.3 bar that would switch its band to EWMA, though `fact_claim_payment.count_star` (r²=0.70) and `.sum_paid_amount` (r²=0.39) are flagged in `KPI_CURRENT_STATE` as better suited to EWMA than the static bounds shown in §2 — thresholds built on `medium`-confidence baselines (the 11 stale-table KPIs) should be treated as provisional in the same way their confidence tier implies. All directionality calls (`both`/`high_bad`/`low_bad`) are inferences from column semantics, not confirmed — see `KPI_CURRENT_STATE.directionality`, and confirm with the business owner before wiring alerts to act on the low/high side asymmetrically.

## 7. Emitted artifacts

**Metric batch configs** (top 5 by severity/priority, not all 13 — ask if you want the remaining 8):
- `metrics/fact_claim_payment_count/{.sql,.yaml}`
- `metrics/fact_claim_payment_paid_amount/{.sql,.yaml}`
- `metrics/pharmacy_claim_count/{.sql,.yaml}`
- `metrics/medical_claim_denial_rate/{.sql,.yaml}`
- `metrics/medical_claim_billed_amount/{.sql,.yaml}`

**For viewing**: `HEALTH_CARE.ANALYTICS.KPI_CURRENT_STATE` refreshed for this run's `run_ts` — 13 rows, one per KPI, carrying current value, state, thresholds, directionality, forecast, audit status, and `relevant_for` tags. Point any BI tool at this table for a live current-state dashboard; it's additive across runs (never overwritten), so it also supports a "how has this KPI's classification changed over time" view for free.

## 8. Caveats

- **Manual, abbreviated run** — same as the profiler's caveat: no registered subagent yet, executed by hand, covering the same 13 KPIs the profiler shortlisted rather than a fully independent rediscovery.
- **`ACCOUNT_USAGE` latency/retention**: up to ~3hr latency, ~365-day retention (inherited from the manifest).
- **Seasonality claims are thin**: `month_of_year_seasonality_sql` was executed for one KPI only (`avg_is_denied`); the other 12 KPIs' seasonality strings are pattern-validated but unrun this pass.
- **Forecast confidence is uneven** — see the `forecast_confidence` column in §3: `fact_encounter.avg_length_of_stay_days`'s forecast is close to meaningless (no grain shows `r² > 0.1`) while `fact_claim_payment.count_star`'s `high`-confidence forecast is actively misleading if read as "trust this number" rather than "this is where a well-fit trend line points, which is exactly why an ML model is recommended instead of a straight-line extrapolation." Don't present all 13 forecasts with equal weight in any downstream use of this data.
- **Audit reconciliation is aggregate-only**: the 2.1% mismatch rate and $108,712 worst-diff are database-wide over the full claim history, not scoped to the 90-day lookback — a bucket-by-bucket reconciliation (to check whether mismatches cluster around specific weeks, e.g. the 2026-05-04 spike) wasn't run this pass.
- **`relevant_for` tagging is a first pass** — it follows the rule in the agent's Phase 4 mechanically (default set + audit/alerting triggers) and hasn't been reviewed by a business owner for whether it matches how these KPIs actually get used.
