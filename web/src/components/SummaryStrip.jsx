export default function SummaryStrip({ kpis }) {
  const anomalies = kpis.filter((k) => k.statusTier === 'anomaly').length
  const watch = kpis.filter((k) => k.statusTier === 'watch').length
  const byConfidence = kpis.reduce((acc, k) => {
    acc[k.confidence] = (acc[k.confidence] || 0) + 1
    return acc
  }, {})

  const items = [
    { v: String(kpis.length), l: 'KPIs tracked this run', c: 'var(--ink)', bg: '#fff', bd: 'var(--line)' },
    { v: String(anomalies), l: 'Anomalies flagged', c: 'var(--anomaly-fg)', bg: 'var(--anomaly-bg)', bd: 'var(--anomaly-bd)' },
    { v: String(watch), l: 'On watch', c: 'var(--watch-fg)', bg: 'var(--watch-bg)', bd: 'var(--watch-bd)' },
    { v: `${byConfidence.high || 0}h · ${byConfidence.medium || 0}m · ${byConfidence.low || 0}l`, l: 'Confidence tier breakdown', c: 'var(--pri)', bg: '#f6f6ff', bd: '#dedefb' },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {items.map((s, i) => (
        <div key={i} style={{ borderRadius: 14, background: s.bg, border: `1px solid ${s.bd}`, padding: '16px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4 }}>
          <div className="mono" style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', color: s.c }}>{s.v}</div>
          <div style={{ fontSize: 12, lineHeight: 1.4, color: 'var(--ink-2)' }}>{s.l}</div>
        </div>
      ))}
    </div>
  )
}
