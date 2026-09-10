# HEALTH_CARE — Data Profile & KPI Report

Generated 2026-09-10 by `snowflake-data-profiler` (run manually in-session; see Caveats). Target database: `HEALTH_CARE`. Lookback: 90 days, anchored per-table to that table's own `MAX(date_column)` rather than wall-clock `CURRENT_TIMESTAMP()` — see Caveats for why.

**Rerun note**: this report and `kpi_manifest.json` were regenerated after the manifest schema gained five new per-KPI fields (`freshness_sql`, `history_span_sql`, `monthly_trend_sql`, `yearly_trend_sql`, `month_of_year_seasonality_sql`) so `snowflake-kpi-anomaly-detector` can run its freshness and multi-grain checks without reconstructing SQL itself. All five were captured for every KPI; four of the five were executed to validate correctness and surface real values (see sections below) — `month_of_year_seasonality_sql` was spot-checked on one KPI only (denial rate) to control cost, and the rest are pattern-validated but unexecuted this pass. Two genuinely new findings came out of this: **table freshness varies sharply by table** (below), and **one KPI's short-term trend directly contradicts its long-term trend** (Standout finding 3).

## 1. Inventory summary

`HEALTH_CARE` has 2 non-system schemas: `MAIN` (37 tables, all real content) and `PUBLIC` (empty). It's a standard payer-style claims warehouse:

- **Dimensions**: `DIM_MEMBER` (3,000), `DIM_PROVIDER` (3,079), `DIM_PROVIDER_LOCATION` (5,148), `DIM_PLAN`, `DIM_PRODUCT`, `DIM_NETWORK`, `DIM_MEMBER_GROUP`, `DIM_BENEFIT_STRUCTURE`, `BRIDGE_PROVIDER_NETWORK` (11,282)
- **Core transactional facts**: `MEDICAL_CLAIM_HEADER` (99,271 rows), `MEDICAL_CLAIM_LINE` (281,394), `FACT_CLAIM_DIAGNOSIS` (221,428), `FACT_CLAIM_PAYMENT` (76,147), `FACT_ENCOUNTER` (78,566), `PHARMACY_CLAIM` (137,410), `FACT_PREMIUM` (139,579), `FACT_MEMBER_MONTH` (137,652), `MEMBER_ELIGIBILITY` (14,271)
- **Marts (pre-aggregated, annual/monthly grain)**: `MART_MEMBER_YEAR_SUMMARY`, `MART_PROVIDER_YEAR_SUMMARY`, `MART_PHARMACY_CLASS_YEAR`, `MART_PMPM_PLAN_MONTH`, `MART_UTILIZATION_PER_1000`
- **Reference/lookup**: `REF_CLAIM_STATUS`, `REF_DATE`, `REF_DENIAL_REASON`, `REF_DIAGNOSIS`, `REF_DRUG`, `REF_PLACE_OF_SERVICE`, `REF_PROCEDURE`, `REF_SOURCE_SYSTEM`
- **Operational/audit**: `AUDIT_LOAD_LOG`, `DQ_RULE_RESULT`, `STAGE_FILE_LIST` (load pipeline bookkeeping)

Most of the data volume lives in the claim-line and diagnosis tables (`MEDICAL_CLAIM_LINE` 281k rows, `FACT_CLAIM_DIAGNOSIS` 221k rows). **Notable date-range finding**: the underlying claim/encounter data runs from `2020-01-01` through roughly `2026-06-30`–`2026-09-01` depending on table, while the account's wall-clock "today" is `2026-09-10` — see Caveats.

## 2. Usage heatmap

This is a fresh trial account (created 2026-09-04, data loaded 2026-09-07). `ACCESS_HISTORY`/`QUERY_HISTORY` show essentially **no organic usage** of `HEALTH_CARE` — the only activity in the 90-day window is the initial `COPY INTO` load (33 statements, 2026-09-07) and this profiling session's own exploratory queries. Every table in the KPI shortlist is labeled `cold`; none are "dead" in the sense of having once been used and going quiet — they've simply never been queried by anyone but this session. **Hot/warm/cold labeling and KPI-to-usage correlation aren't meaningful yet** in this account — revisit once there's real query traffic.

**Data freshness** (new this pass, via `freshness_sql`, `staleness_threshold_days = 14`): 4 of the 5 core tables are stale by that default.

| Table | `days_stale` | Status |
|---|---|---|
| `MEDICAL_CLAIM_HEADER` | 72 | **Stale** |
| `MEDICAL_CLAIM_LINE` | 72 | **Stale** |
| `FACT_ENCOUNTER` | 72 | **Stale** |
| `PHARMACY_CLAIM` | 69 | **Stale** |
| `FACT_CLAIM_PAYMENT` | 9 | Fresh |

`FACT_CLAIM_PAYMENT` is the only table still receiving current-dated rows. Every other core table's most recent row is over two months old. That's consistent with, and adds hard numbers to, the caveat already raised in the first run about the claim/encounter tables' data horizon lagging wall-clock time — this is exactly the situation the new freshness check was built to catch automatically instead of relying on someone noticing it by eye.

## 3. KPI shortlist

13 KPIs shortlisted from the 5 largest transactional tables (`MEDICAL_CLAIM_HEADER`, `MEDICAL_CLAIM_LINE`, `FACT_ENCOUNTER`, `FACT_CLAIM_PAYMENT`, `PHARMACY_CLAIM`), all `discovered` (no Semantic Views exist in this database yet). Full detail, including exact `series_sql`, is in `kpi_manifest.json`.

| KPI | Trend | r² | Note |
|---|---|---|---|
| `medical_claim_header.count_star` | flat | 0.05 | Baseline claim volume |
| `medical_claim_header.sum_total_billed_amount` | volatile | 0.10 | One extreme spike week (see below) |
| `medical_claim_header.sum_total_allowed_amount` | volatile | 0.00 | Same spike |
| `medical_claim_header.sum_total_plan_paid_amount` | volatile | 0.01 | Same spike, most extreme of the three |
| `medical_claim_header.avg_is_denied` | flat | 0.00 | Denial rate, stable ~8–15% |
| `medical_claim_line.count_star` | flat | 0.02 | Tracks claim count (r=0.97) |
| `medical_claim_line.sum_plan_paid_amount` | volatile | 0.01 | Line-level echo of the header spike |
| `fact_encounter.count_star` | flat | 0.06 | Tracks claim count (r=0.98) |
| `fact_encounter.avg_length_of_stay_days` | volatile | 0.04 | Noisy — see caveat on definition |
| `fact_claim_payment.sum_paid_amount` | **falling** | 0.39 | Real declining trend |
| `fact_claim_payment.count_star` | **falling** | **0.70** | **Strongest signal in this database** — see below |
| `pharmacy_claim.count_star` | rising | 0.20 | Mild real uptick, currently just above warn band |
| `pharmacy_claim.sum_plan_paid_amount` | volatile | 0.05 | Noisiest KPI (CV 0.28), no real trend |

**Standout finding 1 — `fact_claim_payment.count_star` is trending down hard.** Weekly payment count fell from ~260–310/week in June–July to 88/week by the week of 2026-08-24 (r²=0.70, slope ≈ −19.3 payments/week, ≈ −34% over the recent-vs-prior-4-week comparison). The latest full week's robust z is essentially at the critical fence (median 266, MAD 34 → crit_lower ≈ 89.6; observed value 88). `sum_paid_amount` on the same table shows the same decline (r²=0.39). This is this database's clearest and most actionable anomaly.

**Standout finding 2 — week of 2026-05-04 is a statistically extreme cost outlier**, not a volume outlier. `sum_total_billed/allowed/plan_paid_amount` on `MEDICAL_CLAIM_HEADER` all spike that week with robust z between 4.1 and 13.0 (plan-paid is the most extreme), and the pattern repeats identically at the line level (`medical_claim_line.sum_plan_paid_amount`, z≈11.0) and in average length of stay (z≈5.0). But `count_star` (claims) and `count_star` (lines) for that same week are unremarkable (z≈2.0–2.3, inside the warn band), and the denial rate that week (9.7%) was actually below the 12.1% average. Read together, this looks like a handful of genuinely high-cost claims (e.g. longer inpatient stays) landing in one week, not a duplicate-load or data-quality artifact — see Attribution below.

**Standout finding 3 — `fact_claim_payment`'s recent decline reverses a 6-year growth trend.** The multi-grain check (new this pass) reruns each KPI's measure at monthly and yearly grain over the *full* table history (2020–2026, span 2,372–2,415 days — comfortably past the 730-day bar for a yearly check) rather than just the 90-day window. For `fact_claim_payment.count_star`, native-grain shows the sharp 13-week decline already reported (r²=0.70, falling); but month-grain (r²=0.45) and year-grain (r²=0.37) both show real, positive growth across the full history. `sum_paid_amount` shows the same pattern, even more strongly (month r²=0.54, year r²=0.60, both positive). **This makes the decline more concerning, not less** — it's not noise reverting to a long-run mean, it's a recent break from an established multi-year growth trajectory. This is the clearest example in this database of why native-grain-only monitoring misses things: at 90 days this metric reads as "trending down"; zoomed out, it reads as "off-trend."

**Standout finding 4 — denial rate is creeping up year-over-year, invisibly at shorter grains.** `medical_claim_header.avg_is_denied` is flat at native grain (r²≈0) and flat at month grain (r²=0.10), which would normally read as a boring, stable KPI. But the year-grain trend is strong (r²=0.83, positive slope) — denial rate has been genuinely rising across the 2020–2026 history. A month-of-year seasonality check (spot-checked for this KPI specifically) found no cyclical explanation — denial rate ranges narrowly from 11.0% to 12.5% across every calendar month, with no visible pattern — so this reads as a real secular creep, not a seasonal artifact. Tagged `kpi_class = error_rate` in the manifest given the measure semantics; `snowflake-kpi-anomaly-detector` should treat this as a standing watch item regardless of whether native-grain thresholds ever trip.

Every other KPI's monthly trend (r² 0.62–0.84 for claim/line/encounter volume and dollar amounts) is consistent with ordinary book-of-business growth and isn't concerning on its own — it's listed in the manifest for completeness, not as an anomaly.

## 4. Correlations

| KPI A | KPI B | r | Interpretation |
|---|---|---|---|
| `medical_claim_header.count_star` | `fact_encounter.count_star` | 0.984 | Claims and encounters move together — a clean utilization sanity check. |
| `medical_claim_header.count_star` | `medical_claim_line.count_star` | 0.972 | Expected structural correlation (one claim → many lines). |
| `medical_claim_header.sum_total_billed_amount` | `medical_claim_line.sum_plan_paid_amount` | 0.941 | Header and line dollar amounts agree — no sign of a header/line reconciliation problem. |

**Investigated but inconclusive**: `fact_claim_payment.count_star` vs. `medical_claim_header.count_star`, r=0.24 on only 4 overlapping weeks — the claim-header table's own data horizon (through 2026-06-30) barely overlaps the payment table's horizon (through 2026-09-01), so this can neither confirm nor rule out that the payment decline reflects a broader claims-submission slowdown. Worth re-checking once more overlapping weeks of data exist.

**Attribution for the payment-count decline (Standout finding 1)**: with only 4 overlapping weeks against claim volume, there isn't enough data in the manifest's correlation set to attribute the decline to a claims-side slowdown versus a payment-processing-side issue. Two hypotheses, both unconfirmed: (a) claims submission itself may have slowed after the data's June cutoff, which would only show up in payments with the usual submission-to-payment lag — consistent with, but not proven by, the fact that `MEDICAL_CLAIM_HEADER`/`FACT_ENCOUNTER` data simply stops at 2026-06-30 while `FACT_CLAIM_PAYMENT` keeps going through 2026-09-01; or (b) something specific to payment processing/posting slowed independent of claim volume. `AUDIT_LOAD_LOG`/`DQ_RULE_RESULT` (load pipeline metadata) exist in this database and would be the next place to check but weren't examined in this pass.

**Attribution for the 2026-05-04 cost spike**: same-week claim/line volume was normal (z≈2.0–2.3) while dollar amounts and average LOS both spiked sharply — consistent with a small number of unusually high-cost claims (e.g. extended inpatient stays) rather than a volume surge or data-quality issue. Denial rate that week was below average, weakening any "bad batch got flagged" theory. Hypothesis, not confirmed cause.

## 5. Caveats

- **This was a manual, abbreviated run**, not an automated invocation of the registered `snowflake-data-profiler` subagent — the custom agent definition isn't yet loadable as an invokable subagent type in this session (needs a session reload). The phases were executed by hand against the same instructions, covering the 5 largest transactional tables and 13 KPI candidates rather than an exhaustive scan of all 37 tables. Full distribution stats (percentiles, null rate, frozen-bucket share, seasonality) from the agent's Phase 1 spec were not computed for every KPI — only mean/median/stddev/MAD/min/max/slope/r².
- **`ACCOUNT_USAGE` latency/retention**: up to ~3hr latency, ~365-day retention. Given this account is 6 days old, retention isn't a practical constraint yet, but very recent queries (including some from this session) may not have landed in `ACCESS_HISTORY`/`QUERY_HISTORY` at query time.
- **Lookback window was anchored to each table's own `MAX(date_column)`, not wall-clock `CURRENT_TIMESTAMP()`.** The underlying claim/encounter data's most recent dates (2026-06-30 for claims/encounters, 2026-07-03 for pharmacy, 2026-06-01 for premium/member-month, 2026-09-01 for claim payment) lag real "today" (2026-09-10) by anywhere from 9 days to over 3 months. A literal `CURRENT_TIMESTAMP()`-anchored `series_sql` would return partial or empty series for most KPIs and get worse over time as the wall clock keeps moving while this data doesn't. The manifest's `series_sql` values use `DATEADD(day,-90, MAX(date_column))` instead — self-adjusting if the table is ever refreshed, but note this means the "recent" data these KPIs describe is calendar-wise several months old.
- **Both edge buckets of every weekly series can be partial** (the 90-day window rarely aligns to week boundaries), which shows up as an artificially low first and/or last data point. Baseline statistics in the manifest and `KPI_BASELINE` table trim both edge buckets before computing distribution/trend stats; the raw first/last points are still real data, just not directly comparable to interior buckets.
- **`fact_encounter.avg_length_of_stay_days`** is diluted by non-inpatient encounters with `LENGTH_OF_STAY_DAYS = 0` — the whole-table average sits near 0.03–0.24 days, which isn't a meaningful LOS figure on its own. A better version would filter to inpatient encounters (`ENCOUNTER_SETTING`/`ENCOUNTER_TYPE`). Kept in the shortlist at lower priority because it independently corroborates the 2026-05-04 spike, not because the metric definition is production-ready.
- **Marts and monthly-grain facts** (`MART_*`, `FACT_PREMIUM`, `FACT_MEMBER_MONTH`, `MART_PMPM_PLAN_MONTH`) were excluded from the KPI shortlist — see `skipped` in the manifest — because annual/monthly grain over a 90-day window falls well short of the ~12-bucket viability bar this method needs. They're good KPI candidates at a longer lookback (e.g. 3+ years for the annual marts).
- **Directionality was not assigned in this pass** (the manifest schema field exists but wasn't populated) — that's `snowflake-kpi-anomaly-detector`'s Phase 2 responsibility, and it should treat every directionality call as an assumption needing human confirmation, per its own instructions.
- **`month_of_year_seasonality_sql` was executed for one KPI only** (`medical_claim_header.avg_is_denied`, to check Standout finding 4 wasn't seasonal) to control query cost. The string is present and pattern-validated (same proven `MONTH(...)` / `GROUP BY` syntax used elsewhere) for all 13 KPIs, but not individually run for the other 12 — `snowflake-kpi-anomaly-detector` should treat those as unverified until it runs them itself.
- **`write_activity_stopped` was not computed this pass** — the manifest's `table_usage_series` covers query/write activity from `ACCESS_HISTORY`, but given this account's near-zero organic usage (see Usage heatmap), that signal is currently uninformative; revisit once there's real query traffic to check against.

## 6. Manifest

Full machine-readable output: `reports/HEALTH_CARE/kpi_manifest.json`, now carrying `freshness_sql`, `history_span_sql`, `monthly_trend_sql`, `yearly_trend_sql`, and `month_of_year_seasonality_sql` per KPI alongside `series_sql`. Baseline stats are also persisted in `HEALTH_CARE.ANALYTICS.KPI_BASELINE` (one row per KPI for this run's `run_ts`; the new multi-grain/freshness columns from the updated DDL aren't backfilled into that table this pass — only the manifest carries them for now). `snowflake-kpi-anomaly-detector` consumes the manifest for thresholding, current-state classification, and attribution. Priority order for its first pass: `fact_claim_payment.count_star` (Standout findings 1 & 3 — critical native-grain deviation *and* a trend reversal), `medical_claim_header.avg_is_denied` (Standout finding 4 — a slow-burn error-rate creep that will need its always-shown report call-out to avoid getting buried), and the freshness flags on the four stale tables above.
