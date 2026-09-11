# KPI Signal

A React (Vite) implementation of the "KPI Signal" console originally designed
in Claude Design as `KPI Signal.dc.html`. That file is a Claude Design canvas
— a template DSL (`support.js`'s `dc-runtime`) that only runs inside the
design tool, not a real app. This is a from-scratch React port of its layout
and interaction model, populated with real data from this project's Snowflake
pipeline instead of the design's placeholder SaaS metrics.

## Running it

This machine doesn't have Node.js installed, so this hasn't been run or
build-verified here. On a machine with Node 18+:

```
cd web
npm install
npm run dev      # http://localhost:5173
npm run build    # production build to dist/
```

## Where the data comes from

`src/data/kpis.js` is a static, hand-assembled snapshot — not fetched live —
built from:

- `HEALTH_CARE.ANALYTICS.KPI_CURRENT_STATE` and `KPI_BASELINE` (latest `run_ts`)
- `reports/HEALTH_CARE/kpi_manifest.json` (correlations, `series_sql`)
- Each KPI's `series_sql` re-run directly against Snowflake to get real weekly points for the charts
- `reports/HEALTH_CARE/anomaly_report.md` §5 (the 3 KPIs with a full attribution write-up)

No Snowflake credentials ship to the browser — this is a static app.
Re-running `snowflake-kpi-anomaly-detector` and re-generating this file by
hand (or writing a small export script) is how you'd refresh it.

## Where this diverges from the original design

The design's mock data assumed things this pipeline doesn't produce. Rather
than invent them, the UI was adapted to what's actually real:

| Design assumed | This app shows instead |
|---|---|
| A business `target` | Statistical `warn`/`crit` thresholds ("expected range") |
| A 0–1 confidence float per reason | `strong`/`moderate`/`weak` evidence tags + categorical baseline confidence (`high`/`medium`/`low`) |
| A fabricated "detected since" date | The real last-bucket date ("as of ...") |
| Recommended action + pros/cons | Audit/reconciliation status + "worth investigating further" — no prescribed fix, since the pipeline doesn't produce one |
| Two forecast scenarios (base/action) | One trend-band forecast, with an explicit note when the KPI is flagged for a real trained model instead |
| A smooth 12-month random-walk history | The real ~13–14 week series, with partial edge-buckets marked as hollow points |
| Ranked reasons for every KPI | Full reasons for the 3 KPIs the anomaly detector actually investigated (`fact_claim_payment.count_star`, `medical_claim_header.sum_total_billed_amount`, `medical_claim_header.avg_is_denied`); the other 10 show their one-line `why` |
| A correlated-KPI sidebar for every card | Shown only for the 5 KPIs actually in the manifest's correlation set — others say so explicitly |

The chat panel is fully local (`src/lib/chatEngine.js`) — no external API call.
Every answer is grounded in the open KPI's own record; nothing is invented.
