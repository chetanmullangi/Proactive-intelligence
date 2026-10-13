#!/usr/bin/env node
// Renders the analysis SQL the anomaly detector runs for each KPI, so agents never hand-write
// (or hand-edit) ~60-line queries and every KPI gets identical, tested logic.
//
// Usage:
//   node tools/render_kpi_sql.mjs <file.json> --print <kpi_id> <field> [--dim <column>] [--horizon <h>] [--vs prior|last_year]
//   node tools/render_kpi_sql.mjs <file.json> --list-dims <kpi_id>
//   node tools/render_kpi_sql.mjs <file.json> [--write] [--only <kpi_id,...>] [--sidecar out.json]
//                                             [--validation-sql <out.sql>] [--batch 6]
//
// Fields:
//   period_comparison_sql  7-day / week / month / year / year-to-date, each vs. prior period and same
//                          period last year, with a sampling-noise test per comparison
//   pattern_sql            full-history trend per grain, trend reversal, typical period-over-period and
//                          year-over-year change, day-of-week / month-of-year seasonality + repeatability
//   baseline_sql           out-of-sample test of the latest complete period against up to 104 prior
//                          periods, after removing trend (and seasonality when it repeats) → expected
//                          value, robust z, percentile, warn/critical bounds
//   metric_series_sql      long-format (metric_timestamp, metric_name, metric_value) ingest series for a
//                          downstream monitor — complete buckets at the baseline's grain, full history
//   breakdown_sql          attribution for one dimension over one horizon: each category's exact
//                          contribution to the change, split into rate effect vs. mix effect for ratios
//                          (needs --dim, --horizon, --vs)
//
// Building blocks per KPI (the profiler sets them; for older KPIs --write derives them from
// series_sql / breakdown_sql and marks the source):
//   table_fqn, date_expr, value_expr, row_filter           — the KPI
//   dimension_breakdowns[].dim_expr / from_clause / base_alias — each breakdown dimension
// The rendered SQL is not stored in the manifest (it would triple its size); --print regenerates it.
//
// All SQL detects the data's native grain (day / weekly-batched / month / year), marks horizons
// finer than it as not applicable, excludes a still-open latest month/year, and normalises additive
// KPIs by the number of native periods in each window (a month with 5 weekly payment runs vs. 4).

import fs from 'node:fs';

const args = process.argv.slice(2);
const file = args[0];
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
if (!file || file.startsWith('--')) {
  console.error('usage: node tools/render_kpi_sql.mjs <file.json> [--print <kpi_id> <field> [--dim c --horizon h --vs v]] [--list-dims <kpi_id>] [--write] [--only ids] [--sidecar out.json] [--validation-sql out.sql] [--batch N]');
  process.exit(1);
}
const only = opt('--only')?.split(',');
const batchSize = Number(opt('--batch') || 6);

// ---- parsing helpers -----------------------------------------------------------

// If `expr` is exactly `fn( ... )` with the parenthesis closing at the very end, return the inside.
function outerCall(expr, fn) {
  const e = expr.trim();
  const m = e.match(new RegExp(`^${fn}\\s*\\(`, 'i'));
  if (!m) return null;
  let depth = 0;
  for (let i = m[0].length - 1; i < e.length; i++) {
    if (e[i] === '(') depth++;
    else if (e[i] === ')') {
      depth--;
      if (depth === 0) return i === e.length - 1 ? e.slice(m[0].length, i) : null;
    }
  }
  return null;
}

// Split a SELECT list on top-level commas.
function splitTop(s) {
  const out = []; let depth = 0; let cur = ''; let q = false;
  for (const ch of s) {
    if (ch === "'") q = !q;
    if (!q && ch === '(') depth++;
    if (!q && ch === ')') depth--;
    if (!q && depth === 0 && ch === ',') { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// What kind of aggregate the KPI is decides how changes decompose and how noise is measured.
//   count / sum → additive: category contributions are plain differences
//   mean / ratio → rate: contributions split into rate effect + mix effect
function kpiKind(k) {
  // Explicit override: only when the expressions are supplied too (the stored `kpi_kind` alone is
  // just a label written by --write, not enough to build SQL from).
  if (k.kpi_kind && (k.m_expr || (k.num_expr && k.den_expr))) {
    return { kind: k.kpi_kind, m: k.m_expr ?? k.num_expr, num: k.num_expr, den: k.den_expr };
  }
  const v = k.value_expr.trim();
  if (/^COUNT\s*\(\s*\*\s*\)$/i.test(v)) return { kind: 'count', m: '1' };
  const c = outerCall(v, 'COUNT');
  if (c != null) return /^\s*DISTINCT\b/i.test(c) ? { kind: 'other' } : { kind: 'count', m: `IFF((${c}) IS NULL, 0, 1)` };
  const s = outerCall(v, 'SUM');
  if (s != null) return { kind: 'sum', m: `(${s})` };
  const a = outerCall(v, 'AVG');
  if (a != null) return { kind: 'mean', m: `(${a})`, num: `(${a})`, den: `IFF((${a}) IS NULL, 0, 1)` };
  const r = v.match(/^(SUM\s*\(.+\))\s*(?:\*\s*([\d.]+))?\s*\/\s*NULLIF\s*\(\s*(SUM\s*\(.+\))\s*,\s*0\s*\)$/i);
  if (r) {
    const n = outerCall(r[1], 'SUM'); const d = outerCall(r[3], 'SUM');
    if (n != null && d != null) return { kind: 'ratio', num: r[2] ? `(${n}) * ${r[2]}` : `(${n})`, den: `(${d})` };
  }
  return { kind: 'other' };
}
const isAdditive = (kk) => kk.kind === 'count' || kk.kind === 'sum';
const GRAIN_RANK = { day: 1, week: 2, month: 3, year: 4 };

function deriveParts(k) {
  const s = (k.series_sql || '').replace(/\s+/g, ' ');
  const bucket = s.match(/SELECT\s+(?:DATE_TRUNC\(\s*'\w+'\s*,\s*(.+?)\)|(DATE_FROM_PARTS\(.+?\)))\s+AS\s+bucket\s*,/i);
  const value = s.match(/AS\s+bucket\s*,\s*(.+?)\s+AS\s+value\s+FROM\s+([\w$."]+)/i);
  if (!bucket || !value) return null;
  const where = s.match(/\bWHERE\s+(.+?)\s+GROUP\s+BY/i)?.[1] ?? '';
  const row_filter = where.split(/\s+AND\s+/i).filter((c) => !/bounds\.|start_dt|DATEADD/i.test(c)).join(' AND ') || null;
  return { table_fqn: value[2], date_expr: (bucket[1] || bucket[2]).trim(), value_expr: value[1].trim(), row_filter };
}

// Older breakdowns are `WITH tbl AS (SELECT … AS d, … AS cat FROM <from>), bounds AS …`.
function deriveDim(bd) {
  const s = (bd.breakdown_sql || '').replace(/\s+/g, ' ');
  const tbl = s.match(/^WITH tbl AS \(SELECT (.+?) FROM (.+?)\), bounds AS/i);
  if (!tbl) return null;
  const cat = splitTop(tbl[1]).find((i) => /\s+AS\s+cat$/i.test(i));
  if (!cat) return null;
  const from_clause = tbl[2].trim();
  const alias = from_clause.match(/^[\w$."]+\s+(?:AS\s+)?(\w+)\b/i)?.[1];
  const base_alias = alias && !/^(LEFT|RIGHT|INNER|FULL|CROSS|JOIN|WHERE|NATURAL)$/i.test(alias) ? alias : null;
  if (!base_alias && /\bJOIN\b/i.test(from_clause)) return null;   // can't select base.* safely
  return { dim_expr: cat.replace(/\s+AS\s+cat$/i, '').trim(), from_clause, base_alias };
}

// ---- shared CTEs -------------------------------------------------------------------

const srcCte = (p, from) => `src AS (
  SELECT (${p.date_expr})::DATE AS d, x.*
  FROM ${from} x
  WHERE (${p.date_expr}) IS NOT NULL${p.row_filter ? ` AND (${p.row_filter})` : ''})`;

// Native grain, decided from the data every run: all dates Jan-1 → year; all 1st-of-month → month;
// all the same weekday → week (batched feeds); otherwise day. `eff_hi` is the end of the latest
// *complete* native period: a month/year still open today is excluded and flagged, because a
// yearly mart with a Jan–Jun 2026 row would otherwise read as a ~50% drop.
const grainCtes = `dd AS (SELECT DISTINCT d FROM src),
nat AS (
  SELECT CASE WHEN COUNT_IF(DAYOFYEAR(d) <> 1) = 0 AND COUNT(*) > 1 THEN 4
              WHEN COUNT_IF(DAY(d) <> 1) = 0 AND COUNT(*) > 1 THEN 3
              WHEN COUNT(DISTINCT DAYOFWEEKISO(d)) = 1 AND COUNT(*) > 1 THEN 2
              ELSE 1 END AS g,
         MIN(d) AS lo, MAX(d) AS hi
  FROM dd),
natg AS (
  SELECT g, DECODE(g, 1, 'day', 2, 'week', 3, 'month', 4, 'year') AS native_grain, lo,
         CASE g WHEN 1 THEN hi
                WHEN 2 THEN DATEADD(day, 6, hi)
                WHEN 3 THEN IFF(hi >= DATE_TRUNC('month', CURRENT_DATE()), LAST_DAY(DATEADD(month, -1, hi)), LAST_DAY(hi))
                ELSE IFF(YEAR(hi) >= YEAR(CURRENT_DATE()), DATE_FROM_PARTS(YEAR(hi) - 1, 12, 31), DATE_FROM_PARTS(YEAR(hi), 12, 31))
         END AS eff_hi,
         (g = 3 AND hi >= DATE_TRUNC('month', CURRENT_DATE())) OR (g = 4 AND YEAR(hi) >= YEAR(CURRENT_DATE())) AS latest_period_excluded
  FROM nat)`;

const kpiCtes = (p) => `${srcCte(p, p.table_fqn)},\n${grainCtes}`;

// Comparison windows. Week/month/year are the last *complete* calendar periods; rolling_7d ends at
// the latest data; same-period-last-year uses 364 days for day/week windows (keeps weekdays aligned).
const windowCtes = `starts AS (
  SELECT g, native_grain, eff_hi AS a,
         DATEADD(day, -7, DATE_TRUNC('week', DATEADD(day, 1, eff_hi)))    AS wk,
         DATEADD(month, -1, DATE_TRUNC('month', DATEADD(day, 1, eff_hi))) AS mo,
         DATEADD(year, -1, DATE_TRUNC('year', DATEADD(day, 1, eff_hi)))   AS yr,
         DATE_TRUNC('year', eff_hi)                                        AS ytd
  FROM natg),
w AS (
  SELECT 'rolling_7d' AS period, 1 AS ord, 'current' AS role, DATEADD(day, -6, a) AS s, a AS e, g <= 2 AS applicable FROM starts
  UNION ALL SELECT 'rolling_7d', 1, 'prior',     DATEADD(day, -13, a),  DATEADD(day, -7, a),   g <= 2 FROM starts
  UNION ALL SELECT 'rolling_7d', 1, 'last_year', DATEADD(day, -370, a), DATEADD(day, -364, a), g <= 2 FROM starts
  UNION ALL SELECT 'week', 2, 'current',   wk,                   DATEADD(day, 6, wk),    g <= 2 FROM starts
  UNION ALL SELECT 'week', 2, 'prior',     DATEADD(day, -7, wk), DATEADD(day, -1, wk),   g <= 2 FROM starts
  UNION ALL SELECT 'week', 2, 'last_year', DATEADD(day, -364, wk), DATEADD(day, -358, wk), g <= 2 FROM starts
  UNION ALL SELECT 'month', 3, 'current',   mo,                    LAST_DAY(mo),                    g <= 3 FROM starts
  UNION ALL SELECT 'month', 3, 'prior',     DATEADD(month, -1, mo),  LAST_DAY(DATEADD(month, -1, mo)),  g <= 3 FROM starts
  UNION ALL SELECT 'month', 3, 'last_year', DATEADD(month, -12, mo), LAST_DAY(DATEADD(month, -12, mo)), g <= 3 FROM starts
  UNION ALL SELECT 'year', 4, 'current', yr,                  DATEADD(day, -1, DATEADD(year, 1, yr)), TRUE FROM starts
  UNION ALL SELECT 'year', 4, 'prior',   DATEADD(year, -1, yr), DATEADD(day, -1, yr),                 TRUE FROM starts
  UNION ALL SELECT 'ytd', 5, 'current',   ytd,                   a,                    g <= 3 FROM starts
  UNION ALL SELECT 'ytd', 5, 'last_year', DATEADD(year, -1, ytd), DATEADD(year, -1, a), g <= 3 FROM starts)`;

// Complete buckets at every grain at or above the native grain, KPI formula recomputed per bucket.
const bucketCtes = (p) => `g0 AS (
  SELECT GROUPING_ID(d, DATE_TRUNC('week', d), DATE_TRUNC('month', d), DATE_TRUNC('year', d)) AS gid,
         COALESCE(d, DATE_TRUNC('week', d), DATE_TRUNC('month', d), DATE_TRUNC('year', d)) AS bucket,
         ${p.value_expr} AS value, COUNT(*) AS n
  FROM src
  GROUP BY GROUPING SETS ((d), (DATE_TRUNC('week', d)), (DATE_TRUNC('month', d)), (DATE_TRUNC('year', d)))),
b AS (
  SELECT DECODE(gid, 7, 'day', 11, 'week', 13, 'month', 14, 'year') AS grain,
         DECODE(gid, 7, 1, 11, 2, 13, 3, 14, 4) AS grank, bucket, value, n
  FROM g0, natg
  WHERE DECODE(gid, 7, 1, 11, 2, 13, 3, 14, 4) >= natg.g
    AND (bucket >= natg.lo OR DECODE(gid, 7, 1, 11, 2, 13, 3, 14, 4) = natg.g)
    AND DECODE(gid, 7, bucket, 11, DATEADD(day, 6, bucket), 13, LAST_DAY(bucket),
               14, DATEADD(day, -1, DATEADD(year, 1, bucket))) <= natg.eff_hi)`;

// ---- period comparison -------------------------------------------------------------

function periodComparisonSql(p) {
  const kk = kpiKind(p);
  const additive = isAdditive(kk);
  const hasMoments = kk.kind === 'count' || kk.kind === 'sum' || kk.kind === 'mean';
  const moments = hasMoments
    ? `SUM(${kk.m}) AS ms, SUM((${kk.m}) * (${kk.m})) AS mq, COUNT(${kk.m}) AS mc`
    : 'CAST(NULL AS FLOAT) AS ms, CAST(NULL AS FLOAT) AS mq, CAST(NULL AS FLOAT) AS mc';
  // Sampling-noise z: could this change plausibly be random variation in the rows?
  //  count/sum: compound-Poisson, reference scaled by period ratio; mean: Welch; ratio of sums: n/a.
  const z = (ref) => {
    if (additive) {
      const adj = `COALESCE(cp / NULLIF(${ref}p, 0), 1)`;
      return `ROUND((cs - ${ref}s * ${adj}) / NULLIF(SQRT(cq + ${ref}q * ${adj} * ${adj}), 0), 2)`;
    }
    if (kk.kind === 'mean') {
      return `ROUND((cs / NULLIF(cc, 0) - ${ref}s / NULLIF(${ref}c, 0))
             / NULLIF(SQRT(GREATEST(cq / NULLIF(cc, 0) - POWER(cs / NULLIF(cc, 0), 2), 0) / NULLIF(cc, 0)
                         + GREATEST(${ref}q / NULLIF(${ref}c, 0) - POWER(${ref}s / NULLIF(${ref}c, 0), 2), 0) / NULLIF(${ref}c, 0)), 0), 2)`;
    }
    return 'CAST(NULL AS FLOAT)';
  };
  const perPeriod = (a, b) => additive
    ? `ROUND(100 * (current_value / NULLIF(current_periods, 0) - ${a} / NULLIF(${b}, 0))
             / NULLIF(ABS(${a} / NULLIF(${b}, 0)), 0), 2)`
    : 'CAST(NULL AS FLOAT)';
  const pv = (role, col) => `MAX(IFF(j.role = '${role}', j.${col}, NULL))`;
  return `WITH ${kpiCtes(p)},
${windowCtes},
agg AS (
  SELECT w.period, w.role, ${p.value_expr} AS value, COUNT(*) AS n, COUNT(DISTINCT src.d) AS periods_with_data,
         ${moments}
  FROM src JOIN w ON src.d BETWEEN w.s AND w.e
  WHERE src.d >= (SELECT MIN(s) FROM w)
  GROUP BY 1, 2),
j AS (
  SELECT w.period, w.ord, w.role, w.s, w.e, w.applicable,
         IFF(w.applicable, a.value, NULL) AS value, IFF(w.applicable, COALESCE(a.n, 0), NULL) AS n,
         IFF(w.applicable, COALESCE(a.periods_with_data, 0), NULL) AS np,
         IFF(w.applicable, a.ms, NULL) AS ms, IFF(w.applicable, a.mq, NULL) AS mq, IFF(w.applicable, a.mc, NULL) AS mc
  FROM w LEFT JOIN agg a ON a.period = w.period AND a.role = w.role),
piv AS (
  SELECT j.period, j.ord,
         ANY_VALUE(natg.native_grain) AS native_grain,
         ANY_VALUE(natg.latest_period_excluded) AS latest_period_excluded,
         BOOLAND_AGG(j.applicable) AS applicable,
         ${pv('current', 's')} AS current_start, ${pv('current', 'e')} AS current_end,
         ${pv('current', 'value')} AS current_value, ${pv('prior', 'value')} AS prior_value, ${pv('last_year', 'value')} AS last_year_value,
         ${pv('current', 'n')} AS current_n, ${pv('prior', 'n')} AS prior_n, ${pv('last_year', 'n')} AS last_year_n,
         ${pv('current', 'np')} AS current_periods, ${pv('prior', 'np')} AS prior_periods, ${pv('last_year', 'np')} AS last_year_periods,
         ${pv('current', 'ms')} AS cs, ${pv('current', 'mq')} AS cq, ${pv('current', 'mc')} AS cc, ${pv('current', 'np')} AS cp,
         ${pv('prior', 'ms')} AS ps, ${pv('prior', 'mq')} AS pq, ${pv('prior', 'mc')} AS pc, ${pv('prior', 'np')} AS pp,
         ${pv('last_year', 'ms')} AS ls, ${pv('last_year', 'mq')} AS lq, ${pv('last_year', 'mc')} AS lc, ${pv('last_year', 'np')} AS lp
  FROM j, natg
  GROUP BY j.period, j.ord)
SELECT period, native_grain, latest_period_excluded, applicable, current_start, current_end,
       current_value, prior_value, last_year_value,
       ROUND(100 * (current_value - prior_value) / NULLIF(ABS(prior_value), 0), 2) AS pct_vs_prior,
       ROUND(100 * (current_value - last_year_value) / NULLIF(ABS(last_year_value), 0), 2) AS pct_vs_last_year,
       ${perPeriod('prior_value', 'prior_periods')} AS pct_vs_prior_per_period,
       ${perPeriod('last_year_value', 'last_year_periods')} AS pct_vs_last_year_per_period,
       ${z('p')} AS noise_z_vs_prior,
       ${z('l')} AS noise_z_vs_last_year,
       current_n, prior_n, last_year_n, current_periods, prior_periods, last_year_periods
FROM piv
ORDER BY ord`;
}

// ---- full-history patterns ---------------------------------------------------------
// "Typical change" (period-over-period and year-over-year) is measured over a reference window: the
// 3 years before the latest 13 buckets (all history for yearly data, or when < 40 buckets exist).
// Excluding the latest 13 stops the move being judged from inflating its own yardstick; the 3-year
// cap stops a start-up ramp from doing the same — over full history, weekly payment year-over-year
// p90 read 73% because 2021 was compared against a still-ramping 2020. No SQL comments in rendered
// queries: the MCP server's statement classifier is fragile.

function patternSql(p) {
  return `WITH ${kpiCtes(p)},
${bucketCtes(p)},
idx0 AS (
  SELECT grain, grank, bucket, value,
         ROW_NUMBER() OVER (PARTITION BY grain ORDER BY bucket) - 1 AS i,
         COUNT(*) OVER (PARTITION BY grain) AS cnt,
         ABS(value - LAG(value) OVER (PARTITION BY grain ORDER BY bucket))
           / NULLIF(ABS(LAG(value) OVER (PARTITION BY grain ORDER BY bucket)), 0) AS abs_chg
  FROM b),
idx AS (
  SELECT idx0.*,
         cnt < 40
           OR (i < cnt - 13
               AND i >= cnt - 13 - DECODE(grain, 'day', 1092, 'week', 156, 'month', 36, 'year', 1000)) AS in_ref
  FROM idx0),
yoy AS (
  SELECT c.grain,
         ROUND(100 * MEDIAN(ABS(c.value - p.value) / NULLIF(ABS(p.value), 0)), 2) AS typical_abs_yoy_change_pct,
         ROUND(100 * PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY ABS(c.value - p.value) / NULLIF(ABS(p.value), 0)), 2) AS p90_abs_yoy_change_pct
  FROM idx c
  JOIN b p ON p.grain = c.grain
          AND c.in_ref
          AND p.bucket = CASE c.grain WHEN 'day' THEN DATEADD(day, -364, c.bucket)
                                      WHEN 'week' THEN DATEADD(week, -52, c.bucket)
                                      WHEN 'month' THEN DATEADD(month, -12, c.bucket)
                                      ELSE DATEADD(year, -1, c.bucket) END
  GROUP BY c.grain),
trend AS (
  SELECT 'trend' AS pattern, grain, grank, COUNT(*) AS buckets, MIN(bucket) AS first_bucket, MAX(bucket) AS last_bucket,
         ROUND(100 * REGR_SLOPE(value, i) / NULLIF(ABS(AVG(value)), 0), 3) AS slope_pct_per_bucket,
         ROUND(REGR_R2(value, i), 3) AS r2,
         ROUND(100 * REGR_SLOPE(IFF(i >= cnt - 12, value, NULL), IFF(i >= cnt - 12, i, NULL))
               / NULLIF(ABS(AVG(IFF(i >= cnt - 12, value, NULL))), 0), 3) AS recent12_slope_pct,
         ROUND(REGR_R2(IFF(i >= cnt - 12, value, NULL), IFF(i >= cnt - 12, i, NULL)), 3) AS recent12_r2,
         ROUND(100 * MEDIAN(IFF(in_ref, abs_chg, NULL)), 2) AS typical_abs_change_pct,
         ROUND(100 * PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY IFF(in_ref, abs_chg, NULL)), 2) AS p90_abs_change_pct
  FROM idx
  GROUP BY grain, grank),
dow AS (
  SELECT DAYNAME(bucket) AS grp, MOD(DATEDIFF(week, '2000-01-03'::DATE, bucket), 2) AS half,
         value / NULLIF(AVG(value) OVER (PARTITION BY DATE_TRUNC('week', bucket)), 0) AS ix
  FROM b WHERE grain = 'day'),
moy AS (
  SELECT MONTHNAME(bucket) AS grp, MOD(YEAR(bucket), 2) AS half,
         value / NULLIF(AVG(value) OVER (ORDER BY bucket ROWS BETWEEN 6 PRECEDING AND 5 FOLLOWING), 0) AS ix,
         COUNT(*) OVER (ORDER BY bucket ROWS BETWEEN 6 PRECEDING AND 5 FOLLOWING) AS win
  FROM b WHERE grain = 'month'),
seas_in AS (
  SELECT 'seasonality_day_of_week' AS pattern, grp, half, ix FROM dow
  UNION ALL
  SELECT 'seasonality_month_of_year' AS pattern, grp, half, ix FROM moy WHERE win = 12),
seas_grp AS (
  SELECT pattern, grp, AVG(ix) AS m, STDDEV(ix) AS sd, COUNT(*) AS k,
         AVG(IFF(half = 0, ix, NULL)) AS m0, AVG(IFF(half = 1, ix, NULL)) AS m1
  FROM seas_in GROUP BY 1, 2),
seas AS (
  SELECT pattern, SUM(k) AS buckets,
         MAX_BY(grp, m) AS peak, MIN_BY(grp, m) AS trough,
         ROUND(100 * (MAX(m) - MIN(m)), 2) AS spread_pct,
         ROUND((MAX(m) - MIN(m)) / NULLIF(AVG(sd / SQRT(k)), 0), 2) AS signal_to_noise,
         ROUND(CORR(m0, m1), 3) AS repeatability
  FROM seas_grp
  GROUP BY pattern
  HAVING MIN(k) >= 2),
result AS (
  SELECT t.pattern, t.grain, t.grank, t.buckets, t.first_bucket, t.last_bucket,
         t.slope_pct_per_bucket, t.r2, t.recent12_slope_pct, t.recent12_r2,
         t.typical_abs_change_pct, t.p90_abs_change_pct,
         y.typical_abs_yoy_change_pct, y.p90_abs_yoy_change_pct,
         CAST(NULL AS VARCHAR) AS peak, CAST(NULL AS VARCHAR) AS trough,
         CAST(NULL AS FLOAT) AS spread_pct, CAST(NULL AS FLOAT) AS signal_to_noise, CAST(NULL AS FLOAT) AS repeatability
  FROM trend t LEFT JOIN yoy y ON y.grain = t.grain
  UNION ALL
  SELECT s.pattern, CAST(NULL AS VARCHAR), 9, s.buckets, CAST(NULL AS DATE), CAST(NULL AS DATE),
         CAST(NULL AS FLOAT), CAST(NULL AS FLOAT), CAST(NULL AS FLOAT), CAST(NULL AS FLOAT),
         CAST(NULL AS FLOAT), CAST(NULL AS FLOAT), CAST(NULL AS FLOAT), CAST(NULL AS FLOAT),
         s.peak, s.trough, s.spread_pct, s.signal_to_noise, s.repeatability
  FROM seas s)
SELECT result.pattern, result.grain, natg.native_grain, natg.latest_period_excluded, result.buckets, result.first_bucket, result.last_bucket,
       result.slope_pct_per_bucket, result.r2, result.recent12_slope_pct, result.recent12_r2,
       result.typical_abs_change_pct, result.p90_abs_change_pct,
       result.typical_abs_yoy_change_pct, result.p90_abs_yoy_change_pct,
       result.peak, result.trough, result.spread_pct, result.signal_to_noise, result.repeatability
FROM result, natg
ORDER BY result.grank, result.pattern`;
}

// ---- out-of-sample baseline --------------------------------------------------------
// Tests the latest complete bucket at the KPI's grain (never finer than the native grain) against
// up to 104 *prior* buckets. The tested bucket is excluded from its own baseline, trend is removed
// when real (r² ≥ 0.3 over the reference), and a multiplicative day-of-week / month-of-year index
// is applied only when it repeats across both halves of the reference. Bounds are in the KPI's own
// units for the tested bucket; counts/sums are floored at 0 and rates capped at 1.

function baselineSql(p) {
  const kk = kpiKind(p);
  const G = GRAIN_RANK[p.grain] || 2;
  const isRate = kk.kind === 'mean' || kk.kind === 'ratio';
  return `WITH ${kpiCtes(p)},
${bucketCtes(p)},
sel AS (SELECT grain, bucket, value, n FROM b, natg WHERE grank = GREATEST(${G}, natg.g)),
ix AS (SELECT grain, bucket, value, n, ROW_NUMBER() OVER (ORDER BY bucket DESC) AS back FROM sel),
ref AS (
  SELECT grain, bucket, value, -back AS t,
         IFF(grain = 'month', MONTH(bucket), IFF(grain = 'day', DAYOFWEEKISO(bucket), NULL)) AS skey,
         IFF(grain = 'day', MOD(DATEDIFF(week, '2000-01-03'::DATE, bucket), 2), MOD(YEAR(bucket), 2)) AS half
  FROM ix WHERE back BETWEEN 2 AND 105),
fit AS (
  SELECT REGR_SLOPE(value, t) AS slope, REGR_INTERCEPT(value, t) AS icpt, REGR_R2(value, t) AS r2,
         COUNT(*) AS n_ref, MEDIAN(value) AS med, AVG(value) AS mean_ref, MIN(value) AS min_ref, MAX(value) AS max_ref,
         MIN(bucket) AS ref_first, MAX(bucket) AS ref_last
  FROM ref),
fitu AS (SELECT fit.*, COALESCE(r2 >= 0.3 AND n_ref >= 8, FALSE) AS use_trend FROM fit),
f1 AS (SELECT r.*, IFF(u.use_trend, u.icpt + u.slope * r.t, u.med) AS base_fit FROM ref r, fitu u),
sk AS (
  SELECT skey, AVG(value / NULLIF(base_fit, 0)) AS sidx, COUNT(*) AS k,
         AVG(IFF(half = 0, value / NULLIF(base_fit, 0), NULL)) AS m0,
         AVG(IFF(half = 1, value / NULLIF(base_fit, 0), NULL)) AS m1
  FROM f1 WHERE skey IS NOT NULL GROUP BY skey),
su AS (
  SELECT CORR(m0, m1) AS rep, MIN(k) AS mink, COUNT(*) AS nkeys,
         COALESCE(CORR(m0, m1) >= 0.4 AND MIN(k) >= 3 AND COUNT(*) IN (7, 12), FALSE) AS use_seas
  FROM sk),
f2 AS (
  SELECT f1.value, f1.base_fit * IFF(su.use_seas, COALESCE(sk.sidx, 1), 1) AS expected
  FROM f1 CROSS JOIN su LEFT JOIN sk ON sk.skey = f1.skey),
rs AS (SELECT MEDIAN(value - expected) AS med_r, STDDEV(value - expected) AS sd_r FROM f2),
rm AS (SELECT MEDIAN(ABS(f2.value - f2.expected - rs.med_r)) AS mad_r FROM f2, rs),
tst AS (
  SELECT grain, bucket, value, n,
         IFF(grain = 'month', MONTH(bucket), IFF(grain = 'day', DAYOFWEEKISO(bucket), NULL)) AS skey
  FROM ix WHERE back = 1),
calc AS (
  SELECT tst.grain, tst.bucket, tst.value, tst.n,
         IFF(u.use_trend, u.icpt - u.slope, u.med) * IFF(su.use_seas, COALESCE(sk.sidx, 1), 1) + rs.med_r AS expected,
         COALESCE(NULLIF(1.4826 * rm.mad_r, 0), rs.sd_r) AS scale,
         u.n_ref, u.r2, u.use_trend, u.slope, u.mean_ref, u.min_ref, u.max_ref, u.ref_first, u.ref_last,
         su.use_seas, su.rep
  FROM tst CROSS JOIN fitu u CROSS JOIN su CROSS JOIN rs CROSS JOIN rm LEFT JOIN sk ON sk.skey = tst.skey),
pr AS (
  SELECT AVG(IFF(f2.value - f2.expected <= c.value - c.expected + rs.med_r, 1, 0)) AS pct_rank
  FROM f2 CROSS JOIN calc c CROSS JOIN rs),
bnd AS (
  SELECT c.*, pr.pct_rank,
         c.expected - 3.0 * c.scale AS wl, c.expected + 3.0 * c.scale AS wu,
         c.expected - 3.5 * c.scale AS cl, c.expected + 3.5 * c.scale AS cu
  FROM calc c, pr)
SELECT bnd.grain AS grain_used, natg.native_grain, natg.latest_period_excluded,
       bnd.bucket AS tested_bucket, bnd.value AS current_value, bnd.n AS current_rows,
       ROUND(bnd.expected, 4) AS expected_value,
       ROUND(bnd.value - bnd.expected, 4) AS residual,
       ROUND((bnd.value - bnd.expected) / NULLIF(bnd.scale, 0), 2) AS robust_z,
       ROUND(bnd.pct_rank, 3) AS residual_percentile,
       ${isRate ? `IFF(bnd.min_ref >= 0, GREATEST(0, bnd.wl), bnd.wl)` : `IFF(bnd.min_ref >= 0, GREATEST(0, bnd.wl), bnd.wl)`} AS warn_lower,
       ${isRate ? `IFF(bnd.max_ref <= 1 AND bnd.min_ref >= 0, LEAST(1, bnd.wu), bnd.wu)` : 'bnd.wu'} AS warn_upper,
       IFF(bnd.min_ref >= 0, GREATEST(0, bnd.cl), bnd.cl) AS crit_lower,
       ${isRate ? `IFF(bnd.max_ref <= 1 AND bnd.min_ref >= 0, LEAST(1, bnd.cu), bnd.cu)` : 'bnd.cu'} AS crit_upper,
       bnd.n_ref AS reference_buckets, bnd.ref_first AS reference_first, bnd.ref_last AS reference_last,
       bnd.use_trend AS trend_removed, ROUND(bnd.r2, 3) AS reference_trend_r2,
       ROUND(100 * bnd.slope / NULLIF(ABS(bnd.mean_ref), 0), 3) AS reference_slope_pct_per_bucket,
       bnd.use_seas AS seasonality_removed, ROUND(bnd.rep, 3) AS seasonal_repeatability,
       ROUND(bnd.scale, 4) AS residual_scale
FROM bnd, natg`;
}

// ---- monitoring ingest ------------------------------------------------------------
// Long-format series for a downstream monitor: complete buckets only, at the same grain baseline_sql
// tests (KPI grain, never finer than native), full history so the monitor can train on it.

function metricSeriesSql(p) {
  const G = GRAIN_RANK[p.grain] || 2;
  return `WITH ${kpiCtes(p)},
${bucketCtes(p)}
SELECT b.bucket AS metric_timestamp, '${p.kpi_id}' AS metric_name, b.value AS metric_value
FROM b, natg
WHERE b.grank = GREATEST(${G}, natg.g)
ORDER BY b.bucket`;
}

// ---- attribution -------------------------------------------------------------------
// Exact decomposition of the change between two windows by category.
//   additive: contribution = current − reference × (current periods / reference periods)
//   rate:     contribution = w̄·Δr (rate effect) + Δw·(r̄ − R̄) (mix effect), where w is the category's
//             share of the denominator and r its rate. Contributions sum exactly to the total change,
//             so "X explains 70% of the rise" is arithmetic, not a guess — and a small category whose
//             rate swings wildly can't top the list, because its weight is small.

const HORIZON_REFS = { rolling_7d: ['prior', 'last_year'], week: ['prior', 'last_year'], month: ['prior', 'last_year'], year: ['prior'], ytd: ['last_year'] };

function breakdownSql(p, dim, horizon, vs) {
  const kk = kpiKind(p);
  if (kk.kind === 'other') throw new Error(`KPI formula "${p.value_expr}" can't be decomposed (COUNT DISTINCT or unrecognised shape) — set kpi_kind/num_expr/den_expr/m_expr explicitly.`);
  if (!HORIZON_REFS[horizon]) throw new Error(`--horizon must be one of ${Object.keys(HORIZON_REFS).join(', ')}`);
  if (!HORIZON_REFS[horizon].includes(vs)) throw new Error(`--vs for ${horizon} must be ${HORIZON_REFS[horizon].join(' or ')}`);
  const additive = isAdditive(kk);
  const numAgg = additive ? `SUM(${kk.m})` : `SUM(${kk.num})`;
  const denAgg = additive ? 'CAST(NULL AS FLOAT)' : `SUM(${kk.den})`;
  const from = `(SELECT ${dim.base_alias ? `${dim.base_alias}.*` : '*'}, ${dim.dim_expr} AS kpi_cat FROM ${dim.from_clause})`;
  const rows = additive
    ? `SELECT c.category, c.n0 AS reference_rows, c.n1 AS current_rows,
         c.num0 AS reference_value, c.num1 AS current_value,
         COALESCE(c.num1, 0) - COALESCE(c.num0, 0) * t.adj AS contribution,
         CAST(NULL AS FLOAT) AS rate_effect, CAST(NULL AS FLOAT) AS mix_effect
       FROM c, t`
    : `SELECT c.category, c.n0 AS reference_rows, c.n1 AS current_rows,
         c.num0 / NULLIF(c.den0, 0) AS reference_value, c.num1 / NULLIF(c.den1, 0) AS current_value,
         (COALESCE(c.den1, 0) / NULLIF(t.D1, 0) + COALESCE(c.den0, 0) / NULLIF(t.D0, 0)) / 2
           * (COALESCE(current_value, reference_value) - COALESCE(reference_value, current_value)) AS rate_effect,
         (COALESCE(c.den1, 0) / NULLIF(t.D1, 0) - COALESCE(c.den0, 0) / NULLIF(t.D0, 0))
           * ((COALESCE(current_value, reference_value) + COALESCE(reference_value, current_value)) / 2
              - (t.N1 / NULLIF(t.D1, 0) + t.N0 / NULLIF(t.D0, 0)) / 2) AS mix_effect,
         rate_effect + mix_effect AS contribution
       FROM c, t`;
  const total = additive
    ? `t.N0 AS reference_value, t.N1 AS current_value, t.N1 - t.N0 * t.adj AS contribution,
       CAST(NULL AS FLOAT) AS rate_effect, CAST(NULL AS FLOAT) AS mix_effect`
    : `t.N0 / NULLIF(t.D0, 0) AS reference_value, t.N1 / NULLIF(t.D1, 0) AS current_value,
       t.N1 / NULLIF(t.D1, 0) - t.N0 / NULLIF(t.D0, 0) AS contribution,
       (SELECT SUM(rate_effect) FROM r) AS rate_effect, (SELECT SUM(mix_effect) FROM r) AS mix_effect`;
  return `WITH ${srcCte(p, from)},
${grainCtes},
${windowCtes},
wsel AS (SELECT * FROM w WHERE period = '${horizon}' AND role IN ('current', '${vs}')),
per AS (
  SELECT wsel.role, COALESCE(TO_VARCHAR(src.kpi_cat), '(no value)') AS category,
         ${numAgg} AS num, ${denAgg} AS den, COUNT(*) AS n
  FROM src JOIN wsel ON src.d BETWEEN wsel.s AND wsel.e AND wsel.applicable
  GROUP BY 1, 2),
np AS (
  SELECT wsel.role, COUNT(DISTINCT src.d) AS np
  FROM src JOIN wsel ON src.d BETWEEN wsel.s AND wsel.e AND wsel.applicable
  GROUP BY 1),
c AS (
  SELECT category,
         MAX(IFF(role = 'current', num, NULL)) AS num1, MAX(IFF(role = '${vs}', num, NULL)) AS num0,
         MAX(IFF(role = 'current', den, NULL)) AS den1, MAX(IFF(role = '${vs}', den, NULL)) AS den0,
         MAX(IFF(role = 'current', n, NULL)) AS n1, MAX(IFF(role = '${vs}', n, NULL)) AS n0
  FROM per GROUP BY category),
t AS (
  SELECT SUM(num1) AS N1, SUM(num0) AS N0, SUM(den1) AS D1, SUM(den0) AS D0,
         SUM(n1) AS NR1, SUM(n0) AS NR0, COUNT(*) AS ncat,
         (SELECT MAX(IFF(role = 'current', np, NULL)) FROM np) AS np1,
         (SELECT MAX(IFF(role = '${vs}', np, NULL)) FROM np) AS np0,
         ${additive ? `COALESCE((SELECT MAX(IFF(role = 'current', np, NULL)) FROM np)
                   / NULLIF((SELECT MAX(IFF(role = '${vs}', np, NULL)) FROM np), 0), 1)` : '1'} AS adj
  FROM c),
r AS (${rows}),
ranked AS (SELECT r.*, ROW_NUMBER() OVER (ORDER BY ABS(contribution) DESC NULLS LAST) AS rk FROM r),
body AS (
  SELECT rk, category, reference_rows, current_rows, reference_value, current_value, contribution, rate_effect, mix_effect
  FROM ranked WHERE rk <= 15
  UNION ALL
  SELECT 16, '(all other ' || COUNT(*) || ' categories)', SUM(reference_rows), SUM(current_rows),
         CAST(NULL AS FLOAT), CAST(NULL AS FLOAT), SUM(contribution), SUM(rate_effect), SUM(mix_effect)
  FROM ranked WHERE rk > 15 HAVING COUNT(*) > 0
  UNION ALL
  SELECT 0, 'TOTAL', t.NR0, t.NR1, ${total}
  FROM t)
SELECT body.category,
       ROUND(body.reference_value, 4) AS reference_value, ROUND(body.current_value, 4) AS current_value,
       ROUND(body.contribution, 4) AS contribution,
       ROUND(100 * body.contribution / NULLIF((SELECT contribution FROM body WHERE rk = 0), 0), 1) AS pct_of_total_change,
       ROUND(body.rate_effect, 4) AS rate_effect, ROUND(body.mix_effect, 4) AS mix_effect,
       body.reference_rows, body.current_rows,
       LEAST(COALESCE(body.reference_rows, 0), COALESCE(body.current_rows, 0)) < 30 AND body.rk BETWEEN 1 AND 15 AS low_volume,
       '${kk.kind}' AS kpi_kind, '${horizon}' AS horizon, '${vs}' AS compared_with,
       (SELECT MAX(IFF(role = 'current', s, NULL)) FROM wsel) AS current_start,
       (SELECT MAX(IFF(role = 'current', e, NULL)) FROM wsel) AS current_end,
       (SELECT MAX(IFF(role = '${vs}', s, NULL)) FROM wsel) AS reference_start,
       (SELECT MAX(IFF(role = '${vs}', e, NULL)) FROM wsel) AS reference_end,
       (SELECT np1 FROM t) AS current_periods, (SELECT np0 FROM t) AS reference_periods,
       (SELECT BOOLAND_AGG(applicable) FROM wsel) AS applicable,
       (SELECT native_grain FROM natg) AS native_grain
FROM body
ORDER BY body.rk`;
}

// ---- apply ------------------------------------------------------------------------

// A JS `undefined`/`null`/`NaN` interpolated into SQL means a building block is missing; never emit it.
function assertClean(label, sql) {
  const bad = sql.match(/\b(undefined|NaN)\b|\(null\)/);
  if (bad) { console.error(`Refusing to emit ${label}: rendered SQL contains "${bad[0]}" — a building block is missing.`); process.exit(3); }
}

const doc = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
const printArgs = (() => { const i = args.indexOf('--print'); return i >= 0 ? [args[i + 1], args[i + 2]] : null; })();
const listDims = opt('--list-dims');
const focus = printArgs?.[0] || listDims;
const kpis = (doc.kpis || []).filter((k) => (!only || only.includes(k.kpi_id)) && (!focus || k.kpi_id === focus));
if (focus && kpis.length === 0) { console.error(`Unknown KPI ${focus}.`); process.exit(1); }

const rendered = [];
const failed = [];
const dimFailed = [];
const sqlById = {};

for (const k of kpis) {
  if (!(k.table_fqn && k.date_expr && k.value_expr)) {
    const parts = deriveParts(k);
    if (!parts) { failed.push(k.kpi_id); continue; }
    Object.assign(k, parts, { sql_parts_source: 'derived_from_series_sql' });
  }
  k.kpi_kind = kpiKind(k).kind;
  for (const bd of k.dimension_breakdowns || []) {
    if (bd.dim_expr && bd.from_clause) continue;
    const dp = deriveDim(bd);
    if (dp) Object.assign(bd, dp, { dim_parts_source: 'derived_from_breakdown_sql' });
    else dimFailed.push(`${k.kpi_id}:${bd.dimension_column}`);
  }
  delete k.period_comparison_sql;   // older runs may have inlined these; the manifest shouldn't carry them
  delete k.pattern_sql;
  sqlById[k.kpi_id] = { period_comparison_sql: periodComparisonSql(k), pattern_sql: patternSql(k), baseline_sql: baselineSql(k), metric_series_sql: metricSeriesSql(k) };
  for (const [f, sql] of Object.entries(sqlById[k.kpi_id])) assertClean(`${k.kpi_id}:${f}`, sql);
  for (const bd of (k.dimension_breakdowns || []).filter((x) => x.dim_expr)) {
    for (const [h, refs] of Object.entries(HORIZON_REFS)) {
      for (const vs of refs) if (kpiKind(k).kind !== 'other') assertClean(`${k.kpi_id}:breakdown ${bd.dimension_column} ${h}/${vs}`, breakdownSql(k, bd, h, vs));
    }
  }
  rendered.push(k.kpi_id);
}

if (listDims) {
  const k = kpis[0];
  const dims = (k.dimension_breakdowns || []).filter((bd) => bd.dim_expr);
  console.log(dims.length ? dims.map((bd) => `${bd.dimension_column}\t${bd.source_table ?? ''}`).join('\n') : '(no usable breakdown dimensions)');
  process.exit(0);
}

if (printArgs) {
  const [id, field] = printArgs;
  const k = kpis[0];
  if (!sqlById[id]) { console.error(`No building blocks for ${id} and none derivable from its series_sql.`); process.exit(1); }
  let sql;
  if (field === 'breakdown_sql') {
    const col = opt('--dim');
    const dims = (k.dimension_breakdowns || []).filter((bd) => bd.dim_expr);
    const dim = dims.find((bd) => bd.dimension_column?.toLowerCase() === col?.toLowerCase());
    if (!dim) { console.error(`--dim must be one of: ${dims.map((bd) => bd.dimension_column).join(', ') || '(none available)'}`); process.exit(1); }
    try { sql = breakdownSql(k, dim, opt('--horizon'), opt('--vs')); } catch (e) { console.error(e.message); process.exit(1); }
  } else {
    sql = sqlById[id][field];
  }
  if (!sql) { console.error(`Unknown field ${field}. Use period_comparison_sql, pattern_sql, baseline_sql, metric_series_sql or breakdown_sql.`); process.exit(1); }
  assertClean(`${id}:${field}`, sql);
  process.stdout.write(sql + '\n');
  process.exit(0);
}

console.log(`Rendered ${rendered.length} KPI(s)${failed.length ? `; could not derive building blocks for ${failed.length}: ${failed.join(', ')}` : ''}.`);
if (dimFailed.length) console.log(`Could not derive breakdown building blocks for: ${dimFailed.join(', ')} — set dim_expr/from_clause/base_alias by hand.`);

if (opt('--sidecar')) {
  fs.writeFileSync(opt('--sidecar'), JSON.stringify(sqlById, null, 2));
  console.log(`Wrote rendered SQL for ${rendered.length} KPI(s) to ${opt('--sidecar')}`);
}

if (opt('--validation-sql')) {
  // One statement per batch. Each rendered query is wrapped as a counted subquery; UNION ALL
  // lives inside a CTE because the Snowflake MCP server rejects a top-level UNION.
  const items = rendered.flatMap((id) => Object.entries(sqlById[id]).map(([f, sql]) => [`${id}:${f}`, sql]));
  const stmts = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const body = items.slice(i, i + batchSize)
      .map(([label, sql]) => `  SELECT '${label}' AS q, COUNT(*) AS n FROM (\n${sql}\n  )`).join('\n  UNION ALL\n');
    stmts.push(`WITH batch AS (\n${body}\n)\nSELECT * FROM batch`);
  }
  fs.writeFileSync(opt('--validation-sql'), stmts.join('\n;\n-- ----\n'));
  console.log(`Wrote ${stmts.length} validation statement(s) to ${opt('--validation-sql')}`);
}

if (args.includes('--write')) {
  fs.writeFileSync(file, JSON.stringify(doc, null, 2));
  console.log(`Updated ${file} (building blocks only — no rendered SQL stored)`);
}
if (failed.length || dimFailed.length) process.exit(2);
