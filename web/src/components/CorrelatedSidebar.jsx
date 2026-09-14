export default function CorrelatedSidebar({ kpi, onOpen }) {
  return (
    <div style={{ borderRadius: 14, border: '1px solid var(--line)', background: '#fff', padding: '20px 22px' }}>
      <h2 style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--pri-hover)' }}>Correlated KPIs</h2>
      {kpi.correlations.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 10, lineHeight: 1.5 }}>
          No correlations were computed for this KPI this pass — only 5 of 15 KPIs are part of the manifest's correlation set.
        </div>
      ) : (
        kpi.correlations.map((c, i) => {
          const color = c.r > 0 ? 'var(--pri)' : 'var(--anomaly-fg)'
          return (
            <div key={i} onClick={() => c.toId && onOpen(c.toId)} className="corr-row" style={{ cursor: c.toId ? 'pointer' : 'default' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                <div className="mono" style={{ fontSize: 12, fontWeight: 600, color }}>{c.r > 0 ? '+' : ''}{c.r.toFixed(3)}</div>
              </div>
              <div style={{ display: 'block', marginTop: 7, height: 4, borderRadius: 2, background: '#f0f0f0', overflow: 'hidden' }}>
                <div style={{ height: 4, borderRadius: 2, background: color, width: `${Math.round(Math.abs(c.r) * 100)}%` }} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.5 }}>
                {c.note}{c.joinKey ? ` Join key: ${c.joinKey}.` : ''} n_overlap={c.nOverlap}.
              </div>
            </div>
          )
        })
      )}
      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 10 }}>
        Pearson r over the 90-day weekly series. Only correlations with n_overlap ≥ 8 are treated as valid evidence.
      </div>
    </div>
  )
}
