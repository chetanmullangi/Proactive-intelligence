const OPTIONS = ['All', 'Anomaly', 'Watch', 'Stable']

export default function FilterBar({ filter, onChange, shownCount }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', padding: '22px 0 26px' }}>
      <div style={{ display: 'flex', gap: 2 }}>
        {OPTIONS.map((f) => (
          <button key={f} className={`pill-btn${filter === f ? ' on' : ''}`} onClick={() => onChange(f)}>{f}</button>
        ))}
      </div>
      <div className="mono" style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>
        {shownCount} shown
      </div>
    </div>
  )
}
