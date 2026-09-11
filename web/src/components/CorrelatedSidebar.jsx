export default function CorrelatedSidebar({ kpi, onOpen }) {
  return (
    <div style={{ border: '1px solid var(--line)', background: '#fff', padding: 22 }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted-2)' }}>Correlated KPIs</div>
      {kpi.correlations.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 14, lineHeight: 1.5 }}>
          No correlations were computed for this KPI this pass — only 5 of 13 KPIs were part of the manifest's correlation set.
        </div>
      ) : (
        kpi.correlations.map((c, i) => {
          const color = c.r > 0 ? '#2F6FED' : '#B4451F'
          return (
            <div key={i} onClick={() => c.toId && onOpen(c.toId)} style={{ padding: '14px 0', borderBottom: '1px solid var(--line-soft)', cursor: c.toId ? 'pointer' : 'default' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{c.name}</div>
                <div className="mono" style={{ fontSize: 12, color }}>{c.r > 0 ? '+' : ''}{c.r.toFixed(3)}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', marginTop: 8, height: 4, background: '#efeee8' }}>
                <div style={{ height: 4, background: color, width: `${Math.round(Math.abs(c.r) * 100)}%` }} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
                {c.note}{c.joinKey ? ` Join key: ${c.joinKey}.` : ''}
              </div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--muted-2)', marginTop: 4 }}>n_overlap = {c.nOverlap}</div>
            </div>
          )
        })
      )}
      <div style={{ fontSize: 11, color: 'var(--muted-2)', marginTop: 12, lineHeight: 1.5 }}>
        Pearson r over the 90-day weekly series. Only correlations with n_overlap ≥ 8 are shown — below that, the correlation validity gate excludes them as evidence.
      </div>
    </div>
  )
}
