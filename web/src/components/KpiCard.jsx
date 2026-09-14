import Sparkline from './Sparkline.jsx'
import { fmt } from '../lib/format.js'
import { statusMeta } from '../data/kpis.js'

// Grid cards are plain-language only, always — no statistics, no thresholds,
// no confidence percentages, ever, not even behind a toggle. That detail
// lives one click away on the detail page.
export default function KpiCard({ kpi, onOpen }) {
  const meta = statusMeta[kpi.statusTier]

  return (
    <div onClick={onOpen} className="kpi-card">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>{kpi.name}</div>
          <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {kpi.plainStatus}
          </div>
        </div>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, borderRadius: 999, padding: '4px 9px', whiteSpace: 'nowrap', color: meta.fg, background: meta.bg }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: meta.mark }} />{meta.label}
        </span>
      </div>

      <div className="mono" style={{ fontSize: 34, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1 }}>{fmt(kpi, kpi.value)}</div>

      <div style={{ position: 'relative', borderRadius: 10, padding: '2px 0' }}>
        <Sparkline series={kpi.series} color={meta.fg} />
      </div>

      <div style={{ paddingTop: 12, borderTop: '1px solid var(--line-soft)', fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-2)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {kpi.plainReason}
      </div>
    </div>
  )
}
