#!/usr/bin/env node
// Regenerates metrics/<batch>/<batch>.{sql,yaml} — generic, portable monitoring batch configs —
// from the anomaly detector's per-KPI result files and the manifest's building blocks.
//
// Usage:
//   node tools/emit_metric_batches.mjs --db HEALTH_CARE [--kpis id1,id2,...] [--n 10] [--run-ts "<ts>"] [--dry-run]
//
// Selection (when --kpis is not given), per the detector's Phase 6 rule: KPIs that already have a
// batch folder are always kept (so monitors don't silently lose a metric), then "needs attention",
// "worth watching", error-rate KPIs, then the rest by |robust z| — up to --n (default 10).
//
// Ingest SQL is `metric_series_sql` from tools/render_kpi_sql.mjs: complete buckets only, at the
// same grain the thresholds were computed on. Thresholds come from the result file's baseline row
// (method residual_robust_z): they are for the tested bucket, and the yaml carries what a monitor
// needs to re-centre them each period (expected value, residual scale, trend, seasonality flag) plus
// the command that recomputes them.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const db = opt('--db') || 'HEALTH_CARE';
const n = Number(opt('--n') || 10);
const dryRun = args.includes('--dry-run');
const runTs = opt('--run-ts') || null;
const manifestPath = path.join('reports', db, 'kpi_manifest.json');
const resultsDir = path.join('reports', db, '_detector', 'results');

// Legacy batch names, kept so existing monitors keep their paths.
const LEGACY_NAMES = {
  'main.fact_claim_payment.count_star': 'fact_claim_payment_count',
  'main.fact_claim_payment.sum_paid_amount': 'fact_claim_payment_paid_amount',
  'main.medical_claim_header.sum_total_billed_amount': 'medical_claim_billed_amount',
  'main.medical_claim_header.avg_is_denied': 'medical_claim_denial_rate',
  'main.pharmacy_claim.count_star': 'pharmacy_claim_count',
};
const batchName = (id) => LEGACY_NAMES[id] ?? id.replace(/^main\./, '').replace(/\./g, '_')
  .replace(/_count_star$/, '_count').replace(/_sum_total_/, '_').replace(/_sum_/, '_');

const CRON = {
  day: ['0 6 * * *', '0 7 * * 1', '0 8 * * *', '0 8 * * *'],
  week: ['0 6 * * 1', '0 7 * * 1', '0 8 * * 1', '0 8 * * 1'],
  month: ['0 6 3 * *', '0 7 3 * *', '0 8 3 * *', '0 8 3 * *'],
  year: ['0 6 15 1 *', '0 7 15 1 *', '0 8 15 1 *', '0 8 15 1 *'],
};
const HORIZON = { day: 7, week: 4, month: 3, year: 1 };
const g = (o, k) => o?.[k] ?? o?.[k.toUpperCase()];
const y = (v) => (v === null || v === undefined ? 'null' : typeof v === 'string' ? JSON.stringify(v) : String(v));
const num = (v) => (v === null || v === undefined || v === '' ? null : Math.round(Number(v) * 1e4) / 1e4);

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const results = Object.fromEntries(fs.readdirSync(resultsDir).filter((f) => f.endsWith('.json'))
  .map((f) => { const r = JSON.parse(fs.readFileSync(path.join(resultsDir, f), 'utf8')); return [r.kpi_id, r]; }));

let ids = opt('--kpis')?.split(',').map((s) => s.trim()).filter(Boolean);
if (!ids) {
  const existing = new Set();
  if (fs.existsSync('metrics')) {
    for (const d of fs.readdirSync('metrics')) {
      const sqlFile = path.join('metrics', d, `${d}.sql`);
      const m = fs.existsSync(sqlFile) && fs.readFileSync(sqlFile, 'utf8').match(/'([\w.]+)'\s+AS\s+metric_name/i);
      if (m) existing.add(m[1]);
    }
  }
  const rank = (r) => {
    const s = r.interpretation?.combined_status;
    if (s === 'needs attention') return 0;
    if (s === 'worth watching') return 1;
    if (/denied|denial|reject|error|fail/i.test(r.kpi_id)) return 2;
    return 3;
  };
  const sorted = Object.values(results).sort((a, b) => rank(a) - rank(b)
    || Math.abs(Number(g(b.baseline, 'robust_z')) || 0) - Math.abs(Number(g(a.baseline, 'robust_z')) || 0));
  ids = [...existing].filter((id) => results[id]);
  for (const r of sorted) { if (ids.length >= Math.max(n, ids.length)) break; if (!ids.includes(r.kpi_id)) ids.push(r.kpi_id); }
}

const problems = [];
const written = [];
for (const id of ids) {
  const r = results[id];
  const k = manifest.kpis.find((x) => x.kpi_id === id);
  if (!r || !k) { problems.push(`${id}: ${!r ? 'no detector result file' : 'not in manifest'}`); continue; }
  const b = r.baseline || {};
  const grain = g(b, 'grain_used');
  if (!CRON[grain]) { problems.push(`${id}: baseline has no usable grain_used (${grain})`); continue; }
  let sql;
  try {
    sql = execFileSync('node', ['tools/render_kpi_sql.mjs', manifestPath, '--print', id, 'metric_series_sql'], { encoding: 'utf8' });
  } catch (e) { problems.push(`${id}: render failed — ${e.stderr || e.message}`); continue; }

  const name = batchName(id);
  const dir = path.join('metrics', name);
  const dirGuess = String(r.interpretation?.directionality_guess ?? '').match(/^(high_bad|low_bad|both)/)?.[1] ?? 'both';
  const kpiClass = /denied|denial|reject|error|fail/i.test(id) ? 'error_rate' : null;
  const [ingest, train, score, alert] = CRON[grain];
  const yaml = [
    `metric_batch: ${name}`,
    `metric_name: ${y(id)}`,
    `plain_name: ${y(k.plain_name ?? r.plain_name ?? null)}`,
    'db: snowflake',
    `ingest_sql: metrics/${name}/${name}.sql`,
    `grain: ${grain}                     # latest complete ${grain} only — partial periods are never ingested`,
    `ingest_cron: "${ingest}"`,
    `train_cron: "${train}"`,
    `score_cron: "${score}"`,
    `alert_cron: "${alert}"`,
    `forecast_horizon: ${HORIZON[grain]}           # ${grain}s ahead`,
    'thresholds:',
    '  method: residual_robust_z       # out-of-sample: tested bucket vs up to 104 prior buckets, trend/seasonality removed first',
    `  as_of_bucket: ${y(g(b, 'tested_bucket'))}`,
    `  expected_value: ${y(num(g(b, 'expected_value')))}`,
    `  warn_lower: ${y(num(g(b, 'warn_lower')))}`,
    `  warn_upper: ${y(num(g(b, 'warn_upper')))}`,
    `  crit_lower: ${y(num(g(b, 'crit_lower')))}`,
    `  crit_upper: ${y(num(g(b, 'crit_upper')))}`,
    `  residual_scale: ${y(num(g(b, 'residual_scale')))}      # band = expected ± 3.0 (warn) / 3.5 (crit) × this`,
    '  warn_z: 3.0',
    '  crit_z: 3.5',
    `  trend_removed: ${y(g(b, 'trend_removed'))}`,
    `  reference_slope_pct_per_bucket: ${y(num(g(b, 'reference_slope_pct_per_bucket')))}`,
    `  seasonality_removed: ${y(g(b, 'seasonality_removed'))}`,
    `  reference_buckets: ${y(g(b, 'reference_buckets'))}`,
    '  # The bounds above are for as_of_bucket. When trend or seasonality was removed the expected value moves',
    '  # each period — re-centre by re-running the baseline instead of reusing these numbers indefinitely:',
    `  refresh: ${y(`node tools/render_kpi_sql.mjs reports/${db}/kpi_manifest.json --print ${id} baseline_sql`)}`,
    `directionality: ${dirGuess}          # inferred by the detector — confirm with the business owner`,
    `kpi_class: ${y(kpiClass)}`,
    `status_at_generation: ${y(r.interpretation?.combined_status ?? null)}`,
    `signals_agreeing: ${y(Array.isArray(r.interpretation?.signals_agreeing) ? r.interpretation.signals_agreeing.join(',') : (r.interpretation?.signals_agreeing ?? null))}`,
    `source_run_ts: ${y(runTs)}`,
    `generated_at: ${y(new Date().toISOString())}`,
    'notes: >',
    ...String(r.baseline_reading ?? 'See reports/' + db + '/anomaly_report.md.').replace(/\s+/g, ' ').match(/.{1,100}(\s|$)/g).map((l) => `  ${l.trim()}`),
    '',
  ].join('\n');

  if (!dryRun) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.sql`), sql);
    fs.writeFileSync(path.join(dir, `${name}.yaml`), yaml);
  }
  written.push(`${dir}  (${id}, ${grain}, ${r.interpretation?.combined_status})`);
}

console.log(`${dryRun ? 'Would write' : 'Wrote'} ${written.length} batch(es):\n  ${written.join('\n  ')}`);
if (problems.length) { console.error(`Problems:\n  ${problems.join('\n  ')}`); process.exit(1); }
