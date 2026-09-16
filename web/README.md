# KPI Signal

A React (Vite) console over the `HEALTH_CARE` claims database in Snowflake:
KPI health (baselines/thresholds/attribution) plus a proactive risk brief
(row-level ML predictions rolled up into plain-language findings), built for
a non-technical / executive reader. Originally ported from a Claude Design
canvas (`KPI Signal.dc.html`), now fully custom.

## Quick start

```bash
cd web
npm install          # first time only
npm run dev           # frontend  -> http://localhost:5173
npm run chat-server    # chat API bridge -> http://127.0.0.1:8787 (run in a second terminal)
```

Open http://localhost:5173. The chat server is optional — the app works
without it (see "Ask the analyst" below) — but start it too if you want live
answers instead of the canned fallback.

Other scripts:

```bash
npm run build     # production build to dist/
npm run preview   # serve the dist/ build locally
```

## What's actually running

| Piece | Command | Port | What it does |
|---|---|---|---|
| Frontend | `npm run dev` | 5173 | Vite/React dashboard. Reads static data bundled at build time — no live DB access from the browser. |
| Chat bridge | `npm run chat-server` | 127.0.0.1:8787 | Node HTTP server backing the "Ask the analyst" chat drawer. Local-only, never exposed to the network. |

The chat bridge shells out to the `claude` CLI (`claude -p ... --model claude-haiku-4-5-20251001`) for each question, using your existing Claude Code login — so it costs a small real API call per question, and requires `claude` to be installed and authenticated on this machine. Override with env vars if needed:

```bash
CHAT_SERVER_PORT=9000 CHAT_SERVER_MODEL=claude-sonnet-5 npm run chat-server
```

If you change `CHAT_SERVER_PORT`, also update `SERVER_URL` in `src/lib/liveChat.js` (hardcoded to `http://127.0.0.1:8787`) — it's not read from an env var on the frontend side.

## How the chat drawer decides what to answer with

`App.jsx` always tries the live bridge first (`askLive` in `src/lib/liveChat.js`); if that call fails (bridge not running, `claude` not authenticated, timeout) it falls back to a canned, fully local answer generator (`src/lib/chatEngine.js` for KPIs, `src/lib/riskChat.js` for risk cards) and appends an "offline" note. So the app is always usable — the chat server just upgrades answer quality.

## Where the data comes from

Nothing is fetched live in the browser. Three static files under `src/data/` are hand-assembled snapshots of pipeline output, refreshed by re-running the Snowflake agents and re-generating these files:

- **`src/data/kpis.js`** — from `HEALTH_CARE.ANALYTICS.KPI_CURRENT_STATE`/`KPI_BASELINE` (latest `run_ts`), `reports/HEALTH_CARE/kpi_manifest.json` (correlations, each KPI's `series_sql` re-run directly against Snowflake for real weekly chart points), and `reports/HEALTH_CARE/anomaly_report.md` §5 (full attribution for the KPIs the anomaly detector actually investigated).
- **`src/data/risks.js`** — from `reports/HEALTH_CARE/proactive_risk_brief.md` and `reports/HEALTH_CARE/risk_manifest.json`, produced by the `snowflake-risk-predictor` agent (real LightGBM models in `ml/`, not canned rules).
- **`src/data/flags.js`** — hand-pulled data-quality issues surfaced by existing audit/reconciliation checks already present in the manifest (duplicate claims, payment reconciliation mismatches, unverified spikes, staleness gaps). Each flag has a "Mark resolved / Reopen" toggle, persisted in `localStorage` via `src/lib/usePersisted.js` (key `resolvedFlags`) — this state is per-browser, not written back to any pipeline artifact.

No Snowflake credentials ship to the browser. To refresh any of the three data files: re-run the relevant agent (`snowflake-data-profiler` → `snowflake-kpi-anomaly-detector` → `snowflake-risk-predictor`, in that order, since each downstream one reads the previous one's manifest), then hand-edit (or script) `src/data/*.js` from the regenerated reports.

## Project layout

```
web/
  src/
    App.jsx                 # top-level state, routing between KPI portfolio / detail / risk brief, chat wiring
    components/
      KpiCard.jsx / KpiDetail.jsx     # KPI portfolio grid + drill-down
      RiskBrief.jsx / RiskCard.jsx    # proactive risk brief section
      FlagsPanel.jsx                  # "Flagged for review" data-quality panel
      ChatDrawer.jsx                  # "Ask the analyst" chat UI
      AnomalyChart.jsx / Sparkline.jsx
      TopBar.jsx / Rail.jsx / FilterBar.jsx / SummaryStrip.jsx
    data/
      kpis.js / risks.js / flags.js   # static pipeline snapshots (see above)
    lib/
      liveChat.js    # calls the chat-server bridge
      chatEngine.js  # local fallback Q&A for KPIs
      riskChat.js    # local fallback Q&A for risk cards
      usePersisted.js  # localStorage-backed React state hook
      format.js
  server/
    chat-server.js   # local Claude Code bridge for the chat drawer
```

## Business-language rule (applies to any content you add)

Everything user-facing — KPI `issue`/`cause`/`action` fields, risk card copy, chat answers — is written for a claims operations manager, not a data scientist: no z-scores, r², p-values, SQL, or table/column names in default answers. `chat-server.js`'s system prompt enforces this for live chat; keep the same standard when hand-editing `src/data/*.js`. Technical detail is fine, but only behind an explicit "how was this calculated" ask.

## Known gaps (see repo-root `claude_handoff.md` for full detail)

- `kpi_manifest.json` currently covers 15 KPIs across 7 of 37 `HEALTH_CARE.MAIN` tables — monthly-grain tables like `FACT_PREMIUM` were auto-excluded by a hardcoded 90-day lookback in the profiler, not because the data is bad. Re-profiling with a wider window is pending.
- Full reasons/attribution only exist for the 3 KPIs the anomaly detector actually investigated in depth; others show a one-line `why`.
- Correlated-KPI sidebars only show for the 5 KPIs actually present in the manifest's correlation set.
