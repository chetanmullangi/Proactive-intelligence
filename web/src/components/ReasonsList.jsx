export default function ReasonsList({ kpi, open, onToggle, onAsk }) {
  return (
    <div>
      {kpi.reasons.map((r, i) => {
        const key = kpi.id + i
        const isOpen = !!open[key]
        return (
          <div key={i} className="reason-row">
            <div className="reason-toggle" onClick={() => onToggle(key)}>
              <div className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)' }}>0{r.rank}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.35 }}>{r.text}</div>
                {r.impact && <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-3)' }}>{r.impact}</div>}
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span className={`strength-bar strength-${r.strength}`}><span /></span>
                  <span style={{ fontSize: 11, color: 'var(--ink-2)' }}>{r.strength}</span>
                </div>
                <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-3)' }}>evidence</div>
              </div>
              <div style={{ fontSize: 16, color: 'var(--ink-3)', textAlign: 'right', lineHeight: 1 }}>{isOpen ? '−' : '+'}</div>
            </div>
            {isOpen && (
              <div style={{ padding: '0 0 18px 44px', animation: 'fadeUp 180ms ease both' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 20, padding: '18px 20px', background: 'var(--rail-bg)', border: '1px solid var(--line)', borderRadius: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 7 }}>Evidence</div>
                    <div style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--ink)' }}>{r.evidence}</div>
                  </div>
                  <div>
                    {r.segment && (
                      <>
                        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 7 }}>Segment</div>
                        <div style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--ink)' }}>{r.segment}</div>
                      </>
                    )}
                    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: r.segment ? '14px 0 7px' : '0 0 7px' }}>Method</div>
                    <div style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--ink)' }}>{r.method}</div>
                  </div>
                </div>
                <button className="btn-outline" style={{ marginTop: 12 }} onClick={(e) => { e.stopPropagation(); onAsk(`Walk me through "${r.text}" — how solid is the evidence?`) }}>
                  Ask the analyst about this reason
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
