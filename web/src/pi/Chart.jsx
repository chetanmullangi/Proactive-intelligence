import { isNum, shortDate, value } from './format.js'

// KPI history + the tested period's expected range + forecast band. Partial periods (data still arriving) dotted.
export default function KpiChart({ kpi, height = 260, compact = false }) {
  const hist = (kpi.series || []).slice(compact ? -40 : -104)
  const fc = (kpi.forecast?.points || []).slice(0, compact ? 8 : 26)
  const lastHist = hist.length ? hist[hist.length - 1].p : null
  const fut = fc.filter((f) => !lastHist || f.p > lastHist)
  const nowcast = fc.filter((f) => lastHist && f.p <= lastHist)
  const xs = [...hist.map((h) => h.p), ...fut.map((f) => f.p)]
  if (xs.length < 2) return <div className="pi-empty">No history to chart</div>
  const vals = [
    ...hist.map((h) => h.v ?? h.raw),
    ...fc.flatMap((f) => [f.point, f.lower, f.upper]),
    kpi.lower,
    kpi.upper,
  ].filter(isNum)
  let lo = Math.min(...vals)
  let hi = Math.max(...vals)
  if (kpi.unit === 'USD' || kpi.unit === 'count') lo = Math.min(0, lo)
  if (hi === lo) hi = lo + 1
  const W = 760
  const H = height
  const L = 64
  const R = 16
  const T = 14
  const B = 28
  const X = (i) => L + (i / (xs.length - 1)) * (W - L - R)
  const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B)
  const ix = Object.fromEntries(xs.map((p, i) => [p, i]))
  const line = (pts) => pts.map((p, k) => `${k ? 'L' : 'M'}${X(ix[p.p]).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')
  const actual = hist.filter((h) => isNum(h.v)).map((h) => ({ p: h.p, y: h.v }))
  const partial = hist.filter((h) => !isNum(h.v) && isNum(h.raw)).map((h) => ({ p: h.p, y: h.raw }))
  const band = fut.filter((f) => isNum(f.lower) && isNum(f.upper))
  const area = band.length
    ? `M${band.map((f) => `${X(ix[f.p]).toFixed(1)},${Y(f.upper).toFixed(1)}`).join(' L')} L${band
        .slice()
        .reverse()
        .map((f) => `${X(ix[f.p]).toFixed(1)},${Y(f.lower).toFixed(1)}`)
        .join(' L')} Z`
    : null
  const tested = kpi.period ? (kpi.period.match(/\d{4}-\d{2}-\d{2}/) || [])[0] : null
  const ticks = 4
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => lo + ((hi - lo) * i) / ticks)
  const xTicks = xs.filter((_, i) => i % Math.ceil(xs.length / 8) === 0)
  const fcStart = fut.length ? [{ p: lastHist, y: actual.length ? actual[actual.length - 1].y : fut[0].point }, ...fut.map((f) => ({ p: f.p, y: f.point }))] : []
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="pi-chart" role="img" aria-label={`${kpi.name} history and forecast`}>
      {tickVals.map((v, i) => (
        <g key={i}>
          <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="#f0f1f3" />
          <text x={L - 8} y={Y(v) + 4} textAnchor="end" fontSize="11" fill="#667085">
            {value(v, kpi.unit)}
          </text>
        </g>
      ))}
      {xTicks.map((p) => (
        <text key={p} x={X(ix[p])} y={H - 8} textAnchor="middle" fontSize="11" fill="#667085">
          {shortDate(p)}
        </text>
      ))}
      {area && <path d={area} fill="#5353ef" fillOpacity="0.1" />}
      {actual.length > 1 && <path d={line(actual)} fill="none" stroke="#344054" strokeWidth="1.6" />}
      {partial.length > 0 && (
        <path d={line(partial)} fill="none" stroke="#98a2b3" strokeWidth="1.4" strokeDasharray="2 3">
          <title>Still filling in (data for these periods is still arriving)</title>
        </path>
      )}
      {fcStart.length > 1 && <path d={line(fcStart)} fill="none" stroke="#5353ef" strokeWidth="1.6" strokeDasharray="5 4" />}
      {nowcast.map((f) => (
        <circle key={f.p} cx={X(ix[f.p])} cy={Y(f.point)} r="3" fill="#fff" stroke="#5353ef">
          <title>{`${shortDate(f.p)}: estimated final ${value(f.point, kpi.unit)} (still arriving)`}</title>
        </circle>
      ))}
      {hist
        .filter((h) => h.outlier && isNum(h.v))
        .map((h) => (
          <circle key={'o' + h.p} cx={X(ix[h.p])} cy={Y(h.v)} r="3.2" fill="#f79009">
            <title>{`${shortDate(h.p)}: one-off outlier, set aside from the baseline`}</title>
          </circle>
        ))}
      {tested && ix[tested] !== undefined && isNum(kpi.expected) && (
        <g>
          {isNum(kpi.lower) && isNum(kpi.upper) && (
            <line x1={X(ix[tested])} x2={X(ix[tested])} y1={Y(kpi.lower)} y2={Y(kpi.upper)} stroke="#12b76a" strokeWidth="5" strokeOpacity="0.35" />
          )}
          <circle cx={X(ix[tested])} cy={Y(kpi.expected)} r="3.5" fill="#12b76a">
            <title>{`Expected about ${value(kpi.expected, kpi.unit)} (normal range ${value(kpi.lower, kpi.unit)} – ${value(kpi.upper, kpi.unit)})`}</title>
          </circle>
          {isNum(kpi.actual) && (
            <circle cx={X(ix[tested])} cy={Y(kpi.actual)} r="4.5" fill={kpi.state === 'attention' ? '#d92d20' : kpi.state === 'watch' ? '#f79009' : '#344054'}>
              <title>{`Actual ${value(kpi.actual, kpi.unit)} for the ${kpi.period}`}</title>
            </circle>
          )}
        </g>
      )}
    </svg>
  )
}

export function Bars({ rows, unit = 'pct', height = 22 }) {
  const max = Math.max(1e-9, ...rows.map((r) => Math.abs(r.v)))
  return (
    <div className="pi-bars">
      {rows.map((r) => (
        <div key={r.k} className="pi-bar-row" title={r.title || ''}>
          <span className="pi-bar-label">{r.k}</span>
          <span className="pi-bar-track" style={{ height }}>
            <span className="pi-bar-fill" style={{ width: `${(100 * Math.abs(r.v)) / max}%`, background: r.v < 0 ? '#f97066' : r.color || '#5353ef' }} />
          </span>
          <span className="pi-bar-val">{r.label}</span>
        </div>
      ))}
    </div>
  )
}
