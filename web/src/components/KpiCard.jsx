import Sparkline from './Sparkline.jsx'
import { fmt, fmtShort, rangeLabel } from '../lib/format.js'
import { statusMeta } from '../data/kpis.js'

export default function KpiCard({ kpi, onOpen }) {
  const meta = statusMeta[kpi.statusTier]
  const delta = kpi.value - kpi.warnUpper > 0
    ? `${fmtShort(kpi, kpi.value - kpi.warnUpper)} above range`
    : kpi.value - kpi.warnLower < 0
      ? `${fmtShort(kpi, kpi.warnLower - kpi.value)} below range`
      : 'inside range'

  return (
    <div onClick={onOpen} className="card-hover" style={{ background: '#fff', padding: '26px 26px 20px', cursor: 'pointer', transition: 'background 140ms ease' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, minHeight: 44 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>{kpi.name}</div>
          <div className="mono" style={{ marginTop: 5, fontSize: 11, color: '#8a8a80', letterSpacing: '0.04em' }}>
            {kpi.domain}{kpi.kpiClass === 'error_rate' ? ' · error-rate KPI' : ''}
          </div>
        </div>
        <div className="mono" style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '5px 8px', color: meta.fg, background: meta.bg, whiteSpace: 'nowrap' }}>
          {meta.label}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 22 }}>
        <div className="mono" style={{ fontSize: 40, fontWeight: 500, letterSpacing: '-0.035em', lineHeight: 1 }}>{fmt(kpi, kpi.value)}</div>
        <div style={{ fontSize: 12, fontWeight: 500, color: meta.fg }}>{delta}</div>
      </div>
      <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>{rangeLabel(kpi)}</div>

      <Sparkline series={kpi.series} color={meta.fg} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line-soft)' }}>
        <div style={{ fontSize: 12, color: 'var(--muted-3)' }}>{kpi.reasons.length} reason{kpi.reasons.length !== 1 ? 's' : ''} · {kpi.correlations.length} correlated</div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--muted-3)', textTransform: 'capitalize' }}>{kpi.confidence} confidence</div>
      </div>
    </div>
  )
}
