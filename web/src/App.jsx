import { useEffect, useRef, useState } from 'react'
import Rail from './components/Rail.jsx'
import TopBar from './components/TopBar.jsx'
import SummaryStrip from './components/SummaryStrip.jsx'
import FilterBar from './components/FilterBar.jsx'
import KpiCard from './components/KpiCard.jsx'
import KpiDetail from './components/KpiDetail.jsx'
import RiskBrief from './components/RiskBrief.jsx'
import FlagsPanel from './components/FlagsPanel.jsx'
import ChatDrawer from './components/ChatDrawer.jsx'
import { kpis, kpiById, generatedAt, statusMeta } from './data/kpis.js'
import { risks, riskById, riskRunAt, impactMeta, formatUsd } from './data/risks.js'
import { answer, suggestionsFor } from './lib/chatEngine.js'
import { answerRisk, riskIntro, riskSuggestions } from './lib/riskChat.js'
import { askLive } from './lib/liveChat.js'
import { usePersisted } from './lib/usePersisted.js'
import { fmt } from './lib/format.js'

const STATUS_LABEL_TO_TIER = { Anomaly: 'anomaly', Watch: 'watch', Stable: 'stable' }
const TIER_RANK = { anomaly: 0, watch: 1, stable: 2 }
const RISK_PREFIX = 'risk:'
const OFFLINE_NOTE = '\n\n(Offline mode — the live analyst isn’t running right now, so this is a saved answer from the record instead.)'

// Chat keys: a KPI id (unchanged from before, so saved histories still load)
// or `risk:<id>` for a risk pattern.
function resolveChat(key) {
  if (!key) return null
  if (key.startsWith(RISK_PREFIX)) {
    const risk = riskById(key.slice(RISK_PREFIX.length))
    return risk ? { key, risk } : null
  }
  const kpi = kpiById(key)
  return kpi ? { key, kpi } : null
}

export default function App() {
  const [view, setView] = usePersisted('view', 'risk')
  const [id, setId] = usePersisted('id', null)
  const [filter, setFilter] = usePersisted('filter', 'All')
  const [resolvedFlags, setResolvedFlags] = usePersisted('resolvedFlags', {})
  const [chatOpenFor, setChatOpenFor] = usePersisted('chatOpenFor', null)
  const [msgsByKpi, setMsgsByKpi] = usePersisted('msgsByKpi', {})
  const [railFull, setRailFull] = usePersisted('railFull', null) // null = auto by width
  const [selectedRiskId, setSelectedRiskId] = useState(null)
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
  const toggleFlag = (flagId) => setResolvedFlags((r) => ({ ...r, [flagId]: !r[flagId] }))
  const toRisk = (riskId = null) => {
    setView('risk')
    setSelectedRiskId(riskId)
    setChatOpenFor(null)
  }

  const active = resolveChat(chatOpenFor)
  const chatVisible =
    !!active && ((active.kpi && view === 'detail' && active.kpi.id === id) || (active.risk && view === 'risk'))
  const msgs = active ? msgsByKpi[active.key] || [] : []

  const send = (override, keyOverride) => {
    const target = resolveChat(keyOverride ?? chatOpenFor)
    const text = (override ?? input).trim()
    if (!text || busy || !target) return
    const { key } = target
    const history = msgsByKpi[key] || []
    setMsgsByKpi((m) => ({ ...m, [key]: (m[key] || []).concat([{ role: 'u', text }]) }))
    setInput('')
    setBusy(true)
    const ids = target.risk ? { riskId: target.risk.id } : { kpiId: target.kpi.id }
    askLive(ids, text, history)
      .catch(() => (target.risk ? answerRisk(target.risk, text) : answer(target.kpi, text)) + OFFLINE_NOTE)
      .then((reply) => {
        setMsgsByKpi((m) => ({ ...m, [key]: (m[key] || []).concat([{ role: 'a', text: reply }]) }))
      })
      .finally(() => setBusy(false))
  }

  const openChat = (key, intro, seed) => {
    setChatOpenFor(key)
    setMsgsByKpi((m) => (m[key]?.length ? m : { ...m, [key]: [{ role: 'a', text: intro }] }))
    if (seed) send(seed, key)
  }
  const openKpiChat = (seed) =>
    openChat(kpi.id, `I have the full record for ${kpi.name} loaded — what’s happening, why, the forecast and data checks. Ask me anything about it.`, seed)
  const openRiskChat = (riskId) => {
    const risk = riskById(riskId)
    setSelectedRiskId(riskId)
    openChat(RISK_PREFIX + riskId, riskIntro(risk))
  }

  const railFullResolved = railFull === null ? width >= 1240 : railFull
  const chatFloats = width < 1080

  let list = kpis.slice()
  if (filter !== 'All') list = list.filter((k) => k.statusTier === STATUS_LABEL_TO_TIER[filter])
  list.sort((a, b) => TIER_RANK[a.statusTier] - TIER_RANK[b.statusTier])

  let crumbs, asOfText
  if (view === 'risk') {
    crumbs = [{ label: 'Risk brief' }]
    asOfText = `Risk run ${riskRunAt.slice(0, 10)}`
  } else if (view === 'detail' && kpi) {
    crumbs = [{ label: 'KPI portfolio', onClick: back }, { label: kpi.name }]
    asOfText = `As of ${kpi.asOfDate}`
  } else {
    crumbs = [{ label: 'KPI portfolio' }]
    asOfText = 'HEALTH_CARE · last 90 days'
  }

  let chatScope = null
  if (active?.risk) {
    const meta = impactMeta[active.risk.impact]
    chatScope = { name: active.risk.headline, meta, metaText: `${formatUsd(active.risk.exposureUsd)} · ${meta.label}` }
  } else if (active?.kpi) {
    const meta = statusMeta[active.kpi.statusTier]
    chatScope = { name: active.kpi.name, meta, metaText: `${fmt(active.kpi, active.kpi.value)} · ${meta.label}` }
  }

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'flex', height: '100vh', overflow: 'hidden', background: '#fff', color: 'var(--ink)' }}>
      <Rail
        kpis={kpis}
        risks={risks}
        full={railFullResolved}
        onToggle={() => setRailFull(!railFullResolved)}
        view={view}
        currentId={id}
        selectedRiskId={selectedRiskId}
        onRisk={() => toRisk(null)}
        onGrid={back}
        onOpen={go}
        onOpenRisk={toRisk}
        generatedAt={generatedAt}
        riskRunAt={riskRunAt}
      />

      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <TopBar
          crumbs={crumbs}
          asOfText={asOfText}
          showAsk={view === 'detail' && !!kpi && !chatVisible}
          onOpenChat={() => openKpiChat()}
        />

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {view === 'risk' && <RiskBrief selectedId={selectedRiskId} onAsk={openRiskChat} onOpenKpi={go} />}

          {(view === 'grid' || (view === 'detail' && !kpi)) && (
            <div style={{ maxWidth: 1120, margin: '0 auto', padding: '24px clamp(14px,2vw,28px) 48px', animation: 'fadeUp 200ms ease both' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 20, alignItems: 'stretch' }}>
                <div style={{ borderRadius: 14, background: '#f6f6ff', border: '1px solid #dedefb', padding: '24px 26px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <span style={{ alignSelf: 'flex-start', fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#fff', background: 'var(--pri)', borderRadius: 999, padding: '4px 10px' }}>
                    HEALTH_CARE · what already happened
                  </span>
                  <h1 style={{ margin: 0, fontSize: 'clamp(24px,2.4vw,32px)', lineHeight: 1.12, letterSpacing: '-0.025em', fontWeight: 600 }}>KPI health, and the reasons behind it</h1>
                  <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--ink-2)', maxWidth: '52ch' }}>
                    {kpis.length} metrics from HEALTH_CARE. Open a card for what’s happening, why, and what to expect next — and question the analyst as you read. For what’s likely to go wrong next, see the Risk brief.
                  </p>
                </div>
                <SummaryStrip kpis={kpis} />
              </div>

              <div style={{ marginTop: 20 }}>
                <FlagsPanel resolved={resolvedFlags} onToggle={toggleFlag} onOpenKpi={go} kpiById={kpiById} />
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
              onOpenRisk={toRisk}
              onAsk={(seed) => openKpiChat(seed)}
            />
          )}
        </div>
      </main>

      {chatVisible && chatScope && (
        <ChatDrawer
          scope={chatScope}
          floats={chatFloats}
          msgs={msgs}
          input={input}
          busy={busy}
          suggestions={active.risk ? riskSuggestions() : suggestionsFor(active.kpi)}
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
