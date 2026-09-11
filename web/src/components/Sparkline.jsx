import { path } from '../lib/format.js'

export default function Sparkline({ series, color }) {
  const vals = series.map((p) => p.value)
  const W = 320, H = 54, pt = 6
  let mn = Math.min(...vals), mx = Math.max(...vals)
  const pad = (mx - mn) * 0.3 || 1
  mn -= pad
  mx += pad
  const x = (i) => (i * W) / (vals.length - 1)
  const y = (v) => pt + ((mx - v) / (mx - mn)) * (H - pt * 2)
  const d = path(vals, x, y, 0)
  const area = d + ' L' + W + ' ' + H + ' L0 ' + H + ' Z'
  const dotX = W - 2
  const dotY = y(vals[vals.length - 2] ?? vals[vals.length - 1])

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 54, display: 'block' }}>
      <path d={area} fill={color} fillOpacity={0.07} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} />
      <circle cx={dotX} cy={dotY} r={3} fill={color} />
    </svg>
  )
}
