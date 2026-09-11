import { useState } from 'react'
import Header from './components/Header.jsx'
import SummaryStrip from './components/SummaryStrip.jsx'
import FilterBar from './components/FilterBar.jsx'
import KpiCard from './components/KpiCard.jsx'
import KpiDetail from './components/KpiDetail.jsx'
import ReviewBar from './components/ReviewBar.jsx'
import ChatPanel from './components/ChatPanel.jsx'
import { kpis, kpiById } from './data/kpis.js'
import { answer, suggestionsFor } from './lib/chatEngine.js'
import { usePersisted } from './lib/usePersisted.js'

const STATUS_LABEL_TO_TIER = { Anomaly: 'anomaly', Watch: 'watch', Stable: 'stable' }
const TIER_RANK = { anomaly: 0, watch: 1, stable: 2 }

export default function App() {
  // Persisted across browser close/reopen (localStorage, this browser only):
  // which KPI/chart you were looking at, the filter, which reasons you've
  // reviewed, and every KPI's own chat thread. Transient (not persisted):
  // the in-progress chat input and the "analysing…" spinner — resuming with
  // a half-typed message or a stuck spinner would be worse than losing it.
  const [view, setView] = usePersisted('view', 'grid')
  const [id, setId] = usePersisted('id', null)
  const [filter, setFilter] = usePersisted('filter', 'All')
  const [open, setOpen] = usePersisted('open', {})
  const [reviewed, setReviewed] = usePersisted('reviewed', {})
  const [chatOpenFor, setChatOpenFor] = usePersisted('chatOpenFor', null) // kpi id, or null
  const [msgsByKpi, setMsgsByKpi] = usePersisted('msgsByKpi', {})
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)

  // Guard against stale persisted state (e.g. this app's data was
  // regenerated and an old KPI id no longer exists) rather than crashing.
  const kpi = id ? kpiById(id) : null
  if (id && !kpi && view === 'detail') {
    setView('grid')
    setId(null)
  }

  const go = (kpiId) => {
    setView('detail')
    setId(kpiId)
    setChatOpenFor(null) // close the panel on navigation; the thread underneath is kept
  }

  const back = () => {
    setView('grid')
  }

  const toggleReason = (key) => {
    setOpen((o) => ({ ...o, [key]: !o[key] }))
    setReviewed((r) => ({ ...r, [key]: true }))
  }

  const reviewedCount = kpi ? kpi.reasons.filter((_, i) => reviewed[kpi.id + i]).length : 0
  const canChat = kpi ? reviewedCount > 0 : false
  const chatOpen = chatOpenFor === id
  const msgs = kpi ? msgsByKpi[kpi.id] || [] : []

  const openChat = (seed) => {
    const intro = { role: 'a', text: `I have the full record for ${kpi.name} loaded — the ranked reasons, correlations, forecast, and audit status behind it. Ask me anything about it.` }
    setChatOpenFor(kpi.id)
    setMsgsByKpi((m) => (m[kpi.id]?.length ? m : { ...m, [kpi.id]: [intro] }))
    if (seed) send(seed)
  }

  const send = (override) => {
    const text = (override ?? input).trim()
    if (!text || busy || !kpi) return
    const kpiId = kpi.id
    setMsgsByKpi((m) => ({ ...m, [kpiId]: (m[kpiId] || []).concat([{ role: 'u', text }]) }))
    setInput('')
    setBusy(true)
    setTimeout(() => {
      const reply = answer(kpi, text)
      setMsgsByKpi((m) => ({ ...m, [kpiId]: (m[kpiId] || []).concat([{ role: 'a', text: reply }]) }))
      setBusy(false)
    }, 380)
  }

  if (view === 'grid' || !kpi) {
    let list = kpis.slice()
    if (filter !== 'All') list = list.filter((k) => k.statusTier === STATUS_LABEL_TO_TIER[filter])
    list.sort((a, b) => TIER_RANK[a.statusTier] - TIER_RANK[b.statusTier])

    return (
      <div style={{ color: 'var(--ink)', minHeight: '100vh', background: 'var(--bg)' }}>
        <Header crumb="Portfolio" />
        <div style={{ maxWidth: 1320, margin: '0 auto', padding: '56px 32px 80px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '28px 48px', alignItems: 'flex-end', paddingBottom: 28, borderBottom: '2px solid var(--ink)' }}>
            <div style={{ flex: '1 1 420px', minWidth: 0 }}>
              <div className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 18 }}>
                HEALTH_CARE · anomaly review
              </div>
              <h1 style={{ margin: 0, fontSize: 'clamp(34px,5vw,60px)', lineHeight: 0.98, letterSpacing: '-0.035em', fontWeight: 600, maxWidth: '14ch' }}>
                KPI health and the reasons behind it
              </h1>
            </div>
            <p style={{ flex: '1 1 260px', minWidth: 0, maxWidth: 320, margin: 0, fontSize: 14, lineHeight: 1.55, color: 'var(--muted-3)' }}>
              13 KPIs from HEALTH_CARE, scored for anomaly severity. Each card opens a full breakdown — ranked reasons, correlation evidence, a real forecast, and an analyst you can question.
            </p>
          </div>

          <SummaryStrip kpis={kpis} />
          <FilterBar filter={filter} onChange={setFilter} shownCount={list.length} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))', gap: 1, background: 'var(--line)', border: '1px solid var(--line)' }}>
            {list.map((k) => (
              <KpiCard key={k.id} kpi={k} onOpen={() => go(k.id)} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ color: 'var(--ink)', minHeight: '100vh', background: 'var(--bg)' }}>
      <Header crumb={`Portfolio / ${kpi.name}`} />
      <KpiDetail
        kpi={kpi}
        onBack={back}
        onOpenKpi={go}
        open={open}
        onToggleReason={toggleReason}
        onAsk={(seed) => openChat(seed)}
      />
      <ReviewBar reviewedCount={reviewedCount} totalCount={kpi.reasons.length} canChat={canChat} onChat={() => canChat && openChat()} />
      {chatOpen && (
        <ChatPanel
          kpi={kpi}
          msgs={msgs}
          input={input}
          busy={busy}
          suggestions={suggestionsFor(kpi)}
          onInput={(e) => setInput(e.target.value)}
          onKey={(e) => { if (e.key === 'Enter') send() }}
          onSend={() => send()}
          onPick={(s) => send(s)}
          onClose={() => setChatOpenFor(null)}
        />
      )}
    </div>
  )
}
