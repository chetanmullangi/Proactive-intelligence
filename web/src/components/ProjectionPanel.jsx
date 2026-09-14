import { fmt } from '../lib/format.js'

export default function ProjectionPanel({ kpi }) {
  const f = kpi.forecast
  if (!f) return null

  const stats = [
    { l: 'Forecast · next week', v: fmt(kpi, f.next), n: `${f.confidence} confidence` },
    { l: 'Range (trend-band)', v: `${fmt(kpi, f.lower)} – ${fmt(kpi, f.upper)}`, n: 'derived from baseline MAD' },
    { l: 'Method flag', v: f.method === 'recommend_ml_forecast' ? 'ML.FORECAST recommended' : 'Trend-band only', n: f.method === 'recommend_ml_forecast' ? 'strong enough trend to justify a trained model' : 'no grain shows a strong enough trend' },
  ]

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10 }}>
        {stats.map((s, i) => (
          <div key={i} style={{ background: 'var(--rail-bg)', border: '1px solid var(--line)', borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>{s.l}</div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 8 }}>{s.v}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4, lineHeight: 1.4 }}>{s.n}</div>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--ink-2)', margin: '14px 0 0' }}>
        {f.method === 'recommend_ml_forecast'
          ? 'High confidence in the trend behind this projection is not the same as trusting the projection itself — a straight-line extrapolation of a real trend is still a weaker forecast than a trained model. That’s exactly why this KPI is flagged for SNOWFLAKE.ML.FORECAST rather than presented as a final number.'
          : 'No grain (weekly, monthly, yearly) showed a strong enough trend to justify training a model here — this trend-band estimate, with its wide uncertainty range, is the honest answer for now.'}
      </p>
    </div>
  )
}
