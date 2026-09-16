// crumbs: [{ label, onClick? }] — the last crumb is the current page.
export default function TopBar({ crumbs, asOfText, showAsk, onOpenChat }) {
  return (
    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '0 clamp(14px,2vw,28px)', height: 60, flex: '0 0 60px', background: 'var(--rail-bg)', borderBottom: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1
          return (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              {i > 0 && <span style={{ color: '#c9c9c9' }}>/</span>}
              {last || !c.onClick ? (
                <span style={{ fontSize: 13, fontWeight: last ? 600 : 500, color: last ? 'var(--ink)' : 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
              ) : (
                <button className="crumb-btn" onClick={c.onClick}>{c.label}</button>
              )}
            </span>
          )
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--line)', borderRadius: 8, background: '#fff', padding: '7px 12px', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--ink-3)" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="4" width="18" height="17" rx="2"></rect><path d="M3 10h18M8 2v4M16 2v4"></path></svg>
          {asOfText}
        </div>
        {showAsk && (
          <button className="btn-primary" onClick={onOpenChat}>Ask the analyst</button>
        )}
      </div>
    </header>
  )
}
