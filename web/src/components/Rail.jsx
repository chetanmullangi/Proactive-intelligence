import { fmt } from '../lib/format.js'
import { statusMeta } from '../data/kpis.js'
import { impactMeta, formatUsd } from '../data/risks.js'

const ICONS = {
  risk: 'M12 3l7 3v6c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6zM12 8v5M12 16v.01',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  alert: 'M12 3 2.5 20h19zM12 9v5M12 17.5v.01',
}
const IMPACT_SEV = { High: '100%', Medium: '60%', Low: '25%' }

export default function Rail({ kpis, risks, full, onToggle, view, currentId, selectedRiskId, onRisk, onGrid, onOpen, onOpenRisk, generatedAt, riskRunAt }) {
  const counts = {
    anomaly: kpis.filter((k) => k.statusTier === 'anomaly').length,
    watch: kpis.filter((k) => k.statusTier === 'watch').length,
  }

  const nav = [
    { key: 'risk', label: 'Risk brief', icon: ICONS.risk, count: String(risks.length), onPick: () => onRisk() },
    { key: 'grid', label: 'KPI portfolio', icon: ICONS.grid, count: String(kpis.length), onPick: onGrid },
    { key: 'anom', label: 'KPIs needing attention', icon: ICONS.alert, count: String(counts.anomaly + counts.watch), onPick: () => { const first = kpis.find((k) => k.statusTier !== 'stable'); if (first) onOpen(first.id) } },
  ]

  const riskFeed = risks
    .slice()
    .sort((a, b) => impactMeta[a.impact].rank - impactMeta[b.impact].rank)
    .map((r) => ({ r, meta: impactMeta[r.impact], sel: view === 'risk' && selectedRiskId === r.id }))

  const kpiFeed = kpis
    .filter((k) => k.statusTier !== 'stable')
    .concat(kpis.filter((k) => k.statusTier === 'stable'))
    .slice(0, 6)
    .map((k) => {
      const meta = statusMeta[k.statusTier]
      const sel = view === 'detail' && currentId === k.id
      const sev = Math.min(1, Math.abs(k.value - (k.value < k.warnLower ? k.warnLower : k.value > k.warnUpper ? k.warnUpper : k.value)) / (Math.abs(k.warnUpper - k.warnLower) || 1) * 4 + (k.statusTier === 'anomaly' ? 0.7 : k.statusTier === 'watch' ? 0.4 : 0.12))
      return { k, meta, sel, sevW: `${Math.round(Math.max(0.12, Math.min(1, sev)) * 100)}%` }
    })

  const sectionLabel = (text, dot) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 8px 8px' }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--anomaly-mark)', animation: 'pulseDot 1.8s ease-in-out infinite' }} />}
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>{text}</span>
    </div>
  )

  return (
    <aside
      style={{
        width: full ? 248 : 64, flex: `0 0 ${full ? 248 : 64}px`, display: 'flex', flexDirection: 'column',
        background: 'var(--rail-bg)', borderRight: '1px solid var(--line)', overflow: 'hidden', height: '100vh',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 10, padding: '16px 12px 14px' }}>
        <div style={{ width: 30, height: 30, flex: '0 0 30px', borderRadius: 8, background: 'var(--pri)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700 }}>S</div>
        {full && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>Signal</div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Proactive claims intelligence</div>
          </div>
        )}
        <button className="rail-toggle" onClick={onToggle} title={full ? 'Collapse navigation' : 'Expand navigation'}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#737373" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d={full ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
          </svg>
        </button>
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 10px 14px' }}>
        {nav.map((n) => {
          const on = (n.key === 'risk' && view === 'risk') || (n.key === 'grid' && view === 'grid') || (n.key === 'anom' && view === 'detail')
          return (
            <button key={n.key} className="nav-btn" onClick={n.onPick} title={n.label} style={{ background: on ? '#f6f6ff' : 'transparent', color: on ? 'var(--pri)' : 'var(--ink-2)' }}>
              <span style={{ width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 16px' }}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke={on ? 'var(--pri)' : 'var(--ink-2)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={n.icon} /></svg>
              </span>
              {full && <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>{n.label}</span>}
              {full && (
                <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 999, background: on ? '#e6ecff' : '#ececf2', color: on ? 'var(--pri)' : 'var(--ink-2)' }}>{n.count}</span>
              )}
            </button>
          )
        })}
      </nav>

      <div style={{ height: 1, background: 'var(--line)', margin: '0 18px' }} />

      {full && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, padding: '16px 10px 12px' }}>
          {sectionLabel('Likely to go wrong', true)}
          {riskFeed.map(({ r, meta, sel }) => (
            <button
              key={r.id}
              className="feed-item"
              onClick={() => onOpenRisk(r.id)}
              style={{ border: `1px solid ${sel ? 'var(--pri)' : 'var(--line)'}`, background: sel ? '#f6f6ff' : '#fff' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.targetLabel}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: meta.fg }} className="mono">{formatUsd(r.exposureUsd)}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                <span style={{ flex: 1, height: 3, borderRadius: 2, background: '#f0f0f0', overflow: 'hidden', display: 'block' }}>
                  <span style={{ display: 'block', height: 3, borderRadius: 2, background: meta.mark, width: IMPACT_SEV[r.impact] }} />
                </span>
                <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>{r.impact.toLowerCase()} impact</span>
              </div>
            </button>
          ))}

          <div style={{ height: 8 }} />
          {sectionLabel('KPIs')}
          {kpiFeed.map(({ k, meta, sel, sevW }) => (
            <button
              key={k.id}
              className="feed-item"
              onClick={() => onOpen(k.id)}
              style={{ border: `1px solid ${sel ? 'var(--pri)' : 'var(--line)'}`, background: sel ? '#f6f6ff' : '#fff' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.name}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: meta.fg }} className="mono">{fmt(k, k.value)}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                <span style={{ flex: 1, height: 3, borderRadius: 2, background: '#f0f0f0', overflow: 'hidden', display: 'block' }}>
                  <span style={{ display: 'block', height: 3, borderRadius: 2, background: meta.mark, width: sevW }} />
                </span>
                <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>{k.statusTier === 'stable' ? 'normal' : k.state}</span>
              </div>
            </button>
          ))}
        </div>
      )}
      {!full && <div style={{ flex: 1 }} />}

      {full && (
        <div style={{ padding: '12px 18px 16px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Risk brief · run {new Date(riskRunAt).toISOString().slice(0, 10)}</div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>KPIs · refreshed {new Date(generatedAt).toISOString().slice(0, 10)}</div>
        </div>
      )}
    </aside>
  )
}
