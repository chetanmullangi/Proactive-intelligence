import AnomalyChart from './AnomalyChart.jsx'
import { fmt, pctChange, shortDate } from '../lib/format.js'
import { statusMeta } from '../data/kpis.js'
import { riskById, impactMeta } from '../data/risks.js'

const card = { borderRadius: 14, background: '#fff', border: '1px solid var(--line)', padding: '20px 22px' }
const label = { fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 3 }
const linkRow = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', border: '1px solid var(--line)', borderRadius: 10, padding: '11px 14px', background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }

// The detector's per-comparison verdict (noise test + the KPI's own normal range), in plain words.
const VERDICT = {
  normal: { label: 'Normal', fg: '#1F7A5A', bg: '#E6F1EB' },
  modest: { label: 'A bit different', fg: '#5B6170', bg: '#EEF0F4' },
  unusual: { label: 'Unusual', fg: '#8A6410', bg: '#F8F0DC' },
  extreme: { label: 'Far outside normal', fg: '#B4451F', bg: '#F8EAE3' },
  'too thin': { label: 'Too little activity', fg: '#5B6170', bg: '#EEF0F4' },
}
const GRAIN_NOTE = {
  month: 'This is recorded monthly, so there is no 7-day or weekly view.',
  year: 'This is a yearly summary, so only the full-year comparison applies.',
  week: null,
  day: null,
}

// "2025" for a full year; otherwise "Jun 1 – Jun 30, 2026", so a reader always knows which period it is.
function windowLabel(c) {
  const y = String(c.currentEnd ?? '').slice(0, 4)
  if (c.period === 'year') return String(c.currentStart ?? '').slice(0, 4)
  return c.currentStart === c.currentEnd ? `${shortDate(c.currentStart)}, ${y}` : `${shortDate(c.currentStart)} – ${shortDate(c.currentEnd)}, ${y}`
}

function Change({ label: text, pct, verdict }) {
  const v = VERDICT[verdict]
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6 }}>
      <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{text}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="mono" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{pctChange(pct)}</span>
        {v && <span style={{ fontSize: 10.5, fontWeight: 600, borderRadius: 999, padding: '2px 7px', color: v.fg, background: v.bg }}>{v.label}</span>}
      </span>
    </div>
  )
}

function Comparisons({ kpi }) {
  const rows = (kpi.periodComparisons || []).filter((c) => c.applicable && (c.pctVsPrior !== null || c.pctVsLastYear !== null))
  if (!rows.length && !kpi.plainComparison) return null
  const excluded = (kpi.periodComparisons || []).some((c) => c.latestPeriodExcluded)
  return (
    <div style={card}>
      <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--pri-hover)' }}>How it compares</h2>
      {kpi.plainComparison && <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.6, color: 'var(--ink)' }}>{kpi.plainComparison}</p>}
      {rows.length > 0 && (
        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}>
          {rows.map((c) => (
            <div key={c.period} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '11px 13px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>{c.label}</span>
                {!c.verdictVsPrior && !c.verdictVsLastYear && VERDICT[c.verdict] && (
                  <span style={{ fontSize: 10.5, fontWeight: 600, borderRadius: 999, padding: '2px 7px', color: VERDICT[c.verdict].fg, background: VERDICT[c.verdict].bg }}>{VERDICT[c.verdict].label}</span>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 1 }}>
                {windowLabel(c)}
                {c.current !== null ? ` · ${fmt(kpi, c.current)}` : ''}
              </div>
              {c.pctVsPrior !== null && <Change label="vs the period before" pct={c.pctVsPrior} verdict={c.verdictVsPrior} />}
              {c.pctVsLastYear !== null && <Change label="vs same time last year" pct={c.pctVsLastYear} verdict={c.verdictVsLastYear} />}
            </div>
          ))}
        </div>
      )}
      {!kpi.plainComparison && (GRAIN_NOTE[kpi.grain] || excluded) && (
        <p style={{ margin: '12px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--ink-3)' }}>
          {GRAIN_NOTE[kpi.grain]}{GRAIN_NOTE[kpi.grain] && excluded ? ' ' : ''}
          {excluded ? 'The latest period is still in progress, so the comparisons use the last complete one.' : ''}
        </p>
      )}
      <p style={{ margin: '8px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--ink-3)' }}>
        "Normal" means the change is within this measure's usual ups and downs, or too small to tell apart from everyday variation.
      </p>
    </div>
  )
}

// Business-only page. No statistics, thresholds, or model output — a
// non-technical reader gets everything they need here: what's happening,
// why, what to do about it, a plain trend picture, and links to whatever
// else in the app actually relates to it.
export default function KpiDetail({ kpi, onOpenKpi, onOpenRisk }) {
  const meta = statusMeta[kpi.statusTier]
  const relatedRisks = (kpi.relatedRiskIds || []).map(riskById).filter(Boolean)
  const hasRelated = kpi.correlations.length > 0 || relatedRisks.length > 0

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: '24px clamp(14px,2vw,28px) 56px', display: 'flex', flexDirection: 'column', gap: 20, animation: 'fadeUp 200ms ease both' }}>

      <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 24, alignItems: 'center' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, borderRadius: 999, padding: '4px 10px', color: meta.fg, background: meta.bg }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: meta.mark }} />{meta.label}
            </span>
          </div>
          <h1 style={{ margin: '12px 0 0', fontSize: 28, lineHeight: 1.15, letterSpacing: '-0.025em', fontWeight: 600 }}>{kpi.name}</h1>
          {kpi.definition && (
            <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.5, color: 'var(--ink-3)' }}>{kpi.definition}</p>
          )}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 14, flexWrap: 'wrap' }}>
            <div className="mono" style={{ fontSize: 40, fontWeight: 600, letterSpacing: '-0.035em', lineHeight: 1 }}>{fmt(kpi, kpi.value)}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: meta.fg }}>{kpi.plainStatus}</div>
          </div>
        </div>
        <div style={{ borderLeft: '1px solid var(--line)', paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={label}>{kpi.issue ? "What's happening" : "What's happening and why"}</div>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--ink)' }}>{kpi.issue || kpi.plainReason}</p>
          </div>
          {kpi.cause && (
            <div>
              <div style={label}>Why</div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--ink)' }}>{kpi.cause}</p>
            </div>
          )}
          {kpi.action && (
            <div>
              <div style={label}>Bottom line / what to do</div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, fontWeight: 600, color: 'var(--ink)' }}>{kpi.action}</p>
            </div>
          )}
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-3)' }}>{kpi.plainConfidence}</p>
        </div>
      </div>

      <Comparisons kpi={kpi} />

      <div style={card}>
        <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--pri-hover)' }}>Trend</h2>
        <div style={{ marginTop: 14 }}>
          <AnomalyChart kpi={kpi} />
        </div>
      </div>

      {hasRelated && (
        <div style={card}>
          <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--pri-hover)' }}>Related</h2>
          <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 10 }}>
            {kpi.correlations.map((c) => (
              <button key={c.toId} style={linkRow} onClick={() => onOpenKpi(c.toId)}>
                <span style={{ fontSize: 16, color: 'var(--ink-3)' }}>↗</span>
                <span style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{c.name}</div>
                  <div style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--ink-3)', marginTop: 2 }}>{c.note}</div>
                </span>
              </button>
            ))}
            {relatedRisks.map((r) => {
              const rMeta = impactMeta[r.impact]
              return (
                <button key={r.id} style={linkRow} onClick={() => onOpenRisk(r.id)}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: rMeta.mark, flexShrink: 0 }} />
                  <span style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{r.headline}</div>
                    <div style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--ink-3)', marginTop: 2 }}>Proactive risk brief · {rMeta.label}</div>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
