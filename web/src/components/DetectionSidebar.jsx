export default function DetectionSidebar({ kpi }) {
  const b = kpi.baseline
  return (
    <div style={{ border: '1px solid var(--line)', background: '#fff', padding: 22, marginTop: 16 }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted-2)', marginBottom: 12 }}>
        How this was detected
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--ink-soft)' }}>
        Robust z-score thresholding: (value − median) / (1.4826 × MAD), warn at |z| ≥ 3, critical at |z| ≥ 3.5 — chosen over mean/stddev because the outliers being hunted for are exactly what contaminate a plain mean/stddev. Baseline built from {b.bucketsAvailable} weekly buckets (native r²={b.r2.toFixed(3)}).
      </div>

      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted-2)', margin: '20px 0 10px' }}>
        Multi-grain check
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--ink-soft)' }}>
        Grains tested: {b.grainsTested.join(' → ')}. Month r²={b.monthR2.toFixed(3)}, year r²={b.yearR2.toFixed(3)}
        {Math.abs(b.r2 - b.monthR2) > 0.3 ? ' — a meaningful divergence from the native-grain trend, worth reading both together.' : '.'}
      </div>

      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted-2)', margin: '20px 0 10px' }}>
        Source
      </div>
      <div className="mono" style={{ fontSize: 12, color: 'var(--muted-3)', padding: '6px 0', borderTop: '1px solid var(--line-soft)' }}>{kpi.table}</div>
    </div>
  )
}
