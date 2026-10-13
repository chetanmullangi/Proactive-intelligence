import { SEVERITY, STATE, deptColor } from './format.js'

export function Badge({ fg, bg, bd, children, title }) {
  return (
    <span className="pi-badge" style={{ color: fg, background: bg, borderColor: bd || bg }} title={title}>
      {children}
    </span>
  )
}

export function SeverityBadge({ s }) {
  const m = SEVERITY[s] || SEVERITY.low
  return (
    <Badge fg={m.fg} bg={m.bg} bd={m.bd}>
      {m.label}
    </Badge>
  )
}

export function StateBadge({ s }) {
  const m = STATE[s] || STATE.no_data
  return (
    <Badge fg={m.fg} bg={m.bg}>
      {m.label}
    </Badge>
  )
}

export function Dept({ name, small }) {
  if (!name) return null
  return (
    <span className={'pi-dept' + (small ? ' small' : '')}>
      <i style={{ background: deptColor(name) }} />
      {name}
    </span>
  )
}

export function Card({ title, sub, right, children, className = '' }) {
  return (
    <section className={'pi-card ' + className}>
      {(title || right) && (
        <header>
          <div>
            {title && <h3>{title}</h3>}
            {sub && <p className="pi-sub">{sub}</p>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  )
}

export function Empty({ children }) {
  return <div className="pi-empty">{children}</div>
}

export function Confidence({ c }) {
  if (!c) return <span className="pi-muted">reason not yet reviewed</span>
  const map = { high: ['High confidence', '#067647'], medium: ['Medium confidence', '#b54708'], low: ['Low confidence', '#b42318'] }
  const [t, col] = map[c] || [c, '#475467']
  return <span style={{ color: col, fontWeight: 600 }}>{t}</span>
}
