---
description: Daily Proactive Intelligence run - engine refresh, then the agents explain and project in business language
---
Run today's Proactive Intelligence cycle for HEALTH_CARE. The engine (`py -3.12 -m pi daily`) has normally already run
from `scripts/run_daily.ps1`; if `py -3.12 -m pi status` shows today's `warn` step missing or failed, run
`py -3.12 -m pi daily` first.

1. If today is Monday, or `py -3.12 -m pi status` shows the `catalog` step profiled new or changed tables, launch the
   `snowflake-data-profiler` agent (it reads `.claude/agents/snowflake-data-profiler.md`) and wait for it.
2. Launch the `snowflake-kpi-anomaly-detector` agent and wait for it.
3. Launch the `snowflake-risk-predictor` agent and wait for it.
4. Run `py -3.12 -m pi export` and `py -3.12 -m pi status`.

Agents never read SIMULATION_CONTROL, DATA_GOVERNANCE or *_PRE_SIMULATION. Report in 5 lines: warnings by severity,
the top 3 in plain language, and anything that failed.
