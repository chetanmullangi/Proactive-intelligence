const OPTIONS = ['All', 'Anomaly', 'Watch', 'Stable']

export default function FilterBar({ filter, onChange, shownCount, totalCount }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', padding: '26px 2px 16px' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {OPTIONS.map((f) => (
          <button key={f} className={`pill-btn${filter === f ? ' on' : ''}`} onClick={() => onChange(f)}>{f}</button>
        ))}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
        Sorted by severity · {shownCount} of {totalCount} shown
      </div>
    </div>
  )
}
