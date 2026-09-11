export default function ReasonsList({ kpi, open, onToggle, onAsk }) {
  return (
    <div>
      {kpi.reasons.map((r, i) => {
        const key = kpi.id + i
        const isOpen = !!open[key]
        return (
          <div key={i} style={{ borderBottom: '1px solid var(--line-soft)' }}>
            <div
              onClick={() => onToggle(key)}
              style={{ display: 'grid', gridTemplateColumns: '34px minmax(0,1fr) 100px 22px', gap: 16, alignItems: 'center', padding: '20px 0', cursor: 'pointer' }}
            >
              <div className="mono" style={{ fontSize: 11, color: 'var(--muted-2)' }}>0{r.rank}</div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 500, letterSpacing: '-0.012em', lineHeight: 1.3 }}>{r.text}</div>
              </div>
              <div>
                <div className={`strength-bar strength-${r.strength}`}><span /></div>
                <div className="mono" style={{ marginTop: 5, fontSize: 11, color: 'var(--muted-2)', textTransform: 'capitalize' }}>{r.strength} evidence</div>
              </div>
              <div className="mono" style={{ fontSize: 14, color: 'var(--muted-2)', textAlign: 'right' }}>{isOpen ? '−' : '+'}</div>
            </div>
            {isOpen && (
              <div style={{ padding: '2px 0 26px 50px', animation: 'fadeUp 180ms ease both' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 24, padding: '20px 22px', background: '#fff', border: '1px solid var(--line)' }}>
                  <div>
                    <div className="mono" style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted-2)', marginBottom: 8 }}>Evidence</div>
                    <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--ink-soft)' }}>{r.evidence}</div>
                  </div>
                  <div>
                    <div className="mono" style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted-2)', marginBottom: 8 }}>Method</div>
                    <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--ink-soft)' }}>{r.method}</div>
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onAsk(`Walk me through "${r.text}" — how solid is the evidence?`) }}
                  style={{ marginTop: 12, border: '1px solid var(--ink)', background: '#fff', color: 'var(--ink)', fontSize: 12, fontWeight: 500, padding: '9px 14px', cursor: 'pointer' }}
                >
                  Ask about this reason →
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
