# Proactive Intelligence

Point it at a Snowflake database and every day it works out what the data means, watches every KPI, explains movements
in business terms, traces who is affected downstream, projects what is coming, and warns the owning departments.

## How it works

| Layer | What | Command | Owner |
|---|---|---|---|
| 1 Understand | Every table: meaning, grain, business dates, role, suggested department; one profile query per table, unchanged tables skipped | `py -3.12 -m pi profile` | profiler agent reviews |
| 4a Connect | Lineage observed in query history (temp tables collapsed), keys validated by containment, source -> warehouse copies | (part of `profile`) | engine |
| 0 Measure | KPIs discovered from the catalog (counts, amounts, rates, averages, turnaround days, members in force, starts/ends), kept as a daily summary; daily maintenance re-aggregates only a restatement window sized from how late data really arrives; weekly reconciliation against raw totals | `py -3.12 -m pi kpis` | engine |
| 2 Processes | Claim -> payment, denial -> appeal, authorization -> claim, claim -> correction: conversion and delay (Kaplan-Meier, so new processes are measured correctly) | `py -3.12 -m pi process` | engine |
| 3 Judge | Completeness-aware baselines (recent periods still filling in are scaled or not judged), out-of-sample noise, two-pass outlier cleaning, comparisons (7/28 days, month, quarter, year to date vs prior and last year), freshness, data checks | `py -3.12 -m pi analyze` | engine |
| 4b Links | KPIs that move together or lead (lags 0-8 weeks), kept only if significant, stable and backed by a business pathway | (part of `analyze`) | engine |
| 7 Explain | Driver breakdown by every business dimension (disproportionate concentration), candidate business causes, upstream KPIs, data problems, downstream impact | `py -3.12 -m pi explain` | detector agent writes the reason, checks the real world |
| 5-6 Project | Forecasts chosen by backtest vs a naive guess (incl. LightGBM), this- and next-quarter outlook (revenue, cost, MLR, PMPM, membership), order book (open items x learned delays, self-checked 4 weeks later), scheduled starts/ends | `py -3.12 -m pi project` | risk agent |
| 8 Warn | Ranked warnings: what, why, impact, owners, timing, $ at stake; new / continuing / resolved | `py -3.12 -m pi warn` | agents annotate (`pi annotate`) |
| App | `web/` reads `web/public/data/*.json` | `py -3.12 -m pi export` | |

Everything: `py -3.12 -m pi daily`. Results live in `HEALTH_CARE.ANALYTICS` (the only schema the engine writes) and
`reports/HEALTH_CARE/pi/`. Settings: `config/pi.yaml`; business judgement (names, departments, corrections, executive
tags): `config/semantic_overrides.yaml` (maintained by the profiler agent). Readable listings: `py -3.12 -m pi show ...`;
downstream of anything: `py -3.12 -m pi impact <TABLE or KPI>`.

The simulator's answer-key schemas (`SIMULATION_CONTROL`, `DATA_GOVERNANCE`, `*_PRE_SIMULATION`) are excluded so the
framework can be graded against them honestly.

## Agents (`.claude/agents/`)
- `snowflake-data-profiler` - runs layers 1, 0, 2; names, describes and assigns owners; fixes roles and dates.
- `snowflake-kpi-anomaly-detector` - runs 3, 7, 8; writes business reasons with real-world sources and confidence.
- `snowflake-risk-predictor` - runs 5-6, 8 and row-level ML (`ml/`); explains what is coming and who must prepare.
- `snowflake-kpi-analyst` - answers questions over all of it.

Daily: Windows task `ProactiveIntelligence-Daily` at 07:30 runs `scripts/run_daily.ps1` (engine, then headless Claude
`/pi-daily`, then export). Previous agent definitions: `legacy/agents_2026-09-24/`.

## App
`cd web && npm install && npm run dev` (Node may need `C:\Program Files\nodejs` on PATH). Pages: Overview (quarter
outlook, what needs attention, departments), Warnings, KPIs, Impact map, Data & departments, Data health, Accuracy.
`npm run smoke` renders every page with the current data. The previous KPI Signal app is `web/src/App.jsx` (unused).

## Tests
`py -3.12 -m unittest tests.test_pi`
