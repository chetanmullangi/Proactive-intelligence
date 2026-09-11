import { fmt } from '../lib/format.js'

export default function ChatPanel({ kpi, msgs, input, busy, suggestions, onInput, onKey, onSend, onPick, onClose }) {
  return (
    <div
      style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 440, maxWidth: '100vw', zIndex: 60,
        background: '#fff', borderLeft: '1px solid #dddcd3', boxShadow: '-24px 0 60px rgba(21,22,26,0.10)',
        display: 'flex', flexDirection: 'column', animation: 'slideIn 200ms ease both',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '20px 22px', borderBottom: '1px solid var(--line-soft)' }}>
        <div>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent)' }}>Analyst · grounded in this KPI</div>
          <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.015em', marginTop: 7 }}>{kpi.name}</div>
          <div className="mono" style={{ fontSize: 11, color: '#8a8a80', marginTop: 4 }}>{fmt(kpi, kpi.value)} · {kpi.state}</div>
        </div>
        <button className="icon-btn" onClick={onClose}>✕</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === 'u' ? 'flex-end' : 'flex-start', maxWidth: '88%' }}>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted-2)', marginBottom: 6 }}>
              {m.role === 'u' ? 'You' : 'Analyst'}
            </div>
            <div
              style={{
                fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                color: m.role === 'u' ? '#fff' : '#1d1e22',
                background: m.role === 'u' ? 'var(--ink)' : '#f9f8f5',
                border: `1px solid ${m.role === 'u' ? 'var(--ink)' : 'var(--line-soft)'}`,
                padding: '12px 14px',
              }}
            >
              {m.text}
            </div>
          </div>
        ))}
        {busy && <div className="mono" style={{ fontSize: 11, color: 'var(--muted-2)', letterSpacing: '0.06em' }}>analysing…</div>}
      </div>

      <div style={{ padding: '14px 22px 18px', borderTop: '1px solid var(--line-soft)' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {suggestions.map((s, i) => (
            <button key={i} className="suggestion-btn" onClick={() => onPick(s)}>{s}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="chat-input"
            value={input}
            onChange={onInput}
            onKeyDown={onKey}
            placeholder="Ask about this metric…"
          />
          <button onClick={onSend} style={{ border: '1px solid var(--ink)', background: 'var(--ink)', color: '#fff', fontSize: 13, fontWeight: 500, padding: '11px 16px', cursor: 'pointer' }}>
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
