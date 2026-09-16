# Session Handoff — Proactive Intelligence (HEALTH_CARE pipeline + KPI Signal frontend)

Written because the previous session's token budget ran out mid-task. Everything below is verified against the actual files/DB, not recalled from memory.

## 1. Overall goal of this session

Two threads, both still open:

**A. Make the "KPI Signal" web app (`web/`) genuinely business-facing.** It's a React/Vite dashboard over a Snowflake `HEALTH_CARE` claims database, built by an earlier session to show plain-language KPI health + a proactive risk brief to non-technical / executive readers (CEO-level audience). This session's job was to strip out anything that still read like a data-science report and replace it with real business narrative, visual design, and cross-linking.

**B. Fix a real data-coverage gap the user caught.** The KPI/risk pipeline only ever profiled 7 of 37 tables in `HEALTH_CARE.MAIN`, and used a hardcoded 90-day lookback window that silently disqualifies monthly-grain data (like premiums) from ever becoming a KPI. The user explicitly wants **all** tables profiled and **no arbitrary frequency/lookback restriction**, especially for payment/premium data. This is in progress — see §3.

The user has also been repeatedly clear (see `memory/feedback_rigor_and_verification.md` if available) about **never fabricating data or plausible-sounding findings** — every UI change this session pulled from real pipeline output, and every gap was reported as a gap rather than invented.

## 2. What's been completed so far (thread A — verified working, build passes)

All of this is in `web/`, builds clean with `npm run build`, and was hot-reloading correctly on a dev server at `http://localhost:5174/` earlier in the session (may need restarting — see §4).

- **Removed all statistics/model-jargon from user-facing screens.** Deleted the "Show/Hide technical details" toggle and its entire panel (ROC-AUC, PR-AUC, Brier, training rows, z-scores, r², table/column names) from both KPI detail pages and Risk Brief cards. Deleted the now-fully-dead components: `ReasonsList.jsx`, `FollowUpPanel.jsx`, `ProjectionPanel.jsx`, `DetectionSidebar.jsx`, `CorrelatedSidebar.jsx`, and their orphaned CSS classes in `index.css`.
- **Rewrote `web/src/data/kpis.js`**: every KPI now has plain `issue` / `cause` / `action` fields (business English, no stats) rendered by `KpiDetail.jsx` as "What's happening / Why / Bottom line - what to do."
- **Rewrote `web/src/data/risks.js`** to a 7-part structure per risk (headline → what's happening → why → what it's costing → what to do [numbered, with role/deadline/queue] → what good looks like/target date → confidence line). Also fixed a real terminology confusion the user hit: "resubmitted claim" vs "replacement claim" are now explicitly distinguished and defined inline.
- **Redesigned `RiskCard.jsx` visually** — colored left accent bar by impact, inline SVG icons per section, two-column stat layout, numbered action-item mini-cards, a highlighted goal/target strip. No longer a wall of labeled paragraphs.
- **Cross-linked KPIs ↔ Risks.** Added `relatedRiskIds` to specific KPIs (`denial-rate`, `payment-amount`, `payment-count`, `pharmacy-count`, `pharmacy-paid`) and matching `relatedKpiIds` on the 3 risk entries. `KpiDetail.jsx` now has a "Related" section linking to correlated KPIs and related risks; `RiskCard.jsx` has a "Related KPI" pill row. Navigation wired through `App.jsx` (`onOpenKpi`/`onOpenRisk` props threaded down).
- **Removed the "Bottom line" ranked-summary block** from the bottom of `RiskBrief.jsx` per explicit user request (it was redundant with the per-card content).
- **Added `FlagsPanel.jsx` + `web/src/data/flags.js`** — a new "Flagged for review" section on the KPI Portfolio landing page, distinct from both KPI findings and the Risk Brief. Surfaces 4 real data-quality issues pulled from existing audit checks already in `kpis.js` (duplicate claims 0.45%, header/line payment reconciliation mismatch 2.1% worst-case $108K, an unverified May-4 cost spike, and a staleness mismatch between claims data (~72 days stale) and payment data (~9 days stale)). Each flag has a **"Mark resolved" / "Reopen" toggle**, persisted via the existing `usePersisted` localStorage hook (key `resolvedFlags`) — this is the user-facing "flag it as checked / no need to look further" mechanism that was explicitly requested.
- **Cleaned up dead state in `App.jsx`** left over from the deleted technical-details UI (`open`, `reviewed`, `toggleReason`, `reviewedCount`).
- Answered (not yet re-verified after latest changes) the user's "why isn't claims-payment-decline in the Risk Brief" question: it's a genuine model-scope limitation — row-level risk models can only score claims that exist; a volume *drop* (fewer claims submitted) isn't a bad-row outcome a classifier can flag. This was explained in chat, not hidden — no fake risk card was added to paper over it.

## 3. Active / unfinished work (thread B — data coverage gap)

**The core problem** (confirmed directly against Snowflake via `mcp__snowflake__list_objects`): `HEALTH_CARE.MAIN` has 37 tables; the KPI manifest (`reports/HEALTH_CARE/kpi_manifest.json`) only covers 15 KPIs across 7 tables. Notably **`FACT_PREMIUM`** (139,579 rows — the actual premium/payment table the user is asking about) has never been profiled or given thresholds, nor has `FACT_MEMBER_MONTH`, `MEMBER_ELIGIBILITY`, `FACT_CLAIM_DIAGNOSIS`, or the pre-aggregated `MART_*` summary tables (`MART_PMPM_PLAN_MONTH`, `MART_UTILIZATION_PER_1000`, `MART_PROVIDER_YEAR_SUMMARY`, `MART_MEMBER_YEAR_SUMMARY`, `MART_PHARMACY_CLASS_YEAR`) which likely already contain ready-made standard health-insurance KPIs (PMPM = per-member-per-month cost).

I also found, reading the existing manifest's own "not considered" notes, that this is a **known, self-inflicted bug**: `FACT_PREMIUM` and `FACT_MEMBER_MONTH` are monthly-grain tables, and the profiler's hardcoded 90-day lookback window only ever yields ~3 monthly buckets — below its own 12-bucket viability threshold — so they get auto-excluded by the tooling itself, not because the data is bad. This is exactly the "frequency shouldn't be restricted" issue the user flagged.

**What I did:** launched the `snowflake-data-profiler` subagent in the background with explicit instructions to (a) profile every substantive table not already covered, specifically calling out `FACT_PREMIUM` and the others above, (b) drop the 90-day lookback cap for new KPIs and use full history instead (matching what `monthly_trend_sql`/`yearly_trend_sql` already do), while keeping the existing 15 KPIs intact.

**What happened:** the agent run **failed** — it exceeded the 64,000 output-token limit per response (error: `max_output_tokens`) partway through. Per its last status line, it had validated `FACT_MEMBER_MONTH` and was about to move on to `MEMBER_ELIGIBILITY`, `FACT_CLAIM_DIAGNOSIS`, `DIM_MEMBER`, `DIM_PROVIDER_LOCATION`, `MART_PMPM_PLAN_MONTH` when it died.

**Verified: nothing was actually written to disk before the crash.** `reports/HEALTH_CARE/kpi_manifest.json` and `profile_report.md` both still have their old timestamps (2026-09-11 16:14 / 16:16) and the manifest still has exactly the original 15 KPIs, `generated_at: 2026-09-11T06:30:00-07:00`. The manifest's existing "not considered" section already independently documents the fact_premium/fact_member_month/mart_pmpm_plan_month 90-day exclusion — this predates this session's re-run attempt.

## 4. Exact next steps

1. **Re-run the data-profiler agent in smaller batches** to avoid the output-token ceiling — e.g. one call per table or per 2-3 tables, rather than asking for the full remaining set (`FACT_PREMIUM`, `FACT_MEMBER_MONTH`, `MEMBER_ELIGIBILITY`, `FACT_CLAIM_DIAGNOSIS`, `DIM_MEMBER`, `DIM_PROVIDER_LOCATION`, `DIM_MEMBER_GROUP`, and the 5 `MART_*` tables) in one shot. Keep the same instruction: full history, no 90-day cap on new KPIs, explicitly fix the monthly-grain lookback bug (use e.g. `DATEADD(month, -N, ...)` sized to get ≥12 buckets, not a flat 90-day window, for monthly-grain tables). Preserve the 15 existing KPIs (incremental, not a replace).
2. Once the manifest has real premium/PMPM KPIs with `series_sql`/thresholds groundwork, **run `snowflake-kpi-anomaly-detector`** on the expanded manifest to actually establish baselines/thresholds for the new KPIs — this is the step that gives premium payments real "normal range" data, which currently doesn't exist anywhere in the system.
3. Re-check whether `snowflake-risk-predictor` should also be re-run against any newly-discovered row-level tables (e.g. `FACT_PREMIUM` might support a premium-underpayment or lapse-risk model) — the user's framing ("predictor does the proactive intelligence work, assess threat and risk before it happens") suggests they see this as within its scope.
4. **Re-verify the pre-existing modifications to `.claude/agents/*.md`** (`snowflake-data-profiler.md`, `snowflake-kpi-analyst.md`, `snowflake-kpi-anomaly-detector.md` — these showed as already-modified in git status *before* this session started, so they are not this session's work and haven't been reviewed this session) against the user's explicit role description: profiler = inventory/profile only; anomaly detector = KPI issues/baselines; kpi-analyst = conversational analysis of existing findings; risk-predictor = forward-looking row-level threat/risk assessment before it happens. Confirm the agent definitions match this division of labor, or adjust if they've drifted.
5. Once new KPIs exist with real thresholds, **update `web/src/data/kpis.js`** (and possibly `web/src/data/flags.js` / `risks.js`) to surface them in the frontend, following the same "plain business language, no jargon, cross-linked" pattern established in §2. Do not hand-wave placeholder data for premium KPIs — wait for the real profiler/anomaly-detector output per the project's standing accuracy rule.
6. **Nothing in this session has been committed.** `git status` currently shows a large set of modified/untracked files (see below) — ask the user before committing, per standing instructions never to commit without being asked.

<details>
<summary>git status at time of writing</summary>

```
 M .claude/agents/snowflake-data-profiler.md          (pre-existing, not this session)
 M .claude/agents/snowflake-kpi-analyst.md             (pre-existing, not this session)
 M .claude/agents/snowflake-kpi-anomaly-detector.md    (pre-existing, not this session)
 M reports/HEALTH_CARE/anomaly_report.md               (pre-existing)
 M web/server/chat-server.js                           (this session: risk-record prompt fields updated)
 M web/src/App.jsx                                     (this session)
 M web/src/components/AnomalyChart.jsx                 (this session: caption wording)
 M web/src/components/ChatDrawer.jsx                   (pre-existing)
 D web/src/components/CorrelatedSidebar.jsx            (this session: deleted, dead code)
 D web/src/components/DetectionSidebar.jsx             (this session: deleted, dead code)
 D web/src/components/FollowUpPanel.jsx                (this session: deleted, dead code)
 M web/src/components/KpiDetail.jsx                    (this session: full rewrite)
 D web/src/components/ProjectionPanel.jsx              (this session: deleted, dead code)
 M web/src/components/Rail.jsx                         (pre-existing)
 D web/src/components/ReasonsList.jsx                  (this session: deleted, dead code)
 M web/src/components/TopBar.jsx                       (pre-existing)
 M web/src/data/kpis.js                                (this session: issue/cause/action fields, relatedRiskIds)
 M web/src/index.css                                   (this session: removed dead CSS classes)
 M web/src/lib/liveChat.js                              (pre-existing)
?? .claude/agents/snowflake-risk-predictor.md           (pre-existing, untracked)
?? ml/                                                  (pre-existing, untracked — risk-predictor training code)
?? reports/HEALTH_CARE/proactive_risk_brief.md          (pre-existing, untracked)
?? reports/HEALTH_CARE/risk_manifest.json               (pre-existing, untracked)
?? web/src/components/FlagsPanel.jsx                    (this session: new)
?? web/src/components/RiskBrief.jsx                     (pre-existing, untracked — but heavily edited this session)
?? web/src/components/RiskCard.jsx                      (pre-existing, untracked — but heavily edited this session)
?? web/src/data/flags.js                                (this session: new)
?? web/src/data/risks.js                                (pre-existing, untracked — but heavily edited this session)
?? web/src/lib/riskChat.js                              (pre-existing, untracked)
```

</details>

## Key file map

- `reports/HEALTH_CARE/kpi_manifest.json` — profiler output, consumed by anomaly detector. **Currently stale (15 KPIs, 7 tables) — see §3.**
- `reports/HEALTH_CARE/anomaly_report.md`, `proactive_risk_brief.md`, `risk_manifest.json` — human-readable / structured outputs from the other two agents.
- `web/src/data/kpis.js`, `risks.js`, `flags.js` — the hand-maintained snapshots the frontend actually reads (not live-queried). These need to be regenerated/extended once step 1-2 above produce new real data — do not fabricate placeholder values.
- `web/src/App.jsx` — top-level view/routing state (`view`: `'grid' | 'detail' | 'risk'`), chat state, now-cleaned-up flag-resolution state (`resolvedFlags`).
- `web/src/components/KpiDetail.jsx`, `RiskCard.jsx`, `RiskBrief.jsx`, `FlagsPanel.jsx` — the main business-facing views, all rewritten this session.
- Dev server: `cd web && npm run dev` (was running at `http://localhost:5174/`; port 5173 also seen in use earlier in the session — confirm before assuming either is still live).
