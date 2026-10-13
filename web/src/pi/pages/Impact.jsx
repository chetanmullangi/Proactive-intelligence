import { useMemo, useState } from 'react'
import { Card, Dept } from '../ui.jsx'
import { deptColor } from '../format.js'

// Downstream traversal over the exported graph: loads, learned business processes and validated keys.
function downstream(graph, start, maxHops = 4) {
  const adj = {}
  for (const e of graph.edges) (adj[e.from] ||= []).push(e)
  const seen = { [start]: { hops: 0, lag: 0, via: null } }
  const q = [start]
  while (q.length) {
    const n = q.shift()
    if (seen[n].hops >= maxHops) continue
    for (const e of adj[n] || []) {
      if (e.kind === 'key' && seen[n].hops >= 1) continue // lookups only one step
      if (seen[e.to] && seen[e.to].hops <= seen[n].hops + 1) continue
      seen[e.to] = { hops: seen[n].hops + 1, lag: seen[n].lag + (e.lag || 0), via: e, from: n }
      q.push(e.to)
    }
  }
  return seen
}

function layer(node) {
  if (node.schema !== 'MAIN') return 0
  if (node.role === 'mart') return 3
  if (node.role === 'dimension' || node.role === 'bridge') return 1
  return 2
}

export default function Impact({ data, params }) {
  const nodes = data.graph.nodes
  const facts = nodes.filter((n) => n.kpi_source || n.role === 'fact').sort((a, b) => a.label.localeCompare(b.label))
  const [sel, setSel] = useState(params?.node || facts.find((n) => n.label.toLowerCase().includes('claim'))?.id || nodes[0]?.id)
  const reach = useMemo(() => downstream(data.graph, sel), [data, sel])
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]))
  const cols = [0, 1, 2, 3].map((l) => nodes.filter((n) => layer(n) === l))
  const W = 980
  const rowH = 26
  const H = Math.max(...cols.map((c) => c.length)) * rowH + 40
  const pos = {}
  cols.forEach((c, li) => c.forEach((n, i) => (pos[n.id] = { x: 20 + li * 240, y: 30 + i * rowH })))
  const affected = Object.entries(reach)
    .filter(([id, v]) => v.hops > 0 && byId[id])
    .sort((a, b) => a[1].hops - b[1].hops)
  const deps = [...new Set(affected.map(([id]) => byId[id].department))]
  return (
    <div className="pi-page">
      <h1>Impact map</h1>
      <p className="pi-sub">
        Pick a table: everything that depends on it lights up — through data loads (observed in query history), learned business processes and validated keys —
        with the departments to tell.
      </p>
      <div className="pi-filters">
        <select value={sel} onChange={(e) => setSel(e.target.value)}>
          {nodes
            .slice()
            .sort((a, b) => a.label.localeCompare(b.label))
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.label} ({n.schema})
              </option>
            ))}
        </select>
        <span className="pi-muted">
          {affected.length} downstream tables · {deps.length} departments
        </span>
      </div>
      <Card>
        <svg viewBox={`0 0 ${W} ${H}`} className="pi-graph">
          {['Source system', 'Reference & dimensions', 'Warehouse facts', 'Marts'].map((t, i) => (
            <text key={t} x={20 + i * 240} y={16} fontSize="12" fontWeight="600" fill="#475467">
              {t}
            </text>
          ))}
          {data.graph.edges.map((e, i) => {
            const a = pos[e.from]
            const b = pos[e.to]
            if (!a || !b) return null
            const on = reach[e.to]?.via === e
            if (!on && e.kind === 'key') return null
            return (
              <path
                key={i}
                d={`M${a.x + 200},${a.y} C${a.x + 230},${a.y} ${b.x - 30},${b.y} ${b.x},${b.y}`}
                fill="none"
                stroke={on ? (e.kind === 'process' ? '#d92d20' : '#5353ef') : '#eaecf0'}
                strokeWidth={on ? 1.8 : 1}
              >
                <title>{e.label}</title>
              </path>
            )
          })}
          {nodes.map((n) => {
            const p = pos[n.id]
            const r = reach[n.id]
            const isSel = n.id === sel
            return (
              <g key={n.id} transform={`translate(${p.x},${p.y - 9})`} onClick={() => setSel(n.id)} style={{ cursor: 'pointer' }}>
                <rect width="200" height="18" rx="5" fill={isSel ? '#5353ef' : r ? '#fff4e6' : '#fff'} stroke={r ? deptColor(n.department) : '#eaecf0'} />
                <circle cx="9" cy="9" r="3.5" fill={deptColor(n.department)} />
                <text x="18" y="13" fontSize="11" fill={isSel ? '#fff' : '#344054'}>
                  {n.label.length > 30 ? n.label.slice(0, 29) + '…' : n.label}
                </text>
              </g>
            )
          })}
        </svg>
      </Card>
      <Card title="Who to tell" sub="Downstream tables in order of distance, with the reason each depends on the selected one.">
        <ul className="pi-impactlist">
          {affected.map(([id, v]) => (
            <li key={id}>
              <Dept name={byId[id].department} small />
              <b>{byId[id].label}</b>
              <span className="pi-muted">
                {v.hops} step{v.hops > 1 ? 's' : ''}
                {v.lag ? ` · typically ~${Math.round(v.lag)} days later` : ''} · {v.via?.kind === 'process' ? v.via.label : v.via?.kind === 'load' ? `loaded from ${byId[v.from]?.label}` : `references ${byId[v.from]?.label} (${v.via?.label})`}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
