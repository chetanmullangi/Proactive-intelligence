export default function Header({ crumb }) {
  return (
    <div
      style={{
        position: 'sticky', top: 0, zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 24, padding: '0 32px', height: 60, background: 'rgba(247,246,243,0.92)', backdropFilter: 'blur(8px)',
        borderBottom: '1px solid var(--line)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 14, height: 14, background: 'var(--accent)' }} />
        <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' }}>Signal</div>
        <div style={{ width: 1, height: 16, background: '#dddcd3' }} />
        <div className="mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>{crumb}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.04em' }}>HEALTH_CARE · KPI_CURRENT_STATE</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--line)', background: '#fff', padding: '7px 12px', fontSize: 12, fontWeight: 500 }}>
          90-day lookback · weekly
        </div>
      </div>
    </div>
  )
}
