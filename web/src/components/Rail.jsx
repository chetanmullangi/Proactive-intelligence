import { fmt } from '../lib/format.js'
import { statusMeta } from '../data/kpis.js'

const ICONS = {
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  alert: 'M12 3 2.5 20h19zM12 9v5M12 17.5v.01',
  db: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6',
}

export default function Rail({ kpis, full, onToggle, view, currentId, onGrid, onOpen, generatedAt }) {
  const counts = {
    anomaly: kpis.filter((k) => k.statusTier === 'anomaly').length,
    watch: kpis.filter((k) => k.statusTier === 'watch').length,
    stable: kpis.filter((k) => k.statusTier === 'stable').length,
  }

  const nav = [
    { key: 'grid', label: 'Portfolio', icon: ICONS.grid, count: String(kpis.length), onPick: onGrid },
    { key: 'anom', label: 'Needs attention', icon: ICONS.alert, count: String(counts.anomaly + counts.watch), onPick: () => { const first = kpis.find((k) => k.statusTier !== 'stable'); if (first) onOpen(first.id) } },
    { key: 'src', label: 'Data sources', icon: ICONS.db, count: String(new Set(kpis.map((k) => k.table)).size), onPick: onGrid },
  ]

  const feed = kpis
    .filter((k) => k.statusTier !== 'stable')
    .concat(kpis.filter((k) => k.statusTier === 'stable'))
    .slice(0, 8)
    .map((k) => {
      const meta = statusMeta[k.statusTier]
      const sel = view === 'detail' && currentId === k.id
      const sev = Math.min(1, Math.abs(k.value - (k.value < k.warnLower ? k.warnLower : k.value > k.warnUpper ? k.warnUpper : k.value)) / (Math.abs(k.warnUpper - k.warnLower) || 1) * 4 + (k.statusTier === 'anomaly' ? 0.7 : k.statusTier === 'watch' ? 0.4 : 0.12))
      return { k, meta, sel, sevW: `${Math.round(Math.max(0.12, Math.min(1, sev)) * 100)}%` }
    })

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
            <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>HEALTH_CARE anomaly analytics</div>
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
          const on = (n.key === 'grid' && view === 'grid') || (n.key === 'anom' && view === 'detail')
          return (
            <button key={n.key} className="nav-btn" onClick={n.onPick} style={{ background: on ? '#f6f6ff' : 'transparent', color: on ? 'var(--pri)' : 'var(--ink-2)' }}>
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
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '16px 10px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 8px 10px' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--anomaly-mark)', animation: 'pulseDot 1.8s ease-in-out infinite' }} />
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Needs attention</span>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 12 }}>
            {feed.map(({ k, meta, sel, sevW }) => (
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
                  <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>{k.statusTier === 'stable' ? 'on plan' : k.state}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {full && (
        <div style={{ padding: '12px 18px 16px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>KPI_CURRENT_STATE · refreshed {new Date(generatedAt).toISOString().slice(0, 10)}</div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Robust z / EWMA thresholds · 90-day lookback</div>
        </div>
      )}
    </aside>
  )
}
