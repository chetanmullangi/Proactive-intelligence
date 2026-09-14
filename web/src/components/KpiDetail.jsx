import { useState } from 'react'
import AnomalyChart from './AnomalyChart.jsx'
import ReasonsList from './ReasonsList.jsx'
import ProjectionPanel from './ProjectionPanel.jsx'
import FollowUpPanel from './FollowUpPanel.jsx'
import CorrelatedSidebar from './CorrelatedSidebar.jsx'
import DetectionSidebar from './DetectionSidebar.jsx'
import { fmt } from '../lib/format.js'
import { statusMeta } from '../data/kpis.js'

const card = { borderRadius: 14, background: '#fff', border: '1px solid var(--line)', padding: '20px 22px' }

// Plain language leads every KPI page, always. Everything statistical —
// the threshold chart, ranked-reason evidence/method, projection bands,
// correlation r-values, detection method — lives behind one explicit,
// collapsed-by-default "Show technical details" toggle. It's real work and
// stays available; it's just never the first thing a business reader sees.
export default function KpiDetail({ kpi, onOpenKpi, open, onToggleReason, reviewedCount, onAsk }) {
  const [showTechnical, setShowTechnical] = useState(false)
  const meta = statusMeta[kpi.statusTier]

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
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 14, flexWrap: 'wrap' }}>
            <div className="mono" style={{ fontSize: 40, fontWeight: 600, letterSpacing: '-0.035em', lineHeight: 1 }}>{fmt(kpi, kpi.value)}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: meta.fg }}>{kpi.plainStatus}</div>
          </div>
        </div>
        <div style={{ borderLeft: '1px solid var(--line)', paddingLeft: 22 }}>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: 'var(--ink)' }}>{kpi.plainReason}</p>
          <p style={{ margin: '10px 0 0', fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-3)' }}>{kpi.plainConfidence}</p>
        </div>
      </div>

      <button
        onClick={() => setShowTechnical((v) => !v)}
        style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--line)', borderRadius: 8, background: '#fff', color: 'var(--ink-2)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 500, padding: '8px 14px', cursor: 'pointer' }}
      >
        {showTechnical ? 'Hide technical details' : 'Show technical details'}
        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{showTechnical ? '−' : '+'}</span>
      </button>

      {showTechnical && (
        <>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: '0 2px' }}>
            Statistics, thresholds, and the data-level evidence behind the plain-language summary above — for the data team, or anyone who wants to verify a number.
          </div>

          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--pri-hover)' }}>01 — Weekly time series</h2>
              <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--ink-3)', flexWrap: 'wrap' }}>
                <span>— actual</span><span style={{ color: 'var(--pri)' }}>- - forecast</span><span>- - expected range</span>
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <AnomalyChart kpi={kpi} />
            </div>
          </div>

          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', paddingBottom: 6 }}>
              <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--pri-hover)' }}>02 — Ranked reasons (technical backing)</h2>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{reviewedCount} of {kpi.reasons.length} expanded</div>
            </div>
            <ReasonsList kpi={kpi} open={open} onToggle={onToggleReason} onAsk={onAsk} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 20, alignItems: 'start' }}>
            <div style={card}>
              <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--pri-hover)' }}>03 — Projection</h2>
              <div style={{ marginTop: 16 }}>
                <ProjectionPanel kpi={kpi} />
              </div>
            </div>

            <div style={card}>
              <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--pri-hover)' }}>04 — Audit &amp; follow-up</h2>
              <div style={{ marginTop: 16 }}>
                <FollowUpPanel kpi={kpi} />
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 20, alignItems: 'start' }}>
            <CorrelatedSidebar kpi={kpi} onOpen={onOpenKpi} />
            <DetectionSidebar kpi={kpi} />
          </div>
        </>
      )}
    </div>
  )
}
