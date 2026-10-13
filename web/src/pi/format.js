export const isNum = (v) => v !== null && v !== undefined && !Number.isNaN(Number(v))

export function money(v, compact = true) {
  if (!isNum(v)) return '—'
  const a = Math.abs(v)
  if (compact && a >= 1e6) return `$${(v / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`
  if (compact && a >= 1e4) return `$${Math.round(v / 1e3).toLocaleString('en-US')}K`
  return `$${Math.round(v).toLocaleString('en-US')}`
}

export function value(v, unit, compact = true) {
  if (!isNum(v)) return '—'
  switch (unit) {
    case 'USD':
      return money(v, compact)
    case 'share':
      return `${(v * 100).toFixed(v < 0.1 ? 2 : 1)}%`
    case 'days':
      return `${Number(v).toFixed(1)} days`
    case 'count':
      return Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : Number(v).toFixed(1)
    default:
      return Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : Number(v).toFixed(2)
  }
}

export function pct(v, digits) {
  if (!isNum(v)) return '—'
  const n = Number(v)
  const d = digits ?? (Math.abs(n) >= 10 ? 0 : 1)
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(d)}%`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function shortDate(s) {
  if (!s) return ''
  const d = new Date(String(s).slice(0, 10) + 'T00:00:00')
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}
export function monthYear(s) {
  const d = new Date(String(s).slice(0, 10) + 'T00:00:00')
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

export const SEVERITY = {
  critical: { label: 'Critical', fg: '#b42318', bg: '#fef3f2', bd: '#fecdca', rank: 0 },
  high: { label: 'High', fg: '#b54708', bg: '#fffaeb', bd: '#fedf89', rank: 1 },
  medium: { label: 'Medium', fg: '#6941c6', bg: '#f4f3ff', bd: '#d9d6fe', rank: 2 },
  low: { label: 'Low', fg: '#475467', bg: '#f2f4f7', bd: '#e4e7ec', rank: 3 },
  info: { label: 'Info', fg: '#067647', bg: '#ecfdf3', bd: '#abefc6', rank: 4 },
}

export const KIND = {
  happening: 'Happening now',
  coming: 'Coming up',
  data: 'Data problem',
  good_news: 'Good news',
}

export const STATE = {
  attention: { label: 'Needs attention', fg: '#b42318', bg: '#fef3f2' },
  watch: { label: 'Worth watching', fg: '#b54708', bg: '#fffaeb' },
  normal: { label: 'Normal', fg: '#067647', bg: '#ecfdf3' },
  stale: { label: 'Data not arriving', fg: '#b42318', bg: '#fef3f2' },
  too_early: { label: 'Too early to judge', fg: '#475467', bg: '#f2f4f7' },
  insufficient_history: { label: 'Not enough history', fg: '#475467', bg: '#f2f4f7' },
  no_data: { label: 'No data', fg: '#475467', bg: '#f2f4f7' },
}

export const DEPT_COLORS = {
  'Claims Operations': '#2e90fa',
  Finance: '#12b76a',
  'Enrollment & Eligibility': '#f79009',
  Pharmacy: '#ee46bc',
  'Provider Network': '#7a5af8',
  'Utilization Management': '#06aed4',
  'Appeals & Grievances': '#f04438',
  'Care Management': '#66c61c',
  'Product & Benefits': '#b692f6',
  'Data Platform': '#98a2b3',
}
export const deptColor = (d) => DEPT_COLORS[d] || '#98a2b3'
