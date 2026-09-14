export default function TopBar({ crumb, kpi, chatOpen, onOpenChat, onBack }) {
  return (
    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '0 clamp(14px,2vw,28px)', height: 60, flex: '0 0 60px', background: 'var(--rail-bg)', borderBottom: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <button className="crumb-btn" onClick={onBack}>Portfolio</button>
        {kpi && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ color: '#c9c9c9' }}>/</span>
            <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{kpi.name}</span>
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--line)', borderRadius: 8, background: '#fff', padding: '7px 12px', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--ink-3)" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="4" width="18" height="17" rx="2"></rect><path d="M3 10h18M8 2v4M16 2v4"></path></svg>
          {kpi ? `As of ${kpi.asOfDate}` : 'HEALTH_CARE · 90-day lookback'}
        </div>
        {kpi && !chatOpen && (
          <button className="btn-primary" onClick={onOpenChat}>Ask the analyst</button>
        )}
      </div>
    </header>
  )
}
