export default function ReviewBar({ reviewedCount, totalCount, canChat, onChat }) {
  const pct = totalCount ? Math.round((reviewedCount / totalCount) * 100) : 0
  return (
    <div
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 45, display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', gap: 20, padding: '14px 32px', background: 'rgba(247,246,243,0.94)',
        backdropFilter: 'blur(8px)', borderTop: '1px solid var(--line)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 60, height: 3, background: '#eae9e2' }}>
          <div style={{ height: 3, background: 'var(--accent)', width: `${pct}%` }} />
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted-3)' }}>
          {canChat ? `Reviewed ${reviewedCount} of ${totalCount} reasons — ready to discuss` : 'Open at least one reason to start a grounded chat'}
        </div>
      </div>
      <button
        onClick={onChat}
        disabled={!canChat}
        style={{
          border: '1px solid var(--ink)', background: canChat ? 'var(--ink)' : '#f1f0ec', color: canChat ? '#fff' : '#9a9a90',
          fontSize: 13, fontWeight: 500, padding: '11px 20px', cursor: canChat ? 'pointer' : 'not-allowed', opacity: canChat ? 1 : 0.65,
        }}
      >
        {canChat ? 'Chat about this KPI →' : 'Chat locked until reviewed'}
      </button>
    </div>
  )
}
