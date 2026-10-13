# HEALTH_CARE - profile report

Run date 2026-10-12 (data as of 2026-10-11). Engine: `py -3.12 -m pi` (setup, profile, kpis, process). Business overrides: `config/semantic_overrides.yaml` (first written this run). Answer-key schemas (SIMULATION_CONTROL, DATA_GOVERNANCE, *_PRE_SIMULATION) were not read.

## What the database contains

HEALTH_CARE holds the data of a health plan: Medicare, Commercial, Medicaid and Exchange members (about 2,050 in force, 3,096 ever), their coverage spans and member months (2020-01 to 2026-10), premium billing, about 104k medical claims (294k service lines), 145k pharmacy claims, 78k claim payments, 82k encounters, plus prior authorizations (407, from 2026-06), appeals (32, from 2026-08) and member grievances (47, from 2026-07). There are two copies of most data:

- `CORE_ADMIN`: the operational source systems (claims engine QNXT/EDI, PBM, treasury, enrollment hub, member services, UM, provider master).
- `MAIN`: the warehouse (facts, dimensions, reference lists) plus five marts (member-year cost, drug class by year, plan PMPM by month, provider by year, utilization per 1,000).
- `ANALYTICS`: the engine's own results.

There are 56 tables, grouped by role:

| Role | Count | Notes |
|---|---|---|
| Fact | 21 | 10 in MAIN and 11 in CORE_ADMIN. 9 of the CORE_ADMIN facts are superseded source copies |
| Dimension | 13 | |
| Span | 5 | |
| Mart | 5 | |
| Reference | 8 | |
| Audit | 2 | |
| Bridge | 1 | |

19 tables are KPI sources. 12 CORE_ADMIN tables are source copies superseded by their warehouse twin.

## Departments and what they own

| Department | Tables (warehouse; the source copy has the same owner) |
|---|---|
| Claims Operations | Medical claims, Medical claim lines, Claim diagnoses, Claim status changes (CORE_ADMIN), claim status / denial / diagnosis / procedure / place-of-service codes |
| Finance | Claim payments, Provider payment remittances (CORE_ADMIN), Premium billing, Plan financials PMPM mart, Member cost-and-use-by-year mart |
| Enrollment & Eligibility | Member eligibility spans, Member months, Members, Subscribers, Employer groups |
| Pharmacy | Pharmacy claims, Pharmacy spend by drug class mart, Drug list |
| Provider Network | Providers, Provider locations, Provider networks, Network participation, Provider billing-by-year mart |
| Utilization Management | Patient encounters, Prior authorizations, Utilization per 1,000 mart |
| Appeals & Grievances | Appeals, Member grievances |
| Care Management | Member health profiles (CORE_ADMIN) |
| Product & Benefits | Plans, Products, Benefit designs |
| Data Platform | Warehouse load log, Data quality results, Calendar, Source systems |

## How data flows

This comes from query history (33 observed loads) and 149 validated keys (5 candidate keys were rejected).
- **Source to warehouse:** each CORE_ADMIN table loads into its MAIN twin: claims, lines, diagnoses, payments, appeals, grievances, encounters, pharmacy, premium, prior auth, eligibility, network contracts. Provider payment remittances also feed Claim payments.
- **Warehouse to marts:** Medical claims, Pharmacy claims, Premium billing, Member months and Plans feed *Plan financials PMPM*. Pharmacy claims feed *Pharmacy spend by drug class*. Eligibility feeds Member months.
- **Loads in the reverse direction:** query history also shows loads from MAIN into CORE_ADMIN: Medical claims to Claim status changes and to the encounter detail table, Dim provider to Provider, Eligibility to Member, and Dim member to Subscriber. These are probably the data generator writing the source tables from warehouse state. That is not a normal production direction, so treat these edges with care (see open questions).

### Business processes (learned from keys and dates, Kaplan-Meier)

| Process | Conversion | Typical delay (90% within) | Verdict |
|---|---|---|---|
| Medical claim -> payment | 76.9% | 12 days (17) | Real: the core claim-to-cash process |
| Medical claim -> corrected claim | 7.3% | 23 days (63) | Real: resubmissions and replacements |
| Denied claim -> corrected claim | 37.5% | 43 days (67) | Real: providers fix and rebill denials |
| Medical claim -> appeal | 1.4% | 28 days (39) | Real |
| Denied claim -> appeal | 9.4% | 33 days (43) | Real: denial-to-appeal |
| Prior authorization -> claim | 88.4% | 14 days (27) | Real: authorized care is billed |
| Partially approved authorization -> claim | 11.7% | 4 days (4) | Plausible. Small sample (35) |
| Paid claim -> corrected claim | 0.04% | 0 days | **Not a meaningful process.** Near-zero and same-day, probably reversal/version rows |
| Encounter -> medical claim | 99.9% | 9 days (24) | **Not a separate process.** Encounters are built from claims (same source system), so this measures the load and not a business step |
| Encounter (home health / SNF discharge) -> claim | 70% / 60% | 6-7 days | Same caveat: derived from claims |
| Member month -> medical claim / pharmacy claim / encounter | 36% / 47% / 35% | 21 / 9 / 11 days (window ~709 days) | **Not processes.** These are utilization rates joined on member-month key; useful as "share of member months with use" but not a conversion |

## How late data arrives (completeness curves)

- **Medical claims** (visit to receipt, measured 2024-09..2025-09): 50% of claims arrive within 11 days of the visit, 90% within 33 days and 99% within 179 days. Paid dollars arrive later (50% within 17 days, 90% within 53, 99% within 216) because large claims come late. A decision follows within 28 days for 50% (82 days for 90%). Claim lines and encounters inherit these curves. **Recent weeks of any visit-dated claim KPI are incomplete for about 1-2 months.**
- **Premium**: posted in the coverage month (50% and 90% within 0 days, 99% within 71 days for retro adjustments). Member months and the PMPM mart inherit this curve.
- **Prior authorizations**: request to decision 4 days at the median, 9 days for 90%, 30 days for 99%.
- **No curve exists for** pharmacy claims (no arrival column; paid date only), claim payments (payment date is the event), appeals, grievances and eligibility. The eligibility record-created date was set as its arrival date this run, but the engine still produced no curve for spans.

## KPIs

**Before this run** there were 146 live KPIs with auto-generated names.

**After this run** there are 127 live KPIs:
- Every live KPI has a plain business name, a one-sentence description and a direction.
- 7 KPIs are custom, written by the profiler with correct denominators.
- 7 KPIs were removed because their tables are no longer KPI sources.
- 19 KPIs were disabled with a reason.
- 5 KPIs were dropped by the engine's constant-rate rule.

**Executive tags** (exactly one KPI each, confirmed):

| Tag | KPI |
|---|---|
| revenue | Premium billed (`fact_premium.sum.billed_premium_amount`) |
| medical_cost | Medical claims paid (`medical_claim_header.sum.total_plan_paid_amount`) |
| pharmacy_cost | Pharmacy claims paid (`pharmacy_claim.sum.plan_paid_amount`) |
| member_months | Member months (`fact_member_month.sum.member_month_count`) |
| membership | Members in force (`member_eligibility.active`) |

Members in force is about 2,053 eligibility spans on 2026-10-01, against 2,047 distinct members. Six members have overlapping spans, which is negligible.

**Table corrections**
- Member health profiles changed to `dimension`: one row per member, a profile snapshot.
- CORE_ADMIN Member changed to `dimension`.
- Employer groups (CORE_ADMIN) set `kpi_source: false`: all 104 groups start 2020-01-01 and none has ended.
- Provider locations set `kpi_source: false`: a static address list.
- Member eligibility: event date set to EFFECTIVE_DATE and arrival date to RECORD_CREATED_DATE. The engine had picked the record-created date as the event.

**Disabled KPIs** (reason kept as a YAML comment):
- **Complements of another KPI**: in-network share, appeals in review, appeals upheld and grievances open. Each is 1 minus a KPI that is kept.
- **Duplicates**:
  - Member month record count, because MEMBER_MONTH_COUNT is always 1.
  - Pharmacy reversal transactions, because they are one-for-one with reversed claims.
  - Pharmacy reversal flag, which equals reversed plus reversal transactions.
- **Never moves**: new providers enrolled. All enrollment dates are between 2011 and 2019-06.
- **Wrong denominator**: the 4 discharge-status shares were divided by all encounters, but only inpatient and SNF stays have a discharge status. They are replaced by custom in-hospital death, discharged-home, home-health and SNF rates.
- **Undecided rows counted as late**: the on-time flags for appeals, grievances and prior authorizations count undecided rows (null flag) as late. They are replaced by custom on-time rates dated by decision or resolution date. Evidence: the engine showed appeals 19/32 = 59% on time, but all 19 decided appeals were on time.
- **0% or 100% by construction** after the engine started dating status shares by decision date:
  - Medical claims pended, replaced by a custom pended share dated by receipt date.
  - Prior authorizations pending.
  - Appeals closed.
  - Grievances resolved.

**Custom KPIs added**:
- Medical claims on hold (pended).
- In-hospital death rate.
- Stays discharged home.
- Stays discharged to home health care.
- Stays discharged to a nursing facility.
- Grievances resolved on time.
- Prior authorizations decided on time.
- Appeals decided on time is defined but currently dropped by the engine (it has been 100% so far).

**Kept with caveats**:
- The yearly mart KPIs (member-year, drug class, provider-year, utilization per 1,000) have about 7 points each and stay at "insufficient history". They are useful mainly as a cross-check against the facts.
- "Members with prescriptions" and "Patients seen" add up members across classes or providers, so members are counted more than once.

## Data observations worth a look

- **Future dates on medical claims**: 76 claims (74 originals) have received/submission dates from 2026-10-16 to 2027-04-10, and 147 claims have adjudication dates after today. The same future dates appear in claim status changes. They count in "Average days from visit to claim receipt" and in the decision-dated rates.
- **Pharmacy dates**: 201 pharmacy claims have a paid date after today (up to 2026-10-18), and 345 are paid before their fill date.
- **Negative amounts** exist on claims, lines, pharmacy and premium. They match reversals, recoupments and retro adjustments, so this is expected.
- **Members in force** is currently flagged "attention" by the earlier analyze run. That is for the anomaly detector to judge.

## Could not determine / open questions

1. **Reverse-direction loads.** Are the MAIN-to-CORE_ADMIN loads real, or an artefact of how the source tables are generated? If they are real, CORE_ADMIN Claim status changes is downstream of the warehouse and not a source.
2. **Provider payment remittances.** Are they the same money as Claim payments? The engine dropped the remittance dollar total as an exact twin of claim payments, which suggests yes. I kept only the remittance count.
3. **Member months completeness.** Member months inherits its arrival curve from premium posting. I am not certain eligibility-derived member months arrive on that schedule.
4. **Appeal on-time rate.** It can't be measured while every decision has been on time, because of the constant-rate drop (see engine issues).
