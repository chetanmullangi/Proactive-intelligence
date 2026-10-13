#!/usr/bin/env node
// Merges per-shard profiler output into reports/<db>/kpi_manifest.json.
//
// Why this exists: the profiler used to hand-write the whole manifest (~120 KB) in one
// model response, which blew the 64K output-token ceiling mid-merge and corrupted the file.
// Shards now each write a small part file; this script does the merge deterministically.
//
// Usage:
//   node tools/merge_profile_parts.mjs --db HEALTH_CARE [--dry-run] [--keep-parts] [--note "text"]
//
// Inputs  (reports/<db>/_profile/parts/*.json), one per shard:
//   { shard_id, generated_at, tables: ["MAIN.FACT_PREMIUM", ...],   // tables this shard owns
//     kpis: [...], table_usage_series: [...], skipped: [...], changelog: "..." }
//   A part named _correlations.json instead carries { correlations: [...] } and replaces
//   the manifest's correlations wholesale.
// Output: reports/<db>/kpi_manifest.json (previous copy kept as kpi_manifest.prev.json).
//   Merged parts are moved to _profile/merged/<timestamp>/ unless --keep-parts.
//
// Merge rules: a shard is authoritative for the tables it lists. Its KPIs replace prior KPIs
// on those tables; a prior KPI on those tables that the shard did not re-emit is moved to
// `skipped` (never silently dropped). KPIs on tables no shard touched are carried forward as-is.

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const db = opt('--db') || 'HEALTH_CARE';
const dryRun = flag('--dry-run');
const keepParts = flag('--keep-parts');
const note = opt('--note');

const reportDir = path.join('reports', db);
const partsDir = path.join(reportDir, '_profile', 'parts');
const manifestPath = path.join(reportDir, 'kpi_manifest.json');

const REQUIRED_KPI_FIELDS = [
  'kpi_id', 'plain_name', 'plain_description', 'schema', 'table', 'measure_column',
  'aggregation', 'date_column', 'grain', 'series_sql', 'freshness_sql', 'history_span_sql',
];
const BACKFILL_FIELDS = ['dimension_breakdowns', 'full_history_series_sql', 'monthly_trend_sql',
  'yearly_trend_sql', 'month_of_year_seasonality_sql',
  // building blocks tools/render_kpi_sql.mjs needs for the multi-horizon comparison + pattern SQL
  'table_fqn', 'date_expr', 'value_expr'];

const tableKey = (schema, table) => `${String(schema).toUpperCase()}.${String(table).toUpperCase()}`;
const readJson = (p) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); }
  catch (e) { throw new Error(`${p}: ${e.message}`); }
};

const errors = [];
const warnings = [];

const prior = fs.existsSync(manifestPath)
  ? readJson(manifestPath)
  : { database: db, lookback_days: null, kpis: [], table_usage_series: [], correlations: [], skipped: [] };

if (!fs.existsSync(partsDir)) {
  console.error(`No parts directory at ${partsDir} — nothing to merge.`);
  process.exit(1);
}
const partFiles = fs.readdirSync(partsDir).filter((f) => f.endsWith('.json')).sort();
if (partFiles.length === 0) {
  console.error(`No part files in ${partsDir} — nothing to merge.`);
  process.exit(1);
}

const shardParts = [];
let correlationsPart = null;
for (const f of partFiles) {
  const part = readJson(path.join(partsDir, f));
  if (f === '_correlations.json') { correlationsPart = part; continue; }
  if (!Array.isArray(part.tables) || part.tables.length === 0) {
    errors.push(`${f}: missing non-empty "tables" list (a shard must declare which tables it owns)`);
    continue;
  }
  part._file = f;
  part._owned = new Set(part.tables.map((t) => {
    const [s, n] = t.includes('.') ? t.split('.') : ['MAIN', t];
    return tableKey(s, n);
  }));
  shardParts.push(part);
}

// Two shards claiming the same table would make the result order-dependent.
const owner = new Map();
for (const p of shardParts) {
  for (const t of p._owned) {
    if (owner.has(t)) errors.push(`table ${t} claimed by both ${owner.get(t)} and ${p._file}`);
    else owner.set(t, p._file);
  }
}

const kpis = new Map(prior.kpis.map((k) => [k.kpi_id, k]));
const usage = new Map((prior.table_usage_series || []).map((u) => [tableKey(u.schema, u.table), u]));
const skipped = new Map((prior.skipped || []).map((s) => [s.object, s]));

const added = [];
const updated = [];
const dropped = [];

for (const p of shardParts) {
  const emitted = new Set();
  for (const k of p.kpis || []) {
    const t = tableKey(k.schema, k.table);
    if (!p._owned.has(t)) {
      errors.push(`${p._file}: KPI ${k.kpi_id} is on ${t}, which this shard does not own`);
      continue;
    }
    const missing = REQUIRED_KPI_FIELDS.filter((f) => k[f] === undefined || k[f] === null || k[f] === '');
    if (missing.length) errors.push(`${p._file}: KPI ${k.kpi_id} missing required ${missing.join(', ')}`);
    if (emitted.has(k.kpi_id)) errors.push(`${p._file}: duplicate KPI ${k.kpi_id}`);
    emitted.add(k.kpi_id);
    (kpis.has(k.kpi_id) ? updated : added).push(k.kpi_id);
    kpis.set(k.kpi_id, k);
    skipped.delete(k.kpi_id);
  }
  // Prior KPIs on owned tables that the shard no longer emits move to skipped.
  for (const [id, k] of kpis) {
    if (p._owned.has(tableKey(k.schema, k.table)) && !emitted.has(id)) {
      kpis.delete(id);
      dropped.push(id);
      const own = (p.skipped || []).find((s) => s.object === id);
      skipped.set(id, own || { object: id, reason: `Was in the prior manifest; not re-emitted by shard ${p.shard_id ?? p._file} this run (shard gave no specific reason).` });
    }
  }
  // Prior skip entries for re-profiled tables are superseded by this shard's own verdicts.
  for (const [obj] of skipped) {
    const upper = obj.toUpperCase();
    if ([...p._owned].some((t) => upper === t || upper.startsWith(`${t}.`) || upper.includes(`.${t}.`) || upper.endsWith(`.${t}`))
        && !dropped.includes(obj)) {
      skipped.delete(obj);
    }
  }
  for (const s of p.skipped || []) skipped.set(s.object, s);
  for (const u of p.table_usage_series || []) usage.set(tableKey(u.schema, u.table), u);
}

let correlations = prior.correlations || [];
if (correlationsPart) {
  if (!Array.isArray(correlationsPart.correlations)) errors.push('_correlations.json: missing "correlations" array');
  else correlations = correlationsPart.correlations;
}
const finalIds = new Set(kpis.keys());
const danglingCorr = correlations.filter((c) => c.type === 'kpi_to_kpi' && (!finalIds.has(c.kpi_a) || !finalIds.has(c.kpi_b)));
if (danglingCorr.length) warnings.push(`${danglingCorr.length} kpi_to_kpi correlation(s) reference KPIs not in the merged set — re-run finalize to recompute`);

const merged = [...kpis.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
const gaps = Object.fromEntries(BACKFILL_FIELDS.map((f) => [f, merged.filter((k) => !(f in k)).map((k) => k.kpi_id)]));
const noBreakdowns = merged.filter((k) => Array.isArray(k.dimension_breakdowns) && k.dimension_breakdowns.length === 0).length;

const runNote = [
  `Merge ${new Date().toISOString().slice(0, 10)}: ${shardParts.length} shard(s) [${shardParts.map((p) => p.shard_id ?? p._file).join(', ')}]` +
    `${correlationsPart ? ' + correlations' : ''}. Added ${added.length}, updated ${updated.length}, dropped ${dropped.length}. ` +
    `Total ${merged.length} KPIs across ${new Set(merged.map((k) => tableKey(k.schema, k.table))).size} tables. ` +
    `Missing dimension_breakdowns field: ${gaps.dimension_breakdowns.length}; empty breakdowns (no usable dimension): ${noBreakdowns}.`,
  note,
  ...shardParts.map((p) => p.changelog && `[${p.shard_id ?? p._file}] ${p.changelog}`),
].filter(Boolean).join(' ');

const out = {
  database: prior.database || db,
  generated_at: new Date().toISOString(),
  lookback_days: prior.lookback_days ?? null,
  discovery_note: prior.discovery_note ? `${runNote}\n\n${prior.discovery_note}` : runNote,
  kpis: merged,
  table_usage_series: [...usage.values()],
  correlations,
  skipped: [...skipped.values()],
};

console.log(runNote);
if (added.length) console.log(`  added:   ${added.join(', ')}`);
if (dropped.length) console.log(`  dropped: ${dropped.join(', ')}`);
for (const [f, ids] of Object.entries(gaps)) if (ids.length) console.log(`  gap ${f}: ${ids.length} KPI(s)`);
for (const w of warnings) console.log(`  WARN ${w}`);

if (errors.length) {
  for (const e of errors) console.error(`  ERROR ${e}`);
  console.error(`Merge aborted — ${errors.length} error(s). Manifest not written.`);
  process.exit(1);
}
if (dryRun) { console.log('Dry run — manifest not written.'); process.exit(0); }

if (fs.existsSync(manifestPath)) fs.copyFileSync(manifestPath, path.join(reportDir, 'kpi_manifest.prev.json'));
const tmp = `${manifestPath}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
JSON.parse(fs.readFileSync(tmp, 'utf8')); // refuse to swap in a file that doesn't round-trip
fs.renameSync(tmp, manifestPath);
console.log(`Wrote ${manifestPath}`);

if (!keepParts) {
  const archive = path.join(reportDir, '_profile', 'merged', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(archive, { recursive: true });
  for (const f of partFiles) fs.renameSync(path.join(partsDir, f), path.join(archive, f));
  console.log(`Archived ${partFiles.length} part(s) to ${archive}`);
}
