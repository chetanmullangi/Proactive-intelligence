# HEALTH_CARE — KPI Anomaly, Audit & Forecast Report

Generated 2026-09-11 by `snowflake-kpi-anomaly-detector` (run manually in-session against the manifest and its own spec — the custom subagent registered as an invokable type partway through this session; this pass still ran by hand to finish what was already in flight, but the registration means future runs can invoke it directly). Reads `reports/HEALTH_CARE/kpi_manifest.json` (generated_at 2026-09-11T06:30, well under the 7-day staleness bar). **15 KPIs** (13 from the original scope + 2 discovered by the profiler's new full-database scan: `dim_provider.count_star`, `bridge_provider_network.count_star`), native grain = week, 90-day lookback anchored per-table to that table's own `MAX(date_column)`.

**What changed since the last version of this report**: every KPI now carries a plain-language reading — a status, a reason, and a confidence note written for a claims manager or business stakeholder, with no statistics, thresholds, or database terminology in it. That's Part 1 below, and it's now the primary content of this report. All of the detailed statistical/technical work from earlier passes is preserved in Part 2, unchanged, for the data team.

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

**Claim Payments Disbursed ($)** — about $187,000 last week.
*Lower than usual — worth watching.*
The dollar amount paid out each week has been trending down for two months, in step with the drop in the number of payments going out — this is very likely the same story: fewer new claims entering the pipeline, not a payment-processing slowdown. We haven't independently double-checked the breakdown for the dollar figure yet, but it moves in lockstep with the payment count.
*We're confident in this reading — the underlying data here is fresh, updated within the last two weeks.*

**Pharmacy Claims Filled** — about 592 claims last week.
*Slightly higher than usual — worth watching.*
Pharmacy claims have been trending gently upward for a couple of months. We don't have a specific cause identified for this one yet — it would need a closer look.
*This is a solid estimate.*

**Claim Denial Rate** — about 13.9% of claims denied last week.
*Normal right now, but drifting higher over the longer term.*
Denials have been creeping up gradually over the past few years. A big part of it is that more claims are coming from out-of-network providers, and those get denied roughly twice as often as in-network claims — so as out-of-network claims become a bigger share of the mix, the overall denial rate rises with it.
*We're confident in this reading.*

**Total Allowed Amount** — about $349,000 last week.
*Normal right now, but worth watching.*
The total allowed amount looks steady overall, but underneath that, the amount allowed per standard, first-time claim has actually been dropping — even though the number of those claims is going up. In other words, we're processing more claims, but allowing less per claim on average.
*This is a solid estimate, though the underlying data is a couple months old.*

**Total Plan-Paid Amount** — about $300,000 last week.
*Normal right now, but worth watching.*
Same pattern as the allowed amount: the total paid looks steady, but the amount actually paid per standard, first-time claim has been dropping even as the number of those claims rises — so less is being paid out per claim on average.
*This is a solid estimate, though the underlying data is a couple months old.*

### Normal

| KPI | Last week | Status | The short version |
|---|---|---|---|
| Claims Submitted | ~417 claims | Normal | Claim volume is holding steady, with only a small, unremarkable uptick in first-time claims. |
| Total Billed Amount | ~$807,000 | Normal | Steady, aside from one one-time spike a few months back from a handful of large claims. |
| Claim Lines Submitted | ~1,126 lines | Normal | Tracks claim volume closely, which is stable. No specific cause breakdown yet. |
| Line-Level Plan-Paid Amount | ~$302,000 | Normal | Mirrors the claim-level total closely, as expected. No specific cause breakdown yet. |
| Encounters | ~318 visits/stays | Normal (upper end of usual range) | Tracking the rise in claims volume. No specific cause breakdown yet. |
| Avg Length of Stay | under a day, on average | Normal — no clear pattern | No consistent up-or-down pattern; likely diluted by non-overnight visits mixed into the average. |
| Pharmacy Plan-Paid Amount | ~$91,000 | Normal — just noisier than most | Bounces around week to week more than other numbers we track, but isn't trending up or down. |
| Providers Enrolled | 8 providers | Normal | This is a reference list that doesn't change often, not a live feed. Flat, with a small, low-volume uptick in specialists. |
| Provider–Network Contracts | 87 contracts | Normal | Another reference table that doesn't change often. Both active and ended contracts have stayed essentially flat. |

## What to expect next

- **Claim Payments Disbursed (#)**: expected to keep dropping next week unless something changes.
- **Claim Payments Disbursed ($)**: expected to keep declining as well, moving in step with the payment count above.
- **Pharmacy Claims Filled**: expected to keep rising slightly, continuing its gentle upward trend.
- **Claim Denial Rate**: expected to hold roughly steady week to week, though the longer-term upward drift is likely to continue.

Everything else is expected to stay in its normal range next week — no notable change anticipated.

## Data reliability notes

- **Claim Payments Disbursed (# and $)** are based on the freshest data in this review — updated within the last couple of weeks.
- **Most other numbers** — claims, claim lines, encounters, pharmacy claims — are based on data that's a couple of months old, not real-time. The readings above are still accurate for the period they cover, just not as current as the payment numbers.
- **Providers Enrolled** and **Provider–Network Contracts** are drawn from reference data that only changes occasionally by nature (new enrollments, new contracts) — being "older" doesn't mean anything is broken for these two.

---

# Part 2 — Technical Detail (Data Team Reference)

*Everything below is the statistical and technical record behind Part 1 — thresholds, trend fits, SQL-level attribution, and audit detail, for whoever maintains this pipeline or wants to verify a specific number. A business reader doesn't need anything past this point.*

## 1. Executive summary

- **`fact_claim_payment.count_star` is critical and getting worse — and now it has a real explanation.** The decline is concentrated entirely in **ORIGINAL (first-time) claim payments**, down 54% by count over 8 weeks, accounting for ~110% of the net decline (other claim types partially offset it). **Fewer new claims are entering the payment pipeline; payment processing itself is still working through the existing backlog** (replacement/resubmission payments on existing claims grew in the same period). This replaces the old "no strong explanation found" verdict.
- That decline still **reverses a 6-year growth trend** — monthly and yearly views of the same table both show real, positive growth across 2020–2026. The two findings combine: this isn't noise reverting to a mean, and it isn't a payment-processing failure — it looks like claims origination itself slowing.
- **Denial rate's year-over-year creep now has a driver too**: `OUT_OF_NETWORK` claims deny at ~2x the `IN_NETWORK` rate (18.2% vs 8.5% in the trailing 8 weeks) and are a growing share of claim volume (39.6%→43.2%). A network-mix shift plausibly explains part of the multi-year trend — worth validating against the full history, not just this 8-week window.
- **A quieter finding surfaced by the same backfill**: `ORIGINAL`-claim allowed and paid amounts are *falling* even as `ORIGINAL` claim *count* is *rising* — allowed/paid-per-claim is dropping. The native-grain "volatile, no clear trend" read never caught this; the dollar-amount KPIs looked flat only because a REVERSAL/REPLACEMENT correction pair happens to offset in the aggregate.
- **Claims and encounters reconcile cleanly overall** — header totals match summed line totals for 97.9% of claims — but 2,103 claims (2.1%) don't, including one $108,712 single-claim discrepancy worth a manual look.
- **Data freshness varies sharply by table**: only `FACT_CLAIM_PAYMENT` has current data (9 days old); the four core claims tables are 69–72 days stale. The 2 new KPIs (`DIM_PROVIDER`, `BRIDGE_PROVIDER_NETWORK`) are *very* stale by the numbers (2,445–2,645 days) but for a different reason — see the Freshness table below, don't read them as broken pipelines.
- **7 of the 15 KPIs still don't have a business-language attribution** — `medical_claim_line.*`, `fact_encounter.*`, `fact_claim_payment.sum_paid_amount`, `pharmacy_claim.*` — flagged explicitly in §5 rather than silently left blank.

## 2. Alerting board

Every row shows its `why` and `confidence` alongside the label — a verdict without a stated reason isn't a finished classification.

| Verdict | KPI | Value | Band | Confidence | Why |
|---|---|---|---|---|---|
| **CRITICAL** | `fact_claim_payment.count_star` | 88 | crit_lower 89.56 | **high** | Last full-week value sits at/past the critical fence; native trend strongly real and falling (r²=0.70); month/year grain both show real growth (r²=0.45/0.37) — a reversal, not noise. High confidence because the source table is fresh (9d stale) with 13 well-populated buckets. **Business reason (strong): decline concentrated in ORIGINAL claim payments — see §5.** |
| WARN | `pharmacy_claim.count_star` | 592 | warn_upper 589.64 | medium | Just past warn_upper (z≈3.23); native trend real (r²=0.20), month-grain stronger (r²=0.62) — a genuine if mild uptrend. Medium confidence: source table is 69 days stale. No business dimension breakdown yet. |
| watch (falling, inside band) | `fact_claim_payment.sum_paid_amount` | 187,039.29 | warn band [0, 497,459] | **high** | Native trend real and falling (r²=0.39) tracking the critical KPI above; month/year grain show real growth (r²=0.54/0.60) — same reversal pattern. Very likely shares `count_star`'s ORIGINAL-claim explanation (same table/join) but not independently backfilled yet. |
| stable | 11 of the remaining 12 KPIs | — inside warn — | — | medium | Source tables (`MEDICAL_CLAIM_HEADER`, `MEDICAL_CLAIM_LINE`, `FACT_ENCOUNTER`, `PHARMACY_CLAIM`) are 69–72 days stale — capped at `medium` regardless of how clean the native-grain numbers look. 5 of these now have real business-dimension findings (see §5); 5 don't yet. Per-KPI `why` and `business_reason` are in `KPI_CURRENT_STATE`. |
| stable, low signal | `fact_encounter.avg_length_of_stay_days` | 0.0692 | inside warn | medium | No real trend at any tested grain (native r²=0.04, month r²=0.006, year r²=0.10) — the "stable" label here means "no signal detected," not "confirmed steady." Likely diluted by non-inpatient zero-LOS rows. |
| stable, historical-dimension caveat | `dim_provider.count_star`, `bridge_provider_network.count_star` | 8 / 87 | inside warn | medium | Both genuinely flat at every grain tested. `days_stale` is very large (2,445–2,645d) but that reflects these tables being slowly-changing historical dimensions (enrollment/contract effective dates), not an ongoing operational feed going stale — see the Freshness table. |

**Freshness call-out** (unconditional, from Phase 0):

| Table | Days stale | Status | Note |
|---|---|---|---|
| `MEDICAL_CLAIM_HEADER` | 72 | Stale | Ongoing operational table — this staleness is a real pipeline signal |
| `MEDICAL_CLAIM_LINE` | 72 | Stale | Same |
| `FACT_ENCOUNTER` | 72 | Stale | Same |
| `PHARMACY_CLAIM` | 69 | Stale | Same |
| `FACT_CLAIM_PAYMENT` | 9 | Fresh | — |
| `DIM_PROVIDER` | 2,645 | Stale (by design) | Slowly-changing dimension; `ENROLLMENT_DATE` is historical by nature, not a live feed |
| `BRIDGE_PROVIDER_NETWORK` | 2,445 | Stale (by design) | Same — `EFFECTIVE_DATE` reflects historical contract data |

`FACT_CLAIM_PAYMENT` is the only *operational* table still receiving current-dated rows. The two new dimension/bridge tables' staleness numbers are technically correct but mean something different — flagging that distinction explicitly is exactly why the freshness check has to be read with judgment, not just a threshold.

**Error & quality rates call-out** (unconditional, from `kpi_class = error_rate`): `medical_claim_header.avg_is_denied` — currently stable/inside-warn at native grain, listed here regardless per its class. Now has a real business reason — see §5.

## 3. Forecasts

Default method: trend-projected band (native-grain slope ± 1.4826×MAD), 4 buckets (weeks) ahead. Forecast confidence is capped by native-grain fit: `r² < 0.1` caps it `low` regardless of longer-grain trend strength, `r² ≥ 0.3` with `high` baseline confidence allows `high`, everything else lands `medium`.

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
| `fact_encounter.avg_length_of_stay_days` | 0.0725 | [0.0407, 0.1043] | low | trend_band (no grain shows real signal) |
| `fact_claim_payment.sum_paid_amount` | 166,030 | [80,501, 251,559] | **high** | recommend_ml_forecast |
| `fact_claim_payment.count_star` | 68.7 | [18.3, 119.2] | **high** | recommend_ml_forecast |
| `pharmacy_claim.count_star` | 595 | [585, 605] | medium | recommend_ml_forecast |
| `pharmacy_claim.sum_plan_paid_amount` | 92,418 | [75,484, 109,352] | low | recommend_ml_forecast |
| `dim_provider.count_star` | 8.1 | [5.9, 10.3] | low | trend_band (no grain shows real signal) |
| `bridge_provider_network.count_star` | 85.5 | [81.1, 90.0] | medium | trend_band (native r²=0.15, close to but under the ML-recommend bar) |

**High forecast confidence does not mean "trust this number"** — it means "the trend behind this projection is real and well-supported." **Read `fact_claim_payment.count_star`'s forecast with real caution**: it's mechanically projecting the recent decline further down (68.7 next week) without knowing whether that decline continues, bottoms out, or reverts — now that §5 explains the decline as an ORIGINAL-claims slowdown rather than an unknown cause, the more useful question is whether new-claim origination itself is expected to recover, which this trend-band number can't answer. Still the best candidate in this database for an actual `SNOWFLAKE.ML.FORECAST` model.

## 4. Audit & reconciliation

**Cross-table reconciliation** — `medical_claim_header.sum_total_plan_paid_amount` vs. `SUM(medical_claim_line.plan_paid_amount)`, joined on `CLAIM_ID` (manifest correlation r=0.9998, n_overlap=14 — passes the ≥8-bucket validity gate comfortably):

- 99,271 claims checked, 2,103 mismatched (**2.12% mismatch rate**), worst single-claim discrepancy **$108,712.14**.
- The two tables reconcile cleanly for the large majority of claims. The 2.1% that don't, and especially the $108K outlier, are worth a manual reconciliation pass — could be legitimate adjustment/COB claims or a real data issue; this report can't distinguish the two without looking at the specific claims.

**Duplicate signal** (`IS_DUPLICATE_FLAG`):

| Table | Duplicate rate |
|---|---|
| `MEDICAL_CLAIM_HEADER` | 0.45% (444 / 99,271) |
| `MEMBER_ELIGIBILITY` | 0.39% (56 / 14,271) |

Both low. Not a driver of the volume/dollar KPIs on these tables this run.

**Key completeness**: `CLAIM_ID` and `MEMBER_ID` on `MEDICAL_CLAIM_HEADER` — 0 nulls out of 99,271 rows. Clean.

## 5. Attribution hypotheses — business language, not statistics

**The rule this section follows**: every reason here is a business explanation of what actually changed in the underlying records — a segment, a category, a mix shift, with real before/after numbers. A statistic (r², z-score) is never presented as a reason; it belongs in §2/§3, not here. Where the manifest has a `dimension_breakdown` for a KPI, that drives the finding. Where it doesn't, this section says so explicitly rather than falling back to statistical language dressed up as an explanation.

### KPIs with a real business-dimension finding (8 of 15)

**`fact_claim_payment.count_star` (critical) — strength: strong.** Joining `FACT_CLAIM_PAYMENT` to `MEDICAL_CLAIM_HEADER` via `CLAIM_ID` and splitting by `CLAIM_TYPE` (trailing 4 weeks vs. the 4 weeks before that):

| Claim type | Baseline | Recent | Delta |
|---|---|---|---|
| **ORIGINAL** | 1,006 payments · $1,143,309 | 466 payments · $598,554 | **−$544,755** |
| REPLACEMENT | 35 · $38,953 | 42 · $126,800 | +$87,846 |
| REVERSAL | 36 · −$40,685 | 40 · −$116,892 | −$76,207 |
| RESUBMISSION | 54 · $39,374 | 66 · $76,822 | +$37,447 |

ORIGINAL alone accounts for ~110% of the net ~$495,668 decline (the other three categories partially offset it). **Fewer new claims are entering the payment pipeline; the system is still actively processing corrections, resubmissions, and reversals on the existing backlog.** This points at claims *origination* slowing, not payment *processing* breaking. `AUDIT_LOAD_LOG`/`DQ_RULE_RESULT` would be the next place to check *why* origination slowed — not examined this pass.

**`medical_claim_header.avg_is_denied` (error-rate creep) — strength: strong.** Split by `PROVIDER_NETWORK_STATUS`:

| Network status | Baseline denial rate | Recent denial rate | Share of claim volume |
|---|---|---|---|
| OUT_OF_NETWORK | 15.9% | 18.2% (+2.2pp) | 39.6% → 43.2% |
| IN_NETWORK | 7.9% | 8.5% (+0.5pp) | 60.4% → 56.8% |

Out-of-network claims deny at roughly 2x the in-network rate, and they're becoming a larger share of total volume. A network-mix shift plausibly explains part of the multi-year denial-rate creep found in §3 of the profile report — this 8-week window is directionally consistent with that longer trend, though it's too short on its own to confirm the full multi-year story.

**`medical_claim_header.sum_total_allowed_amount` — strength: strong.** Split by `CLAIM_TYPE`: `ORIGINAL`-claim allowed amount fell **$176,812** (baseline $1,497,156 → recent $1,320,345), ~111% of the net ~$159,071 decline, *even as* `ORIGINAL` claim count rose. **Allowed-per-claim is genuinely dropping for standard claims** — a tighter-adjudication signal, not a volume effect. The native-grain KPI reads as merely "volatile" because `REVERSAL`/`REPLACEMENT` correction entries (+$87,058/−$74,592) partially mask it in the aggregate.

**`medical_claim_header.sum_total_plan_paid_amount` — strength: strong.** Same pattern: `ORIGINAL`-claim plan-paid amount fell **$170,856** (~110% of the net ~$154,865 decline), paid-per-claim dropping for standard claims, masked in aggregate by the same correction pair.

**`medical_claim_header.count_star` — strength: strong (but small in absolute terms).** Split by `CLAIM_TYPE`: the KPI is genuinely stable overall (native r²=0.05); the modest net change that exists (+140 claims over 8 weeks, ~5% of typical volume) is concentrated in `ORIGINAL` claims (+129). This is organic drift, not an anomaly — flagged as "strong" by the same-category-explains-most-of-the-change rule, but the underlying magnitude is small enough that it shouldn't be read as a finding worth acting on by itself.

**`medical_claim_header.sum_total_billed_amount` — strength: weak.** Split by `CLAIM_TYPE`: no category shows a decisive move. A `REVERSAL`/`REPLACEMENT` correction pair offsets to roughly zero net effect (~$208K swing each way — a normal correction pattern, not a real signal), and `ORIGINAL` billed amount is essentially flat (+3.8%).

**`dim_provider.count_star` — strength: weak.** Split by `PROVIDER_TYPE`: `SPECIALIST` enrollments moved most (+12, from 4→16) but off a very low base — not statistically meaningful at this volume. Genuinely stable, consistent with its own classification.

**`bridge_provider_network.count_star` — strength: weak.** Split by `PARTICIPATION_STATUS`: `PARTICIPATING` and `TERMINATED` contract counts are both essentially flat (314→325, 36→37). No meaningful mix shift.

### KPIs still without a business-dimension finding (7 of 15)

No `dimension_breakdowns` exist yet in the manifest for these — that's a coverage gap from before the field existed, not a "nothing to find" result, and they're listed here rather than silently omitted:

- `medical_claim_line.count_star`
- `medical_claim_line.sum_plan_paid_amount`
- `fact_encounter.count_star`
- `fact_encounter.avg_length_of_stay_days`
- `fact_claim_payment.sum_paid_amount` — **cheapest win available**: this KPI shares `count_star`'s table and join; the `CLAIM_TYPE` breakdown almost certainly mirrors the ORIGINAL-claims finding above, it just hasn't been independently computed and validated yet.
- `pharmacy_claim.count_star`
- `pharmacy_claim.sum_plan_paid_amount`

Priority order for the next profiler backfill pass matches the manifest's `discovery_note`.

## 6. Data quality & confidence

| KPI | Confidence | Why not higher (if applicable) |
|---|---|---|
| `fact_claim_payment.sum_paid_amount` | **high** | — fresh table (9d stale), 13 buckets, real trend fit |
| `fact_claim_payment.count_star` | **high** | — fresh table (9d stale), 13 buckets, strongest trend fit in the database |
| `dim_provider.count_star` | medium | Table is a slowly-changing dimension — extreme `days_stale` (2,645d) is by design, not a broken pipeline, but the confidence rule can't distinguish that automatically, so it's capped at medium like any other stale-table KPI |
| `bridge_provider_network.count_star` | medium | Same reasoning, `days_stale`=2,445d |
| all other 11 KPIs | medium | Source table stale 69–72 days vs. the 14-day threshold — every reading described elsewhere in this report reflects late June/early July, not today, regardless of how clean the underlying numbers are |

No KPI this run landed at `low` confidence or failed validation (`validated = true` for all 15). Full per-KPI distribution stats, month/year trend figures, and `validation_notes` are in `HEALTH_CARE.ANALYTICS.KPI_BASELINE` (this run's `run_ts`).

Threshold method for every KPI this run: robust z (median ± k×1.4826×MAD, k=3 warn / 3.5 crit) — no KPI's native-grain `|r²|` reached the 0.3 bar that would switch its band to EWMA, though `fact_claim_payment.count_star` (r²=0.70) and `.sum_paid_amount` (r²=0.39) are flagged in `KPI_CURRENT_STATE` as better suited to EWMA than the static bounds shown in §2. All directionality calls (`both`/`high_bad`/`low_bad`) are inferences from column semantics, not confirmed — confirm with the business owner before wiring alerts to act on the low/high side asymmetrically.

## 7. Emitted artifacts

**Metric batch configs** (top 5 by severity/priority, not all 15 — ask if you want more, including the 2 new KPIs, though neither currently ranks high enough by severity to be an obvious priority):
- `metrics/fact_claim_payment_count/{.sql,.yaml}`
- `metrics/fact_claim_payment_paid_amount/{.sql,.yaml}`
- `metrics/pharmacy_claim_count/{.sql,.yaml}`
- `metrics/medical_claim_denial_rate/{.sql,.yaml}`
- `metrics/medical_claim_billed_amount/{.sql,.yaml}`

**For viewing**: `HEALTH_CARE.ANALYTICS.KPI_CURRENT_STATE` refreshed for this run's `run_ts` — **15 rows**, one per KPI, now carrying `business_reason` / `business_reason_dimension` / `business_reason_strength` alongside the existing current value, state, thresholds, directionality, forecast, audit status, and `relevant_for` tags. Point any BI tool at this table for a live current-state dashboard with real business explanations built in, not just statistical flags; it's additive across runs (never overwritten).

## 8. Caveats

- **Manual run, but the subagent is now registered** — this pass was still executed by hand to finish work already in flight against a manifest that changed mid-session, but `snowflake-kpi-anomaly-detector` is now an invokable subagent type; future runs can call it directly rather than simulating it.
- **`ACCOUNT_USAGE` latency/retention**: up to ~3hr latency, ~365-day retention (inherited from the manifest).
- **Seasonality claims are thin**: `month_of_year_seasonality_sql` was executed for one KPI only (`avg_is_denied`); the rest are pattern-validated but unrun.
- **Forecast confidence is uneven** — see §3: `fact_encounter.avg_length_of_stay_days` and `dim_provider.count_star`'s forecasts are close to meaningless (no grain shows `r² > 0.1`) while `fact_claim_payment.count_star`'s `high`-confidence forecast is actively misleading if read as "trust this number" rather than "this is where a well-fit trend points."
- **Audit reconciliation is aggregate-only**: the 2.1% mismatch rate and $108,712 worst-diff are database-wide over the full claim history, not scoped to the 90-day lookback or to specific weeks.
- **7 of 15 KPIs still lack a business-dimension attribution** — see §5's second section. This is the single highest-value gap remaining in this pipeline.
- **The denial-rate network-mix finding (§5) is based on an 8-week window** while the underlying year-over-year trend spans 6+ years — directionally consistent, not independently confirmed at that timescale. Worth a dedicated check against the full history before treating it as settled.
- **`relevant_for` tagging is a first pass** — follows the agent's Phase 4 rule mechanically and hasn't been reviewed by a business owner for whether it matches how these KPIs actually get used.
