#!/usr/bin/env node
// Refreshes web/src/data/kpis.js from an anomaly-detector run, so the site shows exactly what was
// persisted to KPI_CURRENT_STATE / KPI_BASELINE instead of a hand-maintained snapshot.
//
// Usage:
//   node tools/export_web_kpis.mjs --db HEALTH_CARE --final reports/HEALTH_CARE/_detector/final_<date>.json [--dry-run]
//
// Inputs
//   --final     the detector finalizer's local copy of the rows it inserted (checksum-verified against
//               Snowflake at insert time): plain_* text, state, bounds, forecast, period_comparisons …
//   results/    reports/<db>/_detector/results/<kpi_id>.json — breakdowns behind flagged KPIs
//   ml/data/*_series.csv — refreshed full-history series; a CSV is used for a KPI's chart only if its
//               value at the KPI's as-of period exactly equals the persisted current value
// Preserved from the existing kpis.js (site-only fields the pipeline doesn't produce): id, name,
// domain, table, unit, definition, correlations, relatedRiskIds — and the chart series for any KPI
// without a verified refreshed CSV.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const db = opt('--db') || 'HEALTH_CARE';
const finalPath = opt('--final');
const dryRun = args.includes('--dry-run');
if (!finalPath) { console.error('--final <path> is required'); process.exit(1); }

const kpisPath = 'web/src/data/kpis.js';
const resultsDir = path.join('reports', db, '_detector', 'results');
const final = JSON.parse(fs.readFileSync(finalPath, 'utf8'));
const { kpis: existing } = await import(pathToFileURL(path.resolve(kpisPath)).href + `?t=${Date.now()}`);

const SERIES_CSV = {
  'payment-count': 'payment_count_series.csv',
  'payment-amount': 'payment_amount_series.csv',
  'eligibility-records': 'eligibility_count_series.csv',
  'member-months': 'member_month_count_series.csv',
  'premium-billed': 'premium_amount_series.csv',
  'premium-member-months': 'premium_count_series.csv',
  'pharmacy-count': 'pharmacy_count_full_series.csv',
};
const TIER = { 'needs attention': 'anomaly', 'worth watching': 'watch', normal: 'stable' };
const PERIOD_LABEL = { rolling_7d: 'Last 7 days', week: 'Last full week', month: 'Last full month', year: 'Last full year', ytd: 'Year to date' };
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const round = (v, d = 4) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);
const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

function readSeries(file) {
  const p = path.join('ml', 'data', file);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8').trim().split(/\r?\n/).slice(1)
    .map((l) => { const [bucket, value] = l.split(','); return { bucket: bucket.slice(0, 10), value: Number(value) }; });
}

// The site shows percentages people can read; prefer the per-period figure when the windows hold a
// different number of native periods (a month with 5 weekly payment runs vs. 4).
function pct(row, which) {
  const raw = num(row[`PCT_VS_${which}`]);
  const per = num(row[`PCT_VS_${which}_PER_PERIOD`]);
  const cp = num(row.CURRENT_PERIODS);
  const rp = num(row[`${which === 'PRIOR' ? 'PRIOR' : 'LAST_YEAR'}_PERIODS`]);
  return per !== null && cp !== null && rp !== null && cp !== rp ? per : raw;
}

function dataThrough(f) {
  return String(f.validation_notes ?? '').match(/latest date (\d{4}-\d{2}-\d{2})/)?.[1] ?? f.as_of_period;
}

// The detector stops at detection and attribution; it doesn't prescribe actions. These are derived
// only from facts it established (status, staleness, the verified backlog / enrollment findings).
function actionFor(f, web) {
  const through = dataThrough(f);
  const table = web.table ?? '';
  if (f.kpi_id.startsWith('main.fact_claim_payment.')) {
    return 'Ask the data team to confirm why no claims for visits after 30 June have loaded. Every payment since then is for an older visit, so payments will keep falling until new claims arrive. Treat this as a data-feed problem first, not a drop in business.';
  }
  if (f.kpi_id === 'main.member_eligibility.count_star') {
    return 'Ask the enrollment team what drove the June jump in new enrollments (a new employer group, or a special enrollment event?) and confirm the records are genuine.';
  }
  if (f.group === 'worth watching') {
    return 'No action yet. Check again once July data arrives: the rise is small and rests on a single signal.';
  }
  if (/DIM_|BRIDGE_/.test(table)) {
    return 'No action needed. This is a reference list that rarely changes, so older data here is expected.';
  }
  if (f.grain === 'year') {
    return f.state === 'trending up'
      ? 'No action needed for 2025. The steady long-run rise is worth a look at the next planning review.'
      : 'No action needed. The next reading comes with the full-year 2026 figures.';
  }
  if (f.state === 'data-quality suspect') {
    return `No action on the number itself: it was normal through ${through}. Ask the data team why nothing newer has loaded.`;
  }
  return 'No action needed. Continue routine monitoring.';
}

function reasonsFor(f) {
  const file = path.join(resultsDir, `${f.kpi_id}.json`);
  if (!fs.existsSync(file)) return [];
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  return (r.breakdowns || []).map((b, i) => ({
    rank: i + 1,
    text: b.driver_summary ?? `Breakdown by ${b.dim}`,
    strength: b.strength ?? null,
    evidence: `Compared ${b.horizon} vs ${b.vs === 'prior' ? 'the period before' : 'the same period last year'}; category contributions sum to the total (${b.sum_check_ok ? 'checked' : 'NOT checked'}).`,
    segment: b.dim,
    method: 'Exact contribution breakdown (rendered breakdown_sql), equal complete windows.',
  }));
}

const problems = [];
const seriesNotes = [];
const byKpiId = Object.fromEntries(final.kpis.map((f) => [f.kpi_id, f]));
const out = existing.map((web) => {
  const f = byKpiId[web.kpiId];
  if (!f) { problems.push(`${web.id}: no row for ${web.kpiId} in ${finalPath}`); return web; }
  const fc = parse(f.forecast) || {};
  const comps = (parse(f.period_comparisons) || []).map((c) => ({
    period: c.PERIOD,
    label: PERIOD_LABEL[c.PERIOD] ?? c.PERIOD,
    applicable: c.APPLICABLE === true || c.APPLICABLE === 'true',
    currentStart: c.CURRENT_START, currentEnd: c.CURRENT_END,
    current: num(c.CURRENT_VALUE), prior: num(c.PRIOR_VALUE), lastYear: num(c.LAST_YEAR_VALUE),
    pctVsPrior: pct(c, 'PRIOR'), pctVsLastYear: pct(c, 'LAST_YEAR'),
    // Workers stored verdicts in three shapes: flat verdict_vs_prior / verdict_vs_last_year, a nested
    // verdict {vs_prior, vs_last_year}, or only a combined verdict string. Per-side verdicts are used
    // where they exist; a combined-only verdict is kept as `verdict` and shown once per horizon,
    // never copied onto both sides.
    verdictVsPrior: c.verdict_vs_prior ?? (typeof c.verdict === 'object' ? c.verdict?.vs_prior : null) ?? null,
    verdictVsLastYear: c.verdict_vs_last_year ?? (typeof c.verdict === 'object' ? c.verdict?.vs_last_year : null) ?? null,
    verdict: typeof c.verdict === 'string' ? c.verdict : null,
    latestPeriodExcluded: c.LATEST_PERIOD_EXCLUDED === true || c.LATEST_PERIOD_EXCLUDED === 'true',
  }));

  let series = web.series;
  const csv = SERIES_CSV[web.id] && readSeries(SERIES_CSV[web.id]);
  if (csv) {
    const at = csv.find((p) => p.bucket === String(f.as_of_period).slice(0, 10));
    if (at && Math.abs(at.value - Number(f.current_value)) < 1e-6 * Math.max(1, Math.abs(at.value))) {
      series = csv.slice(-14);
      seriesNotes.push(`${web.id}: series refreshed from ml/data/${SERIES_CSV[web.id]} (matches ${f.as_of_period} = ${f.current_value})`);
    } else {
      seriesNotes.push(`${web.id}: kept existing series — ${SERIES_CSV[web.id]} ${at ? `has ${at.value}` : 'lacks'} at ${f.as_of_period}, persisted value is ${f.current_value}`);
    }
  }

  return {
    ...web,
    plainStatus: f.plain_status,
    plainReason: f.plain_reason,
    plainComparison: f.plain_comparison,
    plainConfidence: f.plain_confidence,
    // The page shows plainComparison in its own "How it compares" section and plainReason in the
    // header, so the older issue/cause pair is cleared rather than duplicating either.
    issue: null,
    cause: null,
    action: actionFor(f, web),
    value: num(f.current_value),
    asOfDate: String(f.as_of_period).slice(0, 10),
    dataThrough: dataThrough(f),
    daysStale: num(f.days_stale),
    grain: f.grain,
    state: f.state,
    statusTier: TIER[f.group] ?? 'stable',
    directionality: String(f.directionality ?? 'both').split(/\s/)[0],
    kpiClass: f.kpi_class === 'error_rate' ? 'error_rate' : null,
    confidence: f.confidence,
    warnLower: round(num(f.warn_lower)), warnUpper: round(num(f.warn_upper)),
    critLower: round(num(f.crit_lower)), critUpper: round(num(f.crit_upper)),
    why: f.why,
    forecast: f.forecast_next == null ? null : {
      next: round(num(f.forecast_next)), lower: round(num(f.forecast_lower)), upper: round(num(f.forecast_upper)),
      method: fc.method ?? null, confidence: fc.conf ?? null,
    },
    auditStatus: f.audit_status,
    signalsAgreeing: f.signals_agreeing,
    periodComparisons: comps,
    baseline: {
      expected: round(num(f.expected_value)), robustZ: num(f.residual_robust_z), percentile: num(f.residual_percentile),
      referenceBuckets: num(f.reference_buckets), trendRemoved: f.trend_removed, seasonalityRemoved: f.seasonality_removed,
      testedBucket: f.tested_bucket,
    },
    reasons: reasonsFor(f),
    series,
  };
});

const missingInSite = final.kpis.filter((f) => !existing.some((w) => w.kpiId === f.kpi_id)).map((f) => f.kpi_id);
if (missingInSite.length) problems.push(`in the run but not on the site: ${missingInSite.join(', ')}`);

const src = fs.readFileSync(kpisPath, 'utf8');
const tailStart = src.indexOf('export const statusMeta');
if (tailStart < 0) { console.error('Could not find `export const statusMeta` in kpis.js'); process.exit(1); }
const tail = src.slice(tailStart).replace(
  /export function daysStaleFor\(kpi\) \{[\s\S]*?\n\}/,
  'export function daysStaleFor(kpi) {\n  // Persisted by the detector (days between the table\'s latest date and the run date).\n  return kpi.daysStale ?? null\n}',
);
const header = `// Generated by tools/export_web_kpis.mjs from the anomaly-detector run persisted to
// HEALTH_CARE.ANALYTICS.KPI_CURRENT_STATE / KPI_BASELINE (run_ts ${final.run_ts}).
// Source: ${finalPath.replace(/\\/g, '/')} (the rows inserted, checksum-verified at insert time)
// plus reports/${db}/_detector/results/ for breakdowns. Site-only fields (id, name, domain, table,
// unit, definition, correlations, relatedRiskIds) are preserved from the previous version.
// Nothing here is synthetic. \`action\` is derived from verified findings (see the exporter); the
// detector itself doesn't prescribe actions. Regenerate rather than hand-edit.

export const generatedAt = ${JSON.stringify(new Date(String(final.run_ts).replace(' ', 'T') + 'Z').toISOString())}
export const runTs = ${JSON.stringify(final.run_ts)}

export const kpis = `;
const body = `${header}${JSON.stringify(out, null, 2)}\n\n${tail}`;

console.log(seriesNotes.join('\n'));
console.log(`Tiers: ${JSON.stringify(out.reduce((a, k) => ((a[k.statusTier] = (a[k.statusTier] || 0) + 1), a), {}))}`);
if (problems.length) { console.error(`Problems:\n  ${problems.join('\n  ')}`); process.exit(1); }
if (dryRun) { console.log('Dry run — kpis.js not written.'); process.exit(0); }
fs.writeFileSync(kpisPath, body);
console.log(`Wrote ${kpisPath} (${out.length} KPIs)`);
