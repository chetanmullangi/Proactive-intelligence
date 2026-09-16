import { useEffect } from 'react'
import RiskCard from './RiskCard.jsx'
import { risks, skippedRisks, riskRunAt, impactMeta, formatUsd } from '../data/risks.js'

const tile = (bg, bd) => ({ borderRadius: 14, background: bg, border: `1px solid ${bd}`, padding: '16px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4 })

export default function RiskBrief({ selectedId, onAsk, onOpenKpi }) {
  const ordered = risks.slice().sort((a, b) => impactMeta[a.impact].rank - impactMeta[b.impact].rank)
  const totalExposure = risks.reduce((s, r) => s + r.exposureUsd, 0)
  const claims = risks.filter((r) => r.affectedUnit === 'claims').reduce((s, r) => s + r.affectedCount, 0)
  const scripts = risks.filter((r) => r.affectedUnit === 'prescriptions').reduce((s, r) => s + r.affectedCount, 0)
  const runDate = new Date(riskRunAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

  useEffect(() => {
    if (!selectedId) return
    const el = document.getElementById(`risk-card-${selectedId}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [selectedId])

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: '24px clamp(14px,2vw,28px) 56px', display: 'flex', flexDirection: 'column', gap: 20, animation: 'fadeUp 200ms ease both' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 20, alignItems: 'stretch' }}>
        <div style={{ borderRadius: 14, background: '#f6f6ff', border: '1px solid #dedefb', padding: '24px 26px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <span style={{ alignSelf: 'flex-start', fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#fff', background: 'var(--pri)', borderRadius: 999, padding: '4px 10px' }}>
            Proactive risk brief · {runDate}
          </span>
          <h1 style={{ margin: 0, fontSize: 'clamp(24px,2.4vw,32px)', lineHeight: 1.12, letterSpacing: '-0.025em', fontWeight: 600 }}>
            {ordered.length} issues need attention today
          </h1>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--ink-2)', maxWidth: '54ch' }}>
            This looks ahead: which claims are likely to run into trouble if nothing changes, where they cluster, and what’s at stake. The KPI portfolio shows what has already happened.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={tile('#fff', 'var(--line)')}>
            <div className="mono" style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em' }}>{ordered.length}</div>
            <div style={{ fontSize: 12, lineHeight: 1.4, color: 'var(--ink-2)' }}>Issues flagged</div>
          </div>
          <div style={tile('var(--anomaly-bg)', 'var(--anomaly-bd)')}>
            <div className="mono" style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--anomaly-fg)' }}>{formatUsd(totalExposure)}</div>
            <div style={{ fontSize: 12, lineHeight: 1.4, color: 'var(--ink-2)' }}>Estimated exposure if the patterns continue</div>
          </div>
          <div style={tile('var(--watch-bg)', 'var(--watch-bd)')}>
            <div className="mono" style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--watch-fg)' }}>{claims}</div>
            <div style={{ fontSize: 12, lineHeight: 1.4, color: 'var(--ink-2)' }}>Claims at risk{scripts ? ` · plus ${scripts} prescriptions` : ''}</div>
          </div>
          <div style={tile('#f6f6ff', '#dedefb')}>
            <div className="mono" style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--pri)' }}>{risks.length + skippedRisks.length}</div>
            <div style={{ fontSize: 12, lineHeight: 1.4, color: 'var(--ink-2)' }}>Kinds of risk checked</div>
          </div>
        </div>
      </div>

      {ordered.map((r, i) => (
        <RiskCard key={r.id} risk={r} rank={i + 1} selected={selectedId === r.id} onAsk={onAsk} onOpenKpi={onOpenKpi} />
      ))}

      <div style={{ borderRadius: 14, background: '#fff', border: '1px solid var(--line)', padding: '20px 22px' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--pri-hover)' }}>Also checked, not flagged</h2>
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 6 }}>Other kinds of risk we looked for this time, and why they aren’t in the brief.</div>
        {skippedRisks.map((s) => (
          <div key={s.label} style={{ padding: '12px 0', borderTop: '1px solid var(--line-soft)' }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{s.label}</div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--ink-2)', marginTop: 3 }}>{s.plainReason}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
