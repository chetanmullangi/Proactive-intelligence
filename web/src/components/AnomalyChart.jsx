import { path, fmt, shortDate } from '../lib/format.js'
import { statusMeta } from '../data/kpis.js'

// Real weekly series (13-14 points) + a single real forecast point (we only
// persisted forecast_next/lower/upper, not a multi-point curve — so this
// plots one projected point, not a fabricated multi-month curve like the
// original design's mock data used).
export default function AnomalyChart({ kpi }) {
  const s = kpi.series
  const W = 700, H = 230, pl = 56, pr = 10, pt = 14, pb = 34
  const N = s.length + 1 // +1 slot for the forecast point

  const vals = s.map((p) => p.value)
  const allForRange = vals.concat([kpi.forecast?.upper ?? vals[vals.length - 1], kpi.forecast?.lower ?? vals[vals.length - 1], kpi.warnLower, kpi.warnUpper])
  let mn = Math.min(...allForRange)
  let mx = Math.max(...allForRange)
  const padV = (mx - mn) * 0.12 || 1
  mn -= padV
  mx += padV

  const x = (i) => pl + (i * (W - pl - pr)) / (N - 1)
  const y = (v) => pt + ((mx - v) / (mx - mn)) * (H - pt - pb)

  const grid = [0, 1, 2, 3].map((i) => {
    const v = mn + ((mx - mn) * i) / 3
    return { y: y(v), label: fmt(kpi, v) }
  })

  const histD = path(vals, x, y, 0)
  const lastIdx = vals.length - 1
  const fc = kpi.forecast
  const fcD = fc ? path([vals[lastIdx], fc.next], x, y, lastIdx) : null
  const bandTop = fc ? `${x(lastIdx).toFixed(1)} ${y(vals[lastIdx]).toFixed(1)} L ${x(lastIdx + 1).toFixed(1)} ${y(fc.upper).toFixed(1)}` : null
  const bandBottom = fc ? `${x(lastIdx + 1).toFixed(1)} ${y(fc.lower).toFixed(1)} L ${x(lastIdx).toFixed(1)} ${y(vals[lastIdx]).toFixed(1)}` : null

  const warnY = { top: y(kpi.warnUpper), bottom: y(kpi.warnLower) }
  const critBreach = kpi.value < kpi.critLower || kpi.value > kpi.critUpper
  const meta = statusMeta[kpi.statusTier]

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {/* expected (warn) band */}
        <rect x={pl} y={Math.min(warnY.top, warnY.bottom)} width={W - pl - pr} height={Math.abs(warnY.bottom - warnY.top)} fill="#5353ef" fillOpacity={0.06} />
        {grid.map((g, i) => (
          <g key={i}>
            <line x1={pl} x2={W - pr} y1={g.y} y2={g.y} stroke="#f0f0f0" strokeWidth={1} />
            <text x={0} y={g.y + 3.5} fill="#737373" fontFamily="Figtree,sans-serif" fontSize={10}>{g.label}</text>
          </g>
        ))}
        <line x1={pl} x2={W - pr} y1={warnY.top} y2={warnY.top} stroke="#5353ef" strokeWidth={1} strokeDasharray="4 4" opacity={0.5} />
        <line x1={pl} x2={W - pr} y1={warnY.bottom} y2={warnY.bottom} stroke="#5353ef" strokeWidth={1} strokeDasharray="4 4" opacity={0.5} />
        <line x1={x(lastIdx)} x2={x(lastIdx)} y1={pt} y2={H - pb} stroke="#dcdfe8" strokeWidth={1} strokeDasharray="3 4" />

        {fc && (
          <path d={`M ${bandTop} L ${bandBottom} Z`} fill="#5353ef" fillOpacity={0.1} />
        )}
        <path d={histD} fill="none" stroke="#303030" strokeWidth={2.2} strokeLinejoin="round" />
        {fcD && <path d={fcD} fill="none" stroke="#5353ef" strokeWidth={2.2} strokeDasharray="6 4" />}

        {s.map((p, i) =>
          p.partial ? (
            <circle key={i} cx={x(i)} cy={y(p.value)} r={2.5} fill="#ffffff" stroke="#a3a3a3" strokeWidth={1.5} />
          ) : null
        )}
        {critBreach && (
          <circle cx={x(lastIdx)} cy={y(vals[lastIdx])} r={4} fill="#ffffff" stroke={meta.mark} strokeWidth={2} />
        )}
        {fc && <circle cx={x(lastIdx + 1)} cy={y(fc.next)} r={3.5} fill="#5353ef" />}

        {s.filter((_, i) => i % Math.ceil(s.length / 6) === 0 || i === s.length - 1).map((p, i) => (
          <text key={i} x={x(s.indexOf(p))} y={H - 8} fill="#737373" textAnchor="middle" fontFamily="Figtree,sans-serif" fontSize={10}>
            {shortDate(p.bucket)}
          </text>
        ))}
      </svg>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>
        {s.length} real weekly buckets through {kpi.asOfDate} (hollow points are partial-week, don't read as trend endpoints). Forecast point is the single trend-band projection from Phase 3 — not a multi-month curve.
      </div>
    </div>
  )
}
