import AnomalyChart from './AnomalyChart.jsx'
import { fmt } from '../lib/format.js'
import { statusMeta } from '../data/kpis.js'
import { riskById, impactMeta } from '../data/risks.js'

const card = { borderRadius: 14, background: '#fff', border: '1px solid var(--line)', padding: '20px 22px' }
const label = { fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 3 }
const linkRow = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', border: '1px solid var(--line)', borderRadius: 10, padding: '11px 14px', background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }

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
            <div style={label}>What's happening</div>
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
