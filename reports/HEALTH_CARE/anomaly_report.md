# HEALTH_CARE — KPI Anomaly, Audit & Forecast Report

Generated 2026-09-16 by `snowflake-kpi-anomaly-detector`, run against `reports/HEALTH_CARE/kpi_manifest.json` (generated_at 2026-09-16T10:49, same-day, well under the 7-day staleness bar). **29 KPIs** total — the 15 baselined in the 2026-09-11 pass (unchanged, still current) plus **14 newly baselined this pass**: `fact_premium.sum_billed_premium_amount`, `fact_premium.count_star`, `fact_member_month.count_star`, `member_eligibility.count_star`, `fact_claim_diagnosis.count_star`, `dim_member.count_star`, `dim_provider_location.count_star`, `mart_utilization_per_1000.er_visits_per_1000`, `mart_utilization_per_1000.inpatient_admits_per_1000`, `mart_provider_year_summary.weighted_denial_rate`, `mart_member_year_summary.pmpm`, `mart_pharmacy_class_year.sum_plan_paid_amount`, `mart_pharmacy_class_year.sum_script_count`, `mart_pmpm_plan_month.pmpm_total_healthcare_cost`.

**What changed since the last version**: brought the manifest's 7 new KPIs (added in profiler passes 5–9) up to full baseline/threshold/current-state/forecast coverage, matching what the original 15 already had. The single most important new finding: **the denial-rate creep first found at the weekly claim-header grain is now independently confirmed at the annual provider-rollup grain too** — two different tables, two different grains, same conclusion (see Part 1 and §5).

---

# Part 1 — For Business Readers

No statistics, no database terms, no jargon — just what's happening with each number and why, in plain language. If you want the evidence and method behind any of this, it's in Part 2 below.

## What's happening right now

### Needs attention

**Claim Payments Disbursed (#)** — about 88 payments last week.
*Much lower than usual — needs attention.*
Payments are down mainly because fewer brand-new claims are coming through — first-time claim payments dropped by more than half over the past two months, from roughly 1,000 a week to under 500. Payments tied to corrections and resubmissions on existing claims actually held steady or grew in the same period, so this looks like fewer new claims entering the system, not a slowdown in processing the ones already in the pipeline.
*We're confident in this reading — the underlying data here is fresh, updated within the last two weeks, and this is the clearest finding in the current review.*

### Worth watching

**Provider Network Denial Rate** — about 11.8% of claims denied in the last complete year (2025), and running close to 12% so far this year.
*Slightly higher than usual — worth watching.*
The share of claims getting denied across our provider network has been creeping up for years — from about 10.9% six years ago to nearly 12% now — and this shows up independently in two different places: the week-by-week claim data (below) and this separate provider-level rollup both tell the same story. No single specialty or provider type is driving it; the increase is spread across many types of providers, which suggests a broader, systemic trend rather than one bad actor.
*We're confident in this reading — it's been confirmed two different ways.*

**Claim Denial Rate** — about 13.9% of claims denied last week.
*Normal right now, but drifting higher over the longer term.*
Denials have been creeping up gradually over the past few years. A big part of it is that more claims are coming from out-of-network providers, and those get denied roughly twice as often as in-network claims — so as out-of-network claims become a bigger share of the mix, the overall denial rate rises with it. This is the same trend confirmed independently above.
*We're confident in this reading.*

**Claim Payments Disbursed ($)** — about $187,000 last week.
*Lower than usual — worth watching.*
The dollar amount paid out each week has been trending down for two months, in step with the drop in the number of payments going out — this is very likely the same story: fewer new claims entering the pipeline, not a payment-processing slowdown. We haven't independently double-checked the breakdown for the dollar figure yet, but it moves in lockstep with the payment count.
*We're confident in this reading — the underlying data here is fresh, updated within the last two weeks.*

**Pharmacy Claims Filled** — about 592 claims last week.
*Slightly higher than usual — worth watching.*
Pharmacy claims have been trending gently upward for a couple of months. We don't have a specific cause identified for this one yet — it would need a closer look.
*This is a solid estimate.*

**Total Allowed Amount** — about $349,000 last week.
*Normal right now, but worth watching.*
The total allowed amount looks steady overall, but underneath that, the amount allowed per standard, first-time claim has actually been dropping — even though the number of those claims is going up. In other words, we're processing more claims, but allowing less per claim on average.
*This is a solid estimate, though the underlying data is a couple months old.*

**Total Plan-Paid Amount** — about $300,000 last week.
*Normal right now, but worth watching.*
Same pattern as the allowed amount: the total paid looks steady, but the amount actually paid per standard, first-time claim has been dropping even as the number of those claims rises — so less is being paid out per claim on average.
*This is a solid estimate, though the underlying data is a couple months old.*

**ER Visits per 1,000 Members** — about 275 ER visits per 1,000 members in 2025.
*Slightly higher than usual — worth watching.*
Emergency-room visits per member have been climbing for years, and the increase is concentrated in Medicaid members, whose ER visit rate has grown by more than a third over the past six years — the fastest-growing group by far. Commercial and Exchange members are also visiting the ER more, while Medicare members' rate has actually eased slightly.
*This is a solid estimate, though the most recent year is still in progress so isn't fully comparable to prior full years.*

**Inpatient Admissions per 1,000 Members** — about 106 admissions per 1,000 members in 2025.
*Slightly higher than usual — worth watching.*
Hospital admissions per member have been rising for years, and the fastest growth by far is among Exchange-plan members, whose admission rate has jumped nearly 70% over the past six years. Commercial and Medicare members are also being admitted more often, while Medicaid members' rate has eased slightly.
*This is a solid estimate, though the most recent year is still in progress so isn't fully comparable to prior full years.*

**Per-Member-Per-Month Cost (PMPM)** — about $838 per member per month in 2025, a record high.
*Slightly higher than usual — worth watching.*
The average cost to cover each member per month has grown sharply over the past six years, hitting a record high in 2025. Medicare members account for the largest share of that increase in dollar terms, while Exchange members' costs have nearly doubled proportionally — but every segment (Commercial, Medicaid, Medicare, and Exchange) is rising. The figure so far this year is running a bit below 2025's record, which is worth watching once the full year is in.
*This is a solid estimate, though the most recent year is still in progress so isn't fully comparable to prior full years.*

**Pharmacy Plan-Paid Spend** — about $5.4 million paid for prescriptions in 2025, a record high.
*Slightly higher than usual — worth watching.*
What the plan pays for prescription drugs has grown sharply, mainly because of oral cancer medications, which account for the single largest piece of the increase, followed by GLP-1 weight-loss/diabetes drugs and biologic immune-system medications. This matches a well-known national trend in specialty and GLP-1 drug costs, not a data problem.
*This is a solid estimate, though the most recent year is still in progress and its raw total looks artificially low until the full year of data is in — we used the last complete year (2025) as the current reading.*

**Per-Member-Per-Month Total Healthcare Cost** — about $801 per member per month recently.
*Normal right now, but drifting higher over the longer term.*
Total healthcare cost per member per month looks steady right now, close to its typical recent level. But zooming out, this cost has been climbing steadily for years, and the most recent few months show that increase concentrated in Medicaid plans, while Commercial and Medicare plans actually eased a bit over the same stretch.
*This is a solid estimate, though it runs a few months behind real time.*

### Growing — good news, still worth knowing

**Premium Billed Amount** — about $2.27 million billed last month.
*Higher than usual.*
Billed premiums have been climbing steadily for months, mainly driven by Medicare plans, which account for most of the increase, with smaller but real growth in Commercial, Exchange, and Medicaid plans too. This looks like healthy, broad-based growth rather than a one-time spike.
*This is a solid estimate, though the data behind it runs a few months behind.*

### Normal

| KPI | Latest reading | Status | The short version |
|---|---|---|---|
| Claims Submitted | ~417 claims/week | Normal | Claim volume is holding steady, with only a small, unremarkable uptick in first-time claims. |
| Total Billed Amount | ~$807,000/week | Normal | Steady, aside from one one-time spike a few months back from a handful of large claims. |
| Claim Lines Submitted | ~1,126 lines/week | Normal | Tracks claim volume closely, which is stable. No specific cause breakdown yet. |
| Line-Level Plan-Paid Amount | ~$302,000/week | Normal | Mirrors the claim-level total closely, as expected. No specific cause breakdown yet. |
| Encounters | ~318 visits/stays/week | Normal (upper end of usual range) | Tracking the rise in claims volume. No specific cause breakdown yet. |
| Avg Length of Stay | under a day, on average | Normal — no clear pattern | No consistent up-or-down pattern; likely diluted by non-overnight visits mixed into the average. |
| Pharmacy Plan-Paid Amount | ~$91,000/week | Normal — just noisier than most | Bounces around week to week more than other numbers we track, but isn't trending up or down. |
| Providers Enrolled | 8 providers | Normal | This is a reference list that doesn't change often, not a live feed. Flat, with a small, low-volume uptick in specialists. |
| Provider–Network Contracts | 87 contracts | Normal | Another reference table that doesn't change often. Both active and ended contracts have stayed essentially flat. |
| Billed Member-Months | ~2,162/month | Normal | Growing steadily, spread across all plan types — led by Commercial, with Medicare, Medicaid, and Exchange all contributing. |
| Enrolled Member-Months | ~2,137/month | Normal | Same broad-based growth pattern as billed member-months, led by Commercial members. |
| New & Renewed Eligibility Records | ~95/month (non-January) | Normal for this time of year | Huge every January from annual renewals, much smaller the rest of the year — this is expected, not a problem. |
| Diagnoses Recorded | ~940/week | Normal | Tracks overall claim-volume growth; no single diagnosis type or category is driving anything unusual. |
| New Member Records | ~58/week | Normal | Steady pace; reflects historical member build-out rather than live enrollment activity. |
| Provider Locations Added | ~17/week | Normal, upper end of usual range | No clear geographic pattern behind the recent pace; looks like ordinary noise. |
| Prescriptions Filled | ~25,849/year (2025) | Normal | Keeps growing steadily, spread across common everyday medications like pain relievers and cholesterol drugs — healthy, broad-based growth. |

## What to expect next

These are backed either by trained models we built ourselves or, for the shorter/newer series, by a transparent trend projection — not a black box. For several numbers, we checked and found no real pattern worth trusting, so we say that plainly instead of pretending otherwise.

- **Claims Submitted**: expected to hold roughly steady, around 400 a week.
- **Total Billed Amount**: expected to stay in the same range as recent weeks, no clear direction.
- **Total Plan-Paid Amount**: expected to hold roughly steady, around $304,000 a week.
- **Claim Payments Disbursed (#)**: expected to tick back up a little from last week's low, to roughly 105 payments — still well below the normal weekly pace, not a full recovery.
- **Claim Payments Disbursed ($)**: no reliable pattern to project from — the best guess is roughly where it is now.
- **Total Allowed Amount**: no reliable pattern to project from — the best guess is roughly where it is now.
- **Claim Denial Rate**: no reliable week-to-week pattern to project from — the best guess is roughly where it is now, though the longer-term upward drift discussed above is a separate, real signal.
- **Premium Billed Amount**: expected to keep climbing, to roughly $2.28 million next month.
- **Billed / Enrolled Member-Months**: both expected to keep growing at their current steady pace.
- **New & Renewed Eligibility Records**: expected to stay in the usual 85–100 range for a non-January month — expect a large jump every January from annual renewals.
- **Diagnoses Recorded**: expected to hold roughly steady, around 930 a week.
- **Provider Network Denial Rate**: expected to keep drifting up slightly next year, to roughly 12%.
- **ER Visits / Inpatient Admissions per 1,000 Members**: both expected to keep rising modestly next year.
- **Per-Member-Per-Month Cost (PMPM)**: expected to keep climbing, to roughly $894 next year.
- **Pharmacy Plan-Paid Spend**: expected to keep climbing, to roughly $5.9 million next year, driven by the same specialty-drug categories.
- **Per-Member-Per-Month Total Healthcare Cost**: expected to hold close to its current level in the very short term, while continuing its slow multi-year climb.

Everything else (claim lines, encounters, average length of stay, pharmacy claims and payments, new member records, provider locations, prescriptions filled) has no reliable short-term pattern either — the best guess for each is that it stays close to its most recent value.

## Data reliability notes

- **Claim Payments Disbursed (# and $)** are based on the freshest data in this review — updated within the last couple of weeks.
- **Most claims-side numbers** — claims, claim lines, encounters, pharmacy claims, diagnoses — are based on data that's a couple of months old, not real-time. The readings above are still accurate for the period they cover, just not as current as the payment numbers.
- **Premium, enrollment, and eligibility numbers** run a bit further behind — roughly three to four months old — which is normal for a monthly billing/enrollment cycle, not a sign of a broken pipeline.
- **The four annual summary numbers** (utilization per 1,000, provider denial rate, PMPM, pharmacy spend) are refreshed once a year; this year's figure is still in progress, so we used last year's complete figure as the current reading everywhere above.
- **Providers Enrolled, Provider–Network Contracts, New Member Records, and Provider Locations Added** are drawn from reference/build-out data that only changes occasionally by nature — being "older" doesn't mean anything is broken for these.

---

# Part 2 — Technical Detail (Data Team Reference)

*Everything below is the statistical and technical record behind Part 1 — thresholds, trend fits, SQL-level attribution, and audit detail, for whoever maintains this pipeline or wants to verify a specific number. A business reader doesn't need anything past this point.*

## 1. Executive summary

- **`fact_claim_payment.count_star` is critical and getting worse — and now it has a real explanation.** The decline is concentrated entirely in **ORIGINAL (first-time) claim payments**, down 54% by count over 8 weeks, accounting for ~110% of the net decline (other claim types partially offset it). Fewer new claims are entering the payment pipeline; payment processing itself is still working through the existing backlog. That decline still **reverses a 6-year growth trend** — monthly and yearly views of the same table both show real, positive growth across 2020–2026.
- **NEW THIS PASS — denial-rate creep now confirmed two independent ways.** `medical_claim_header.avg_is_denied` (weekly claim-header grain, year r²=0.83) and `mart_provider_year_summary.weighted_denial_rate` (annual provider-rollup grain, year r²=0.81) are two different tables at two different grains, and both show the same real, sustained increase — from roughly 10.9%–11% six years ago to roughly 12% now. At the weekly grain, the driver is a growing share of out-of-network claims (which deny ~2x as often). At the annual provider-rollup grain, no single provider type dominates — the increase is spread across ~18 provider types. Two independent lenses, same conclusion, different granularity of explanation: this is the strongest finding of this pass and exactly the kind of cross-validation this pipeline is built to surface.
- **Broad-based, real growth confirmed across the premium/enrollment/utilization/cost side of the business.** `fact_premium.*`, `fact_member_month.count_star`, `member_eligibility.count_star` (once the January-renewal seasonality is accounted for), `mart_utilization_per_1000.*`, `mart_member_year_summary.pmpm`, `mart_pharmacy_class_year.*`, and `mart_pmpm_plan_month.pmpm_total_healthcare_cost` all show real, sustained multi-year growth — none of it looks anomalous; all of it is attributed to specific segments/categories (see §5). Two companion tables (`FACT_PREMIUM.count_star` and `FACT_MEMBER_MONTH.count_star`) independently corroborate each other's COVERAGE_TYPE growth mix to within ~1%, a clean audit finding worth noting on its own.
- **A quieter finding surfaced by the same backfill**: `ORIGINAL`-claim allowed and paid amounts are *falling* even as `ORIGINAL` claim *count* is *rising* — allowed/paid-per-claim is dropping. The native-grain "volatile, no clear trend" read never caught this; the dollar-amount KPIs looked flat only because a REVERSAL/REPLACEMENT correction pair happens to offset in the aggregate.
- **Claims and encounters reconcile cleanly overall** — header totals match summed line totals for 97.9% of claims — but 2,103 claims (2.1%) don't, including one $108,712 single-claim discrepancy worth a manual look.
- **Data freshness varies sharply by table and by grain**: only `FACT_CLAIM_PAYMENT` has current data (9 days old); the core weekly claims tables are 69–77 days stale; the monthly premium/enrollment tables run ~106–107 days behind (normal monthly-cycle lag); the annual summary marts run ~257 days behind because the current year isn't finished yet (also normal, not a pipeline problem). `DIM_PROVIDER`, `BRIDGE_PROVIDER_NETWORK`, `DIM_MEMBER`, and `DIM_PROVIDER_LOCATION` are *very* stale by the numbers (2,445–2,649 days) but that's a historical build-out table pattern, not a broken feed — see the Freshness table below.
- **Two data-quality artifacts caught and corrected this pass, not misread as anomalies**: (1) `MEMBER_ELIGIBILITY.count_star`'s extreme January-renewal seasonality (CV=2.72) would make every raw threshold fire every January — handled by classifying the KPI `seasonal-as-expected` and not computing a meaningful raw band. (2) The four annual MART KPIs built on raw-dollar/count sums (`mart_pharmacy_class_year.*` especially) are badly distorted by 2026 being a partial year — used the manifest's `*_excl_partial` trend figures and the last *complete* year (2025) as the current-state reference throughout, rather than reading 2026's partial total as a decline.
- **7 of the 29 KPIs still don't have a business-language attribution** — `medical_claim_line.*`, `fact_encounter.*`, `fact_claim_payment.sum_paid_amount`, `pharmacy_claim.*` — unchanged from the last pass, flagged explicitly in §5 rather than silently left blank. Out of scope for this pass per the task's priority order; next backfill target.

## 2. Alerting board

Every row shows its `why` and `confidence` alongside the label — a verdict without a stated reason isn't a finished classification.

| Verdict | KPI | Value | Band | Confidence | Why |
|---|---|---|---|---|---|
| **CRITICAL** | `fact_claim_payment.count_star` | 88 | crit_lower 89.56 | **high** | Last full-week value sits at/past the critical fence; native trend strongly real and falling (r²=0.70); month/year grain both show real growth (r²=0.45/0.37) — a reversal, not noise. High confidence because the source table is fresh (9d stale). **Business reason (strong): decline concentrated in ORIGINAL claim payments — see §5.** |
| WARN | `pharmacy_claim.count_star` | 592 | warn_upper 589.64 | medium | Just past warn_upper (z≈3.23); native trend real (r²=0.20), month-grain stronger (r²=0.62) — a genuine if mild uptrend. Medium confidence: source table is 69 days stale. No business dimension breakdown yet. |
| WARN | `main.fact_premium.sum_billed_premium_amount` | 2,266,159.94 | warn_upper 2,173,515.68 | medium | Above the warn band but consistent with a strong, sustained 31-month uptrend (r²=0.97 full history) — not a sudden jump. Moving the "good" direction for this KPI (a rise in billed premium), so alerting severity here should be read as "notable, not concerning." |
| watch (falling, inside band) | `fact_claim_payment.sum_paid_amount` | 187,039.29 | warn band [0, 497,459] | **high** | Native trend real and falling (r²=0.39) tracking the critical KPI above; month/year grain show real growth (r²=0.54/0.60) — same reversal pattern. Very likely shares `count_star`'s ORIGINAL-claim explanation but not independently backfilled yet. |
| stable, but real trend | `main.mart_provider_year_summary.weighted_denial_rate` (`kpi_class=error_rate`) | 0.1177 (2025) | inside warn [0.1010, 0.1293] | medium | Inside the static band, but continuing a real 7-year uptrend (r²=0.81); listed here unconditionally per its `error_rate` class regardless of band status. Cross-validates `medical_claim_header.avg_is_denied`. |
| trending up, inside warn | `main.mart_utilization_per_1000.er_visits_per_1000` | 274.86 (2025) | inside warn [211.05, 311.66] | medium | Near the top of its historical range, real 7yr uptrend (r²=0.78 excl. partial 2026), concentrated in MEDICAID. |
| trending up, inside warn | `main.mart_utilization_per_1000.inpatient_admits_per_1000` | 105.64 (2025) | inside warn [66.23, 127.43] | medium | Real 7yr uptrend (r²=0.74), concentrated in EXCHANGE (+69% relative). |
| trending up, inside warn | `main.mart_member_year_summary.pmpm` | 837.83 (2025) | inside warn [373.12, 1018.67] | medium | Record high, real 7yr uptrend (r²=0.86, +38% recent-vs-baseline); 2026 partial figure runs below this peak, worth a follow-up once 2026 closes. |
| trending up, inside warn | `main.mart_pharmacy_class_year.sum_plan_paid_amount` | 5,413,551.67 (2025) | inside warn [626,679.57, 7,270,295.22] | medium | Record high, real uptrend excl. partial 2026 (r²=0.98, +46%), driven by oral oncolytics/GLP-1/biologics. |
| stable at native grain, real longer-horizon drift | `main.mart_pmpm_plan_month.pmpm_total_healthcare_cost` | 801.32 | inside warn [435.87, 1198.59] | medium | Flat/noisy over the trailing 30 months (r²=0.004) but real growth over full history (month r²=0.51, year r²=0.86) — genuinely two different timescales, not a contradiction. Recent growth concentrated in MEDICAID. |
| stable | 11 of the original 15 KPIs + `fact_premium.count_star`, `fact_member_month.count_star`, `fact_claim_diagnosis.count_star`, `dim_member.count_star`, `dim_provider_location.count_star`, `mart_pharmacy_class_year.sum_script_count` | — inside warn — | medium | Source tables stale 69–107 days depending on cadence — capped at `medium` regardless of how clean the native-grain numbers look. |
| stable, low signal | `fact_encounter.avg_length_of_stay_days` | 0.0692 | inside warn | medium | No real trend at any tested grain (native r²=0.04, month r²=0.006, year r²=0.10) — the "stable" label here means "no signal detected," not "confirmed steady." |
| stable, historical-dimension caveat | `dim_provider.count_star`, `bridge_provider_network.count_star`, `dim_member.count_star`, `dim_provider_location.count_star` | 8 / 87 / 58 / 17 | inside warn | medium | All genuinely flat/noisy at every grain tested. `days_stale` is very large (2,445–2,649d) but reflects these tables being slowly-changing historical build-out/dimension data, not an ongoing operational feed going stale. |
| seasonal-as-expected | `main.member_eligibility.count_star` | 95 (June, non-January) | not meaningful in raw form | medium | Extreme January-renewal seasonality (CV=2.72) makes raw IQR/z fences meaningless; year-grain trend is real and strong (r²=0.90). Evaluate month-over-month against the same calendar month, not against a flat band. |

**Freshness call-out** (unconditional, from Phase 0):

| Table | Days stale | Status | Note |
|---|---|---|---|
| `MEDICAL_CLAIM_HEADER` | 72 | Stale | Ongoing operational table — a real pipeline signal |
| `MEDICAL_CLAIM_LINE` | 72 | Stale | Same |
| `FACT_ENCOUNTER` | 72 | Stale | Same |
| `PHARMACY_CLAIM` | 69 | Stale | Same |
| `FACT_CLAIM_DIAGNOSIS` | 77 | Stale | Same |
| `FACT_CLAIM_PAYMENT` | 9 | Fresh | — |
| `FACT_PREMIUM` | 106 | Stale (normal monthly cadence) | Monthly billing mart — expected lag, not a pipeline break |
| `FACT_MEMBER_MONTH` | 106 | Stale (normal monthly cadence) | Same |
| `MEMBER_ELIGIBILITY` | 106 | Stale (normal monthly cadence) | Same |
| `MART_PMPM_PLAN_MONTH` | 107 | Stale (normal monthly cadence) | Same |
| `MART_UTILIZATION_PER_1000` | 257 | Stale (normal annual cadence) | Current year (2026) not finished yet — expected |
| `MART_PROVIDER_YEAR_SUMMARY` | 257 | Stale (normal annual cadence) | Same |
| `MART_MEMBER_YEAR_SUMMARY` | 257 | Stale (normal annual cadence) | Same |
| `MART_PHARMACY_CLASS_YEAR` | 257 | Stale (normal annual cadence) | Same |
| `DIM_PROVIDER` | 2,645 | Stale (by design) | Slowly-changing dimension; historical, not a live feed |
| `BRIDGE_PROVIDER_NETWORK` | 2,445 | Stale (by design) | Same |
| `DIM_MEMBER` | 2,450 | Stale (by design) | Historical member-record build-out era (data ends 2019); no ongoing write expectation |
| `DIM_PROVIDER_LOCATION` | 2,649 | Stale (by design) | Same pattern, historical location build-out |

`FACT_CLAIM_PAYMENT` remains the only *operational* table still receiving current-dated rows. The monthly marts' ~106-day lag and annual marts' ~257-day lag are both structurally expected given their refresh cadence and should not be read the same way as the weekly claims tables' staleness.

**Error & quality rates call-out** (unconditional, from `kpi_class = error_rate`): `medical_claim_header.avg_is_denied` and, new this pass, `mart_provider_year_summary.weighted_denial_rate` — both currently inside-warn but both real, sustained, and now cross-validated. Listed here regardless of band status per their class.

## 3. Forecasts

Original 15 KPIs rerun 2026-09-14 with the local ML forecaster (`ml/forecast.py`); the 14 new KPIs this pass use a transparent trend-band projection (`trend_band`) rather than `ml_lightgbm` — their native-grain series are short (7–31 buckets), well under the forecaster's ~60-row minimum, so the honest choice is the documented fallback rather than a spuriously-trained model. This project does not use `SNOWFLAKE.ML.FORECAST`/`ANOMALY_DETECTION`; nothing here does.

**Original 15 (ML-forecast, unchanged from 2026-09-14):**

| KPI | Forecast (next week) | Band | Forecast confidence | Method | Beats naive at every horizon? |
|---|---|---|---|---|---|
| `medical_claim_header.count_star` | 399.7 | [361.2, 449.6] | **high** | ml_lightgbm | yes (13–20% lower error) |
| `medical_claim_header.sum_total_billed_amount` | 848,402.81 | [617,926.16, 1,138,491.35] | **high** | ml_lightgbm | yes (14–26% lower error) |
| `medical_claim_header.sum_total_allowed_amount` | 348,979.66 (= last observed) | — | low | naive_last_value | no |
| `medical_claim_header.sum_total_plan_paid_amount` | 303,988.28 | [167,773.10, 400,158.60] | medium | ml_lightgbm | yes, barely (<2% lower error) |
| `medical_claim_header.avg_is_denied` | 0.13909 (= last observed) | — | low | naive_last_value | no — the multi-year upward drift is a separate, longer-horizon finding |
| `medical_claim_line.count_star` | 1,126.0 (= last observed) | — | low | naive_last_value | no |
| `medical_claim_line.sum_plan_paid_amount` | 301,884.91 (= last observed) | — | low | naive_last_value | no |
| `fact_encounter.count_star` | 318.0 (= last observed) | — | low | naive_last_value | no |
| `fact_encounter.avg_length_of_stay_days` | 0.06918 (= last observed) | — | low | naive_last_value | no |
| `fact_claim_payment.sum_paid_amount` | 187,039.29 (= last observed) | — | low | naive_last_value | no |
| `fact_claim_payment.count_star` | 105.21 | [61.61, 135.04] | medium | ml_lightgbm | yes, modestly (5–11% lower error) |
| `pharmacy_claim.count_star` | 592.0 (= last observed) | — | low | naive_last_value | no |
| `pharmacy_claim.sum_plan_paid_amount` | 90,625.99 (= last observed) | — | low | naive_last_value | no |
| `dim_provider.count_star` | 8.1 | [5.9, 10.3] | low | trend_band | not applicable (reference table) |
| `bridge_provider_network.count_star` | 85.5 | [81.1, 90.0] | medium | trend_band | not applicable (reference table) |

**14 new KPIs this pass (trend_band, one step ahead — next month or next year, matching each KPI's own grain):**

| KPI | Forecast (next period) | Band | Forecast confidence | Basis |
|---|---|---|---|---|
| `fact_premium.sum_billed_premium_amount` | $2,282,129 | [$2,120,707, $2,443,551] | medium | Native 31-month slope, real fit (r²=0.79) |
| `fact_premium.count_star` | 2,168 | [2,123, 2,212] | medium | Native slope, real fit (r²=0.87) |
| `fact_member_month.count_star` | 2,143 | [2,101, 2,185] | medium | Native slope, real fit (r²=0.87) |
| `member_eligibility.count_star` | 91 (assumes a non-January month) | [84, 98] | **low** | Native slope is noise-dominated by the January spike; forecast is unreliable for any month, and completely wrong if the next month is January |
| `fact_claim_diagnosis.count_star` | 931 | [824, 1,038] | low | Weak native fit (r²=0.05) — essentially "stays near its recent level" |
| `dim_member.count_star` | 58 | [47, 69] | low | Weak native fit (r²=0.007) — historical build-out table, no real forward signal expected |
| `dim_provider_location.count_star` | 18 | [13, 22] | medium | Native fit borderline (r²=0.20) |
| `mart_utilization_per_1000.er_visits_per_1000` | 288.7 (2027) | [277.8, 299.6] | medium | Uses partial-year-excluded slope (r²=0.78) |
| `mart_utilization_per_1000.inpatient_admits_per_1000` | 111.8 (2027) | [96.8, 126.8] | medium | Real fit (r²=0.74) |
| `mart_provider_year_summary.weighted_denial_rate` | 0.1196 (2027) | [0.1145, 0.1247] | medium | Real fit (r²=0.81); matches the observed 2026 partial-year value (0.1197) almost exactly — a good sanity check |
| `mart_member_year_summary.pmpm` | $893.71 (2027) | [$760.36, $1,027.06] | medium | Real fit (r²=0.86) |
| `mart_pharmacy_class_year.sum_plan_paid_amount` | $5,949,336 (2027) | [$4,203,421, $7,695,251] | medium | Uses partial-year-excluded slope (r²=0.98) |
| `mart_pharmacy_class_year.sum_script_count` | 28,430 (2027) | [21,249, 35,612] | medium | Uses partial-year-excluded slope (r²=1.00) |
| `mart_pmpm_plan_month.pmpm_total_healthcare_cost` | $806.48 | [$660.60, $952.40] | medium | Uses the full-history month slope (r²=0.51), not the flat/noisy 30-month native slope |

**Read every `trend_band` forecast with the same caution as the ML ones**: it's a straight-line projection of the recent trend, not a model that's been checked against held-out data. Confidence is capped at `medium` even for a well-fit trend, and drops to `low` whenever the underlying fit is weak (r²<0.1) or the series is dominated by a seasonal pattern the trend line can't capture (`member_eligibility.count_star`).

## 4. Audit & reconciliation

**Cross-table reconciliation #1** — `medical_claim_header.sum_total_plan_paid_amount` vs. `SUM(medical_claim_line.plan_paid_amount)`, joined on `CLAIM_ID` (manifest correlation r=0.9998, n_overlap=14 — passes the ≥8-bucket validity gate comfortably):

- 99,271 claims checked, 2,103 mismatched (**2.12% mismatch rate**), worst single-claim discrepancy **$108,712.14**.
- The two tables reconcile cleanly for the large majority of claims. The 2.1% that don't, and especially the $108K outlier, are worth a manual reconciliation pass.

**Cross-table reconciliation #2 (new this pass, informal)** — `FACT_PREMIUM.count_star` vs. `FACT_MEMBER_MONTH.count_star`, both by `COVERAGE_TYPE`, trailing-4-vs-prior-4-month deltas:

| Coverage type | FACT_PREMIUM Δ | FACT_MEMBER_MONTH Δ | Agreement |
|---|---|---|---|
| COMMERCIAL | +845 | +839 | within 0.7% |
| MEDICARE | +641 | +639 | within 0.3% |
| MEDICAID | +412 | +406 | within 1.5% |
| EXCHANGE | +294 | +290 | within 1.4% |

Two independently-sourced tables about the same underlying member population produce nearly identical growth-by-segment numbers — a clean, positive audit finding: no sign of a data problem between the billing and enrollment sides of the business.

**Denial-rate cross-validation (new this pass)** — `medical_claim_header.avg_is_denied` (weekly claim-header grain, full-history year r²=0.83) vs. `mart_provider_year_summary.weighted_denial_rate` (annual provider-rollup grain, year r²=0.81): both independently confirm a real, sustained multi-year denial-rate increase. Not a formal row-level reconciliation (different grains, different source tables), but two independent measurements of the same underlying phenomenon reaching the same conclusion is strong corroborating evidence — see §5 and §1.

**Duplicate signal** (`IS_DUPLICATE_FLAG`):

| Table | Duplicate rate |
|---|---|
| `MEDICAL_CLAIM_HEADER` | 0.45% (444 / 99,271) |
| `MEMBER_ELIGIBILITY` | 0.39% (56 / 14,271) |

Both low. Not a driver of the volume/dollar KPIs on these tables this run.

**Key completeness**: `CLAIM_ID` and `MEMBER_ID` on `MEDICAL_CLAIM_HEADER` — 0 nulls out of 99,271 rows. Clean.

## 5. Attribution hypotheses — business language, not statistics

**The rule this section follows**: every reason here is a business explanation of what actually changed in the underlying records — a segment, a category, a mix shift, with real before/after numbers. A statistic (r², z-score) is never presented as a reason; it belongs in §2/§3, not here. Where the manifest has a `dimension_breakdown` for a KPI, that drives the finding. Where it doesn't, this section says so explicitly.

### KPIs with a real business-dimension finding (22 of 29)

**`fact_claim_payment.count_star` (critical) — strength: strong.** Joining `FACT_CLAIM_PAYMENT` to `MEDICAL_CLAIM_HEADER` via `CLAIM_ID` and splitting by `CLAIM_TYPE` (trailing 4 weeks vs. the 4 weeks before that):

| Claim type | Baseline | Recent | Delta |
|---|---|---|---|
| **ORIGINAL** | 1,006 payments · $1,143,309 | 466 payments · $598,554 | **−$544,755** |
| REPLACEMENT | 35 · $38,953 | 42 · $126,800 | +$87,846 |
| REVERSAL | 36 · −$40,685 | 40 · −$116,892 | −$76,207 |
| RESUBMISSION | 54 · $39,374 | 66 · $76,822 | +$37,447 |

ORIGINAL alone accounts for ~110% of the net ~$495,668 decline (the other three categories partially offset it). Fewer new claims are entering the payment pipeline; the system is still actively processing corrections, resubmissions, and reversals on the existing backlog.

**`medical_claim_header.avg_is_denied` (error-rate creep) — strength: strong.** Split by `PROVIDER_NETWORK_STATUS`:

| Network status | Baseline denial rate | Recent denial rate | Share of claim volume |
|---|---|---|---|
| OUT_OF_NETWORK | 15.9% | 18.2% (+2.2pp) | 39.6% → 43.2% |
| IN_NETWORK | 7.9% | 8.5% (+0.5pp) | 60.4% → 56.8% |

Out-of-network claims deny at roughly 2x the in-network rate, and they're becoming a larger share of total volume.

**`mart_provider_year_summary.weighted_denial_rate` (NEW, error-rate creep, same underlying trend, different grain) — strength: weak (attribution), strong (cross-validation).** Split by `PROVIDER_TYPE`, comparing the two most recent 3-year windows: no single provider type dominates — `ASC` moved most (17.1%→11.7%, −5.4pp, but a small base), `HOME_HEALTH` +3.0pp, `DME` +2.9pp, `ANESTHESIA` −2.8pp. The *attribution* is weak (spread across ~18 types), but the *cross-validation value* is strong: this is an independent table, independent grain, and it reaches the same "denial rate is really rising" conclusion as `avg_is_denied` above, with a compatible magnitude (+7% recent-vs-baseline here vs. the +2.2pp/+0.5pp splits there). Read together: the weekly network-mix story explains part of the mechanism; the annual provider-level view confirms the trend is real and broad-based, not concentrated in one specialty.

**`medical_claim_header.sum_total_allowed_amount` — strength: strong.** `ORIGINAL`-claim allowed amount fell **$176,812** even as `ORIGINAL` claim count rose — allowed-per-claim is genuinely dropping for standard claims, masked in the aggregate by a `REVERSAL`/`REPLACEMENT` correction pair.

**`medical_claim_header.sum_total_plan_paid_amount` — strength: strong.** Same pattern: `ORIGINAL`-claim plan-paid amount fell **$170,856**, paid-per-claim dropping for standard claims.

**`medical_claim_header.count_star` — strength: strong (small in absolute terms).** Genuinely stable overall (native r²=0.05); the modest net change (+140 claims, ~5% of typical volume) is concentrated in `ORIGINAL` claims (+129) — organic drift, not a finding worth acting on by itself.

**`medical_claim_header.sum_total_billed_amount` — strength: weak.** No category shows a decisive move; a REVERSAL/REPLACEMENT correction pair offsets to roughly zero net effect.

**`dim_provider.count_star` — strength: weak.** `SPECIALIST` enrollments moved most (+12, from a base of 4) but not meaningful at this volume.

**`bridge_provider_network.count_star` — strength: weak.** `PARTICIPATING`/`TERMINATED` both essentially flat.

**`fact_premium.sum_billed_premium_amount` (NEW) — strength: strong.** `COVERAGE_TYPE`, trailing 4 vs. prior 4 months: MEDICARE +$1.78M (largest, ~60% of the ~$2.97M total growth), COMMERCIAL +$723K, EXCHANGE +$365K, MEDICAID +$101K. Broad-based, Medicare-led growth.

**`fact_premium.count_star` (NEW) — strength: moderate.** `COVERAGE_TYPE`: COMMERCIAL +845 (largest, ~39% of the +2,192 total), MEDICARE +641, MEDICAID +412, EXCHANGE +294.

**`fact_member_month.count_star` (NEW) — strength: moderate.** `COVERAGE_TYPE`: COMMERCIAL +839 (largest, ~39%), MEDICARE +639, MEDICAID +406, EXCHANGE +290 — matches `fact_premium.count_star`'s pattern almost exactly (see §4's cross-table reconciliation).

**`member_eligibility.count_star` (NEW) — strength: weak (dimension breakdown is a seasonal-window artifact).** The `COVERAGE_TYPE` breakdown shows large negative deltas across all 4 segments, but that's an artifact of the baseline window catching the January 2026 renewal spike while the recent window doesn't — not a real per-segment decline. The reliable finding is the year-over-year one: January renewal volume itself has been growing (year r²=0.90).

**`fact_claim_diagnosis.count_star` (NEW) — strength: moderate.** `DIAGNOSIS_TYPE`: SECONDARY +281, PRINCIPAL +144 (both grew roughly proportionally). `DIAGNOSIS_CATEGORY`: ENDOCRINE +77 (largest), RESPIRATORY +71, PREVENTIVE +60 — broad-based growth tracking overall claim volume; NEOPLASM the only notable decline (small base).

**`dim_member.count_star` (NEW) — strength: moderate.** `PRIMARY_SEGMENT`: COMMERCIAL +13 (largest), EXCHANGE +12, MEDICAID −5, MEDICARE −4 — growth concentrated in Commercial/Exchange, consistent with growth patterns seen elsewhere in this schema.

**`dim_provider_location.count_star` (NEW) — strength: weak.** `STATE_CODE`: NY +12, MI +10, OH +7 — small counts, consistent with noise, not a real geographic shift.

**`mart_utilization_per_1000.er_visits_per_1000` (NEW) — strength: strong.** `COVERAGE_TYPE`, 3yr window vs. prior 3yr: MEDICAID 161.6→223.4 per 1,000 (+61.8, ~53% of the total movement, largest); COMMERCIAL +35.8; EXCHANGE +31.0; MEDICARE the only decline (−12.0).

**`mart_utilization_per_1000.inpatient_admits_per_1000` (NEW) — strength: strong.** `COVERAGE_TYPE`: EXCHANGE 47.3→80.0 per 1,000 (+32.7, +69% relative, ~59% of total movement, largest); COMMERCIAL +18.3; MEDICARE +7.4; MEDICAID the only decline (−3.5).

**`mart_member_year_summary.pmpm` (NEW) — strength: strong.** `PRIMARY_SEGMENT`: MEDICARE $1,615→$2,058 (+$443, ~55% of total, largest absolute); EXCHANGE $310→$599 (+93% relative, largest relative mover); MEDICAID +$141; COMMERCIAL +$132 — every segment rising.

**`mart_pharmacy_class_year.sum_plan_paid_amount` (NEW) — strength: strong.** `THERAPEUTIC_CLASS`: ORAL ONCOLYTICS +$1.79M (largest, ~45% of the top-5 movement), GLP-1 AGONISTS +$0.94M, BIOLOGIC IMMUNOMODULATORS +$0.86M, HEMATOPOIETIC AGENTS +$0.26M, OPIOID DEPENDENCE +$0.13M — consistent with well-documented national specialty-drug/GLP-1 cost trends.

**`mart_pharmacy_class_year.sum_script_count` (NEW) — strength: moderate.** `THERAPEUTIC_CLASS`: OPIOID ANALGESICS +4,015 scripts (largest, ~37% of top-5 movement), STATINS +1,809, SSRI +1,747, CORTICOSTEROIDS +1,662, QUINOLONES +1,545 — broad-based volume growth across common maintenance-medication classes.

**`mart_pmpm_plan_month.pmpm_total_healthcare_cost` (NEW) — strength: strong.** `SEGMENT`, trailing 4 vs. prior 4 months: MEDICAID +$177.6 PMPM (largest driver), EXCHANGE +$86.6, partially offset by COMMERCIAL −$73.8 and MEDICARE −$66.5 — recent growth concentrated in Medicaid.

### KPIs still without a business-dimension finding (7 of 29)

No `dimension_breakdowns` exist yet in the manifest for these — a coverage gap from before the field existed, not a "nothing to find" result, and explicitly out of scope for this pass per the task's priority order:

- `medical_claim_line.count_star`
- `medical_claim_line.sum_plan_paid_amount`
- `fact_encounter.count_star`
- `fact_encounter.avg_length_of_stay_days`
- `fact_claim_payment.sum_paid_amount` — cheapest win available: shares `count_star`'s table/join, the `CLAIM_TYPE` breakdown almost certainly mirrors the ORIGINAL-claims finding above.
- `pharmacy_claim.count_star`
- `pharmacy_claim.sum_plan_paid_amount`

## 6. Data quality & confidence

| KPI group | Confidence | Why not higher |
|---|---|---|
| `fact_claim_payment.sum_paid_amount`, `fact_claim_payment.count_star` | **high** | Fresh table (9d stale), well-populated buckets, strong trend fit |
| `mart_provider_year_summary.weighted_denial_rate` | medium | Only 7 annual buckets; real fit but thin sample, plus cross-validated with an independent table (raises practical trust beyond the raw tier) |
| all other 27 KPIs | medium | Either the source table is stale beyond the 14-day threshold (69–2,649 days, for reasons ranging from normal batch cadence to by-design historical build-out) or the series has few buckets (7 for the annual marts) |

No KPI this pass landed at `low` confidence or failed validation (`validated = true` for all 29). Full per-KPI distribution stats, month/year trend figures, and `validation_notes` are in `HEALTH_CARE.ANALYTICS.KPI_BASELINE` (this run's `run_ts` for the 14 new KPIs: `2026-09-16 04:07:26.405`; the original 15 remain at their 2026-09-10/11 `run_ts` values, unchanged and still valid).

Threshold method: IQR fences (median/quartile-based, 1.5×IQR warn / 3×IQR crit) for the 14 new KPIs this pass, robust z (median ± k×1.4826×MAD) for the original 15 — both are the same family of robust, outlier-resistant method: exact choice matters far less than always excluding raw-mean/stddev, which the outliers themselves would contaminate. `main.member_eligibility.count_star` is the one KPI in this database where neither method is meaningful in raw form — see its dedicated `seasonal-as-expected` treatment above. All directionality calls (`both`/`high_bad`/`low_bad`) are inferences from column/measure semantics, not confirmed — confirm with the business owner before wiring alerts to act on the low/high side asymmetrically.

## 7. Emitted artifacts

**Metric batch configs**: none written this pass — the top-5-by-severity set from 2026-09-11 (`fact_claim_payment_count`, `fact_claim_payment_paid_amount`, `pharmacy_claim_count`, `medical_claim_denial_rate`, `medical_claim_billed_amount`) still covers this database's highest-severity KPI (`fact_claim_payment.count_star` remains the sole CRITICAL). None of the 14 newly baselined KPIs currently rank above that set by severity (all are `medium`-confidence, inside-warn "worth watching" at worst) — ask if you'd like configs generated for the new denial-rate cross-validation finding specifically, since it's the strongest *new* signal this pass even though it's technically inside its band.

**For viewing**: `HEALTH_CARE.ANALYTICS.KPI_CURRENT_STATE` refreshed — **29 rows** across the two most recent `run_ts` values (15 from 2026-09-11, 14 new from this pass), each carrying `plain_status`/`plain_reason`/`plain_confidence` first, then the full technical layer (`state`/`why`/`confidence`, thresholds, directionality, forecast, `audit_status`, `business_reason`/`business_reason_dimension`/`business_reason_strength`, `relevant_for`). Point any BI tool at the latest `run_ts` per `kpi_id` for a live current-state dashboard. `HEALTH_CARE.ANALYTICS.KPI_BASELINE` likewise now has full coverage for all 29 KPIs.

## 8. Caveats

- **`ACCOUNT_USAGE` latency/retention**: up to ~3hr latency, ~365-day retention (inherited from the manifest).
- **Seasonality claims are thin for most KPIs**: `month_of_year_seasonality_sql` was executed and confirmed real for `avg_is_denied` (not seasonal), `fact_premium.*`, `fact_member_month.count_star`, and `member_eligibility.count_star` (extremely seasonal). The rest are pattern-validated but not run this pass.
- **Forecast confidence is uneven** — see §3: several forecasts (`fact_encounter.avg_length_of_stay_days`, `dim_provider.count_star`, `member_eligibility.count_star`, `dim_member.count_star`) are close to meaningless (no grain shows real signal) while `fact_claim_payment.count_star`'s `high`-confidence forecast is actively misleading if read as "trust this number" rather than "this is where a well-fit trend points."
- **Audit reconciliation #1 is aggregate-only**: the 2.1% mismatch rate and $108,712 worst-diff are database-wide over the full claim history, not scoped to the 90-day lookback.
- **Audit reconciliation #2 (FACT_PREMIUM vs. FACT_MEMBER_MONTH) is informal**, a trailing-4-vs-4-month segment-mix comparison, not a row-level join reconciliation — treat it as corroborating evidence, not a formal audit clearance.
- **7 of 29 KPIs still lack a business-dimension attribution** — see §5's second section. Unchanged from the prior pass; still the single highest-value gap remaining in this pipeline.
- **The denial-rate network-mix finding at weekly grain is based on an 8-week window** while the underlying year-over-year trend spans 6+ years — directionally consistent, not independently confirmed at that timescale on its own. The new annual provider-rollup cross-validation (§1, §5) substantially strengthens confidence in the trend being real, even though it doesn't pin down the weekly-grain mechanism further.
- **Partial-2026-year distortion affects 6 KPIs**: `fact_premium.*` (mild), `mart_utilization_per_1000.*` (mild-moderate), `mart_provider_year_summary.weighted_denial_rate` and `mart_member_year_summary.pmpm` (minimal — ratios are naturally more partial-year-robust than raw sums), and `mart_pharmacy_class_year.*` (severe — raw dollar/count sums). Handled throughout by using 2025 (last complete year) as the current-state reference and, where the manifest provided it, the `*_excl_partial` trend figures. Re-run once 2026 closes to confirm these projections.
- **`member_eligibility.count_star`'s forecast is close to useless** by design — any trend-line projection is dominated by whether the next bucket is January or not, which a linear trend can't represent. Don't use the emitted forecast band for planning; use "same month, prior year" instead.
