// Local, grounded response generator — no network call. Every answer is built
// only from the KPI's own record (why/reasons/correlations/forecast/audit),
// same idea as the original design's `canned()` fallback, extended to our
// real fields and honest about what isn't known.
import { fmt } from './format.js'

function topReason(kpi) {
  return kpi.reasons[0]
}

export function answer(kpi, question) {
  const t = question.toLowerCase()
  const r = topReason(kpi)

  if (t.includes('confid')) {
    return (
      `Overall baseline confidence is ${kpi.confidence}. ` +
      (r
        ? `The top reason ("${r.text}") is tagged ${r.strength} evidence — ${r.method} `
        : '') +
      (kpi.forecast
        ? `The forecast itself is ${kpi.forecast.confidence} confidence (method: ${kpi.forecast.method}).`
        : '')
    )
  }

  if (t.includes('correlat') || t.includes('relat')) {
    if (!kpi.correlations.length) {
      return `No correlations were computed for this KPI this pass — it wasn't part of the manifest's correlation set (only 5 of 15 KPIs are).`
    }
    return kpi.correlations
      .map((c) => `${c.name} (r = ${c.r >= 0 ? '+' : ''}${c.r.toFixed(3)}, n=${c.nOverlap}): ${c.note}`)
      .join(' ')
  }

  if (t.includes('fix') || t.includes('action') || t.includes('do about') || t.includes('recommend')) {
    if (kpi.auditStatus && kpi.auditStatus !== 'n/a') {
      return `This pipeline doesn't produce a prescribed remediation — that's a business call. What it does have: ${kpi.auditStatus} Combined with the current state (${kpi.state}, ${kpi.confidence} confidence), that's the evidence to work from.`
    }
    return `This pipeline doesn't produce a prescribed action — it stops at detection, attribution and forecasting. Current read: ${kpi.why}`
  }

  if (t.includes('project') || t.includes('forecast') || t.includes('predict') || t.includes('when') || t.includes('next week')) {
    if (!kpi.forecast) return `No forecast was computed for this KPI.`
    const f = kpi.forecast
    return (
      `Trend-band projection for next week: ${fmt(kpi, f.next)} (range ${fmt(kpi, f.lower)}–${fmt(kpi, f.upper)}), ${f.confidence} confidence. ` +
      (f.method === 'recommend_ml_forecast'
        ? `The underlying trend is strong enough that this KPI is flagged for a real trained forecast (SNOWFLAKE.ML.FORECAST) rather than trusting this straight-line extrapolation as a final answer.`
        : `No grain showed a strong enough trend to recommend a trained model — this is the best available estimate.`)
    )
  }

  if (t.includes('why') || t.includes('cause') || t.includes('driv') || t.includes('reason')) {
    return kpi.why + (r ? ` Top ranked factor: "${r.text}" (${r.strength} evidence) — ${r.evidence}` : '')
  }

  if (t.includes('segment') || t.includes('who') || t.includes('where')) {
    return r
      ? `${r.text} — ${r.evidence}`
      : `No segment-level breakdown was computed for this KPI.`
  }

  if (t.includes('audit') || t.includes('data quality') || t.includes('trust') || t.includes('reconcil')) {
    return kpi.auditStatus && kpi.auditStatus !== 'n/a'
      ? kpi.auditStatus
      : `No audit/reconciliation check was run against this KPI's table this pass.`
  }

  if (t.includes('stale') || t.includes('fresh') || t.includes('current') || t.includes('up to date')) {
    return `This KPI's source data is as of ${kpi.asOfDate}. ${kpi.table} was last checked for freshness against a 14-day threshold at manifest-generation time.`
  }

  // default — same shape as the design's fallback
  return r
    ? `${r.text} (${r.strength} evidence) — ${r.evidence}`
    : kpi.why
}

export function suggestionsFor(kpi) {
  const base = ['How confident are we in this?', 'What does the forecast say?']
  if (kpi.correlations.length) base.push('Which KPIs correlate with this?')
  if (kpi.auditStatus && kpi.auditStatus !== 'n/a') base.push('Does this reconcile against other tables?')
  base.push('What would it take to fix this?')
  return base.slice(0, 4)
}
