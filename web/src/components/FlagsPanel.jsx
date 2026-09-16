import { flags } from '../data/flags.js'

const sevMeta = {
  High: { fg: 'var(--anomaly-fg)', mark: 'var(--anomaly-mark)', bg: 'var(--anomaly-bg)' },
  Medium: { fg: 'var(--watch-fg)', mark: 'var(--watch-mark)', bg: 'var(--watch-bg)' },
  Low: { fg: 'var(--stable-fg)', mark: 'var(--stable-mark)', bg: 'var(--stable-bg)' },
}

export default function FlagsPanel({ resolved, onToggle, onOpenKpi, kpiById }) {
  const ordered = flags.slice().sort((a, b) => (!!resolved[a.id]) - (!!resolved[b.id]))
  const openCount = flags.filter((f) => !resolved[f.id]).length

  return (
    <div style={{ borderRadius: 14, background: '#fff', border: '1px solid var(--line)', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--pri-hover)' }}>Flagged for review</h2>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{openCount} open · {flags.length - openCount} resolved</span>
      </div>
      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-3)' }}>
        Things about the underlying data worth a second look — not KPI anomalies or predictive risks, but data-quality issues that could affect the numbers built on top of them.
      </p>

      {ordered.map((f) => {
        const meta = sevMeta[f.severity]
        const isResolved = !!resolved[f.id]
        return (
          <div
            key={f.id}
            style={{
              display: 'flex', gap: 14, alignItems: 'flex-start', border: '1px solid var(--line)',
              borderRadius: 12, padding: '14px 16px', opacity: isResolved ? 0.6 : 1, flexWrap: 'wrap',
            }}
          >
            <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, borderRadius: 999, padding: '4px 10px', color: meta.fg, background: meta.bg, marginTop: 1 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: meta.mark }} />{f.severity}
            </span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', textDecoration: isResolved ? 'line-through' : 'none' }}>{f.title}</div>
              <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: 1.6, color: 'var(--ink-2)' }}>{f.reason}</p>
              {f.relatedKpiIds?.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 9 }}>
                  {f.relatedKpiIds.map((id) => {
                    const k = kpiById(id)
                    if (!k) return null
                    return (
                      <button
                        key={id}
                        onClick={() => onOpenKpi(id)}
                        style={{ border: '1px solid var(--line)', borderRadius: 999, background: '#fff', color: 'var(--ink-2)', fontFamily: 'inherit', fontSize: 11.5, padding: '4px 10px', cursor: 'pointer' }}
                      >
                        {k.name} ↗
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            <button
              className={isResolved ? 'btn-outline' : 'btn-primary'}
              style={{ flexShrink: 0 }}
              onClick={() => onToggle(f.id)}
            >
              {isResolved ? 'Reopen' : 'Mark resolved'}
            </button>
          </div>
        )
      })}
    </div>
  )
}
