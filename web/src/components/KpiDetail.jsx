import AnomalyChart from './AnomalyChart.jsx'
import ReasonsList from './ReasonsList.jsx'
import ProjectionPanel from './ProjectionPanel.jsx'
import FollowUpPanel from './FollowUpPanel.jsx'
import CorrelatedSidebar from './CorrelatedSidebar.jsx'
import DetectionSidebar from './DetectionSidebar.jsx'
import { fmt, rangeLabel, bandStatus } from '../lib/format.js'
import { statusMeta } from '../data/kpis.js'

export default function KpiDetail({ kpi, onBack, onOpenKpi, open, onToggleReason, onAsk }) {
  const meta = statusMeta[kpi.statusTier]
  const band = bandStatus(kpi)

  return (
    <div style={{ maxWidth: 1320, margin: '0 auto', padding: '36px 32px 130px', animation: 'fadeUp 220ms ease both' }}>
      <button className="back-btn" onClick={onBack}>← All KPIs</button>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '32px 56px', alignItems: 'flex-end', paddingBottom: 26, borderBottom: '2px solid var(--ink)' }}>
        <div style={{ flex: '1 1 420px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <div className="mono" style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '5px 8px', color: meta.fg, background: meta.bg }}>
              {meta.label}
            </div>
            <div className="mono" style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>As of {kpi.asOfDate}</div>
            <div className="mono" style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>{kpi.confidence} confidence</div>
            {kpi.kpiClass === 'error_rate' && (
              <div className="mono" style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--watch-fg)' }}>error-rate KPI · always watched</div>
            )}
          </div>
          <h1 style={{ margin: 0, fontSize: 'clamp(30px,4.2vw,52px)', lineHeight: 1, letterSpacing: '-0.035em', fontWeight: 600 }}>{kpi.name}</h1>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 18, marginTop: 22, flexWrap: 'wrap' }}>
            <div className="mono" style={{ fontSize: 'clamp(30px,4.2vw,48px)', fontWeight: 500, letterSpacing: '-0.04em', lineHeight: 1 }}>{fmt(kpi, kpi.value)}</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: meta.fg }}>{band === 'inside' ? 'inside expected range' : band === 'warn' ? 'outside warn' : 'outside critical'}</div>
            <div style={{ fontSize: 14, color: 'var(--muted)' }}>{rangeLabel(kpi)}</div>
          </div>
        </div>
        <p style={{ flex: '1 1 300px', minWidth: 0, maxWidth: 340, margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--muted-3)' }}>{kpi.why}</p>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '44px 56px', marginTop: 44, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 460px', minWidth: 0 }}>
          <SectionHeader n="01" title="Weekly time series" />
          <AnomalyChart kpi={kpi} />

          <SectionHeader n="02" title="Ranked reasons" note={`${kpi.reasons.length} attributed`} />
          <ReasonsList kpi={kpi} open={open} onToggle={onToggleReason} onAsk={onAsk} />

          <SectionHeader n="03" title="Projection" />
          <ProjectionPanel kpi={kpi} />

          <SectionHeader n="04" title="Audit & follow-up" />
          <FollowUpPanel kpi={kpi} />
        </div>

        <div style={{ flex: '1 1 300px', minWidth: 0, maxWidth: 340, position: 'sticky', top: 84 }}>
          <CorrelatedSidebar kpi={kpi} onOpen={onOpenKpi} />
          <DetectionSidebar kpi={kpi} />
        </div>
      </div>
    </div>
  )
}

function SectionHeader({ n, title, note }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, marginTop: 52, paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
      <h2 className="mono" style={{ margin: 0, fontSize: 13, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{n} — {title}</h2>
      {note && <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{note}</div>}
    </div>
  )
}
