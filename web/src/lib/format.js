export function fmt(kpi, v) {
  if (v === undefined || v === null || Number.isNaN(v)) return '—'
  switch (kpi.unit) {
    case 'pct':
      return (v * 100).toFixed(1) + '%'
    case 'days':
      return v.toFixed(3) + ' d'
    case 'rate1':
      return v.toFixed(1)
    case 'usd':
      return '$' + Math.round(v).toLocaleString('en-US')
    default:
      return Math.round(v).toLocaleString('en-US')
  }
}

export function fmtShort(kpi, v) {
  if (kpi.unit === 'usd' && Math.abs(v) >= 1000) {
    return '$' + (v / 1000).toFixed(0) + 'K'
  }
  return fmt(kpi, v)
}

export function rangeLabel(kpi) {
  return `Expected range ${fmt(kpi, kpi.warnLower)} – ${fmt(kpi, kpi.warnUpper)}`
}

export function bandStatus(kpi) {
  const v = kpi.value
  if (v < kpi.critLower || v > kpi.critUpper) return 'critical'
  if (v < kpi.warnLower || v > kpi.warnUpper) return 'warn'
  return 'inside'
}

export function pctFromBaseline(kpi) {
  // rough percentile-ish read using median/mad, purely for a small UI label
  const { median, mad } = kpi.baseline
  if (!mad) return null
  const z = (kpi.value - median) / (1.4826 * mad)
  return z
}

export function path(pts, xf, yf, i0 = 0) {
  return pts.map((v, i) => (i ? 'L' : 'M') + xf(i + i0).toFixed(1) + ' ' + yf(v).toFixed(1)).join(' ')
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function shortDate(bucket) {
  const d = new Date(bucket + 'T00:00:00')
  return MONTHS[d.getMonth()] + ' ' + d.getDate()
}
