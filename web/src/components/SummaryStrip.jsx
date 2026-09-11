export default function SummaryStrip({ kpis }) {
  const anomalies = kpis.filter((k) => k.statusTier === 'anomaly').length
  const watch = kpis.filter((k) => k.statusTier === 'watch').length
  const reasonsAttributed = kpis.reduce((n, k) => n + k.reasons.length, 0)
  const byConfidence = kpis.reduce((acc, k) => {
    acc[k.confidence] = (acc[k.confidence] || 0) + 1
    return acc
  }, {})

  const items = [
    { v: String(kpis.length), l: 'KPIs tracked this run' },
    { v: String(anomalies), l: 'Critical anomalies' },
    { v: String(watch), l: 'Watch-list KPIs' },
    { v: String(reasonsAttributed), l: 'Ranked reasons attributed' },
    { v: `${byConfidence.high || 0} high · ${byConfidence.medium || 0} medium`, l: 'Confidence tier breakdown' },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', borderBottom: '1px solid var(--line)' }}>
      {items.map((s, i) => (
        <div key={i} style={{ padding: '22px 24px 22px 0' }}>
          <div className="mono" style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-0.03em', lineHeight: 1 }}>{s.v}</div>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)', letterSpacing: '0.01em' }}>{s.l}</div>
        </div>
      ))}
    </div>
  )
}
