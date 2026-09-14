import { useEffect, useRef, useState } from 'react'
import Rail from './components/Rail.jsx'
import TopBar from './components/TopBar.jsx'
import SummaryStrip from './components/SummaryStrip.jsx'
import FilterBar from './components/FilterBar.jsx'
import KpiCard from './components/KpiCard.jsx'
import KpiDetail from './components/KpiDetail.jsx'
import ChatDrawer from './components/ChatDrawer.jsx'
import { kpis, kpiById, generatedAt } from './data/kpis.js'
import { answer, suggestionsFor } from './lib/chatEngine.js'
import { askLive } from './lib/liveChat.js'
import { usePersisted } from './lib/usePersisted.js'

const STATUS_LABEL_TO_TIER = { Anomaly: 'anomaly', Watch: 'watch', Stable: 'stable' }
const TIER_RANK = { anomaly: 0, watch: 1, stable: 2 }

export default function App() {
  const [view, setView] = usePersisted('view', 'grid')
  const [id, setId] = usePersisted('id', null)
  const [filter, setFilter] = usePersisted('filter', 'All')
  const [open, setOpen] = usePersisted('open', {})
  const [reviewed, setReviewed] = usePersisted('reviewed', {})
  const [chatOpenFor, setChatOpenFor] = usePersisted('chatOpenFor', null)
  const [msgsByKpi, setMsgsByKpi] = usePersisted('msgsByKpi', {})
  const [railFull, setRailFull] = usePersisted('railFull', null) // null = auto by width
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [width, setWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1440)
  const rootRef = useRef(null)

  useEffect(() => {
    const onResize = () => setWidth(rootRef.current ? rootRef.current.offsetWidth : window.innerWidth)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const kpi = id ? kpiById(id) : null
  if (id && !kpi && view === 'detail') {
    setView('grid')
    setId(null)
  }

  const go = (kpiId) => {
    setView('detail')
    setId(kpiId)
    setChatOpenFor(null)
  }
  const back = () => setView('grid')

  const toggleReason = (key) => {
    setOpen((o) => ({ ...o, [key]: !o[key] }))
    setReviewed((r) => ({ ...r, [key]: true }))
  }

  const reviewedCount = kpi ? kpi.reasons.filter((_, i) => reviewed[kpi.id + i]).length : 0
  const chatOpen = !!kpi && chatOpenFor === id
  const msgs = kpi ? msgsByKpi[kpi.id] || [] : []

  const openChat = (seed) => {
    const intro = { role: 'a', text: `I have the full record for ${kpi.name} loaded — ranked reasons, correlations, forecast and audit status. Ask me anything about it.` }
    setChatOpenFor(kpi.id)
    setMsgsByKpi((m) => (m[kpi.id]?.length ? m : { ...m, [kpi.id]: [intro] }))
    if (seed) send(seed)
  }

  const send = (override) => {
    const text = (override ?? input).trim()
    if (!text || busy || !kpi) return
    const kpiId = kpi.id
    const history = msgsByKpi[kpiId] || []
    setMsgsByKpi((m) => ({ ...m, [kpiId]: (m[kpiId] || []).concat([{ role: 'u', text }]) }))
    setInput('')
    setBusy(true)
    askLive(kpi, text, history)
      .catch(() => {
        // Live analyst server isn't reachable — fall back to the offline,
        // record-grounded canned engine rather than failing the chat.
        return (
          answer(kpi, text) +
          '\n\n(Offline mode — the live analyst isn’t running right now, so this is a saved answer from the record instead.)'
        )
      })
      .then((reply) => {
        setMsgsByKpi((m) => ({ ...m, [kpiId]: (m[kpiId] || []).concat([{ role: 'a', text: reply }]) }))
      })
      .finally(() => setBusy(false))
  }

  const railFullResolved = railFull === null ? width >= 1240 : railFull
  const chatFloats = width < 1080

  let list = kpis.slice()
  if (filter !== 'All') list = list.filter((k) => k.statusTier === STATUS_LABEL_TO_TIER[filter])
  list.sort((a, b) => TIER_RANK[a.statusTier] - TIER_RANK[b.statusTier])

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'flex', height: '100vh', overflow: 'hidden', background: '#fff', color: 'var(--ink)' }}>
      <Rail
        kpis={kpis}
        full={railFullResolved}
        onToggle={() => setRailFull(!railFullResolved)}
        view={view}
        currentId={id}
        onGrid={back}
        onOpen={go}
        generatedAt={generatedAt}
      />

      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <TopBar crumb={view === 'grid' ? 'Portfolio' : `Portfolio / ${kpi?.name}`} kpi={kpi} chatOpen={chatOpen} onOpenChat={() => openChat()} onBack={back} />

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {(view === 'grid' || !kpi) && (
            <div style={{ maxWidth: 1120, margin: '0 auto', padding: '24px clamp(14px,2vw,28px) 48px', animation: 'fadeUp 200ms ease both' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 20, alignItems: 'stretch' }}>
                <div style={{ borderRadius: 14, background: '#f6f6ff', border: '1px solid #dedefb', padding: '24px 26px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <span style={{ alignSelf: 'flex-start', fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#fff', background: 'var(--pri)', borderRadius: 999, padding: '4px 10px' }}>
                    HEALTH_CARE · anomaly review
                  </span>
                  <h1 style={{ margin: 0, fontSize: 'clamp(24px,2.4vw,32px)', lineHeight: 1.12, letterSpacing: '-0.025em', fontWeight: 600 }}>KPI health, and the reasons behind it</h1>
                  <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--ink-2)', maxWidth: '52ch' }}>
                    {kpis.length} metrics from HEALTH_CARE, scored for anomaly severity. Open a card for the full breakdown — ranked business-language reasons, correlation evidence, a real forecast — and question the analyst as you read.
                  </p>
                </div>
                <SummaryStrip kpis={kpis} />
              </div>

              <FilterBar filter={filter} onChange={setFilter} shownCount={list.length} totalCount={kpis.length} />

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 16 }}>
                {list.map((k) => (
                  <KpiCard key={k.id} kpi={k} onOpen={() => go(k.id)} />
                ))}
              </div>
            </div>
          )}

          {view === 'detail' && kpi && (
            <KpiDetail
              kpi={kpi}
              onOpenKpi={go}
              open={open}
              onToggleReason={toggleReason}
              reviewedCount={reviewedCount}
              onAsk={(seed) => openChat(seed)}
            />
          )}
        </div>
      </main>

      {chatOpen && (
        <ChatDrawer
          kpi={kpi}
          floats={chatFloats}
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
