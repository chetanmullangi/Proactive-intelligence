import { fmt } from '../lib/format.js'
import { statusMeta } from '../data/kpis.js'

export default function ChatDrawer({ kpi, floats, msgs, input, busy, suggestions, onInput, onKey, onSend, onPick, onClose }) {
  const meta = statusMeta[kpi.statusTier]

  return (
    <aside
      style={{
        position: floats ? 'absolute' : 'relative', top: 0, right: 0, bottom: 0, zIndex: 50,
        boxShadow: floats ? '-24px 0 60px -20px rgba(31,44,76,0.28)' : 'none',
        width: floats ? '100%' : 372, maxWidth: '100%', flex: `0 0 ${floats ? '100%' : '372px'}`,
        display: 'flex', flexDirection: 'column', background: '#fff', borderLeft: '1px solid var(--line)',
        animation: 'slideIn 200ms ease both',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, padding: '16px 18px', background: 'var(--rail-bg)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', gap: 10, minWidth: 0 }}>
          <div style={{ width: 32, height: 32, flex: '0 0 32px', borderRadius: 10, background: 'var(--pri-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--pri)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Analyst</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Grounded in {kpi.name}</div>
          </div>
        </div>
        <button className="icon-btn" onClick={onClose}>✕</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', background: meta.bg, borderBottom: `1px solid ${meta.bd}` }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.mark }} />
        <span style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{kpi.name}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{fmt(kpi, kpi.value)} · {meta.label}</span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === 'u' ? 'flex-end' : 'flex-start', maxWidth: '90%', display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', alignSelf: m.role === 'u' ? 'flex-end' : 'flex-start' }}>{m.role === 'u' ? 'You' : 'Analyst'}</div>
            <div
              style={{
                fontSize: 13, lineHeight: 1.65, whiteSpace: 'pre-wrap',
                color: m.role === 'u' ? '#fff' : 'var(--ink)',
                background: m.role === 'u' ? 'var(--pri)' : 'var(--rail-bg)',
                border: `1px solid ${m.role === 'u' ? 'var(--pri)' : 'var(--line)'}`,
                borderRadius: m.role === 'u' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                padding: '11px 13px',
              }}
            >
              {m.text}
            </div>
          </div>
        ))}
        {busy && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--ink-3)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--pri)', animation: 'pulseDot 1.1s ease-in-out infinite' }} />
            Analysing the record…
          </div>
        )}
      </div>

      <div style={{ padding: '12px 18px 16px', background: 'var(--rail-bg)', borderTop: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {suggestions.map((s, i) => (
            <button key={i} className="suggestion-btn" onClick={() => onPick(s)}>{s}</button>
          ))}
        </div>
        <div className="chat-input-wrap">
          <input className="chat-input" value={input} onChange={onInput} onKeyDown={onKey} placeholder="Ask about this metric…" />
          <button className="btn-primary" onClick={onSend}>Send</button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 8 }}>Answers are grounded in this KPI's record only.</div>
      </div>
    </aside>
  )
}
