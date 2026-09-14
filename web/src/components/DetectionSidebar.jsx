export default function DetectionSidebar({ kpi }) {
  const b = kpi.baseline
  return (
    <div style={{ borderRadius: 14, border: '1px solid var(--line)', background: '#fff', padding: '20px 22px' }}>
      <h2 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--pri-hover)' }}>How this was detected</h2>
      <div style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--ink)' }}>
        Robust z-score thresholding: (value − median) / (1.4826 × MAD), warn at |z| ≥ 3, critical at |z| ≥ 3.5 — chosen over mean/stddev because the outliers being hunted for would otherwise contaminate a plain mean/stddev. Baseline built from {b.bucketsAvailable} weekly buckets (native r²={b.r2.toFixed(3)}).
      </div>

      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '18px 0 8px' }}>Multi-grain check</div>
      <div style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--ink)' }}>
        Grains tested: {b.grainsTested.join(' → ')}. Month r²={b.monthR2.toFixed(3)}, year r²={b.yearR2.toFixed(3)}
        {Math.abs(b.r2 - b.monthR2) > 0.3 ? ' — a meaningful divergence from the native-grain trend, worth reading both together.' : '.'}
      </div>

      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '18px 0 8px' }}>Sources</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <span className="source-chip">{kpi.table}</span>
        <span className="source-chip">HEALTH_CARE.ANALYTICS.KPI_BASELINE</span>
        <span className="source-chip">HEALTH_CARE.ANALYTICS.KPI_CURRENT_STATE</span>
      </div>
    </div>
  )
}
