import { useMemo, useState } from 'react'
import { Card, Confidence, Dept, Empty, SeverityBadge } from '../ui.jsx'
import { KIND, SEVERITY, money, pct, value } from '../format.js'
import KpiChart from '../Chart.jsx'

function Drivers({ ev }) {
  const drivers = ev?.finding?.drivers || []
  if (!drivers.length) return null
  return (
    <div className="pi-drivers">
      <h4>Where the change sits</h4>
      <table className="pi-table">
        <thead>
          <tr>
            <th>Broken down by</th>
            <th>Biggest contributor</th>
            <th>Share of the change</th>
            <th>Normal share</th>
          </tr>
        </thead>
        <tbody>
          {drivers.slice(0, 4).map((d) => (
            <tr key={d.dimension} className={d.concentrated ? 'pi-strong' : ''}>
              <td>{d.dimension.split('>').pop().replace(/_/g, ' ').toLowerCase()}</td>
              <td>{d.segments[0]?.label || d.segments[0]?.value}</td>
              <td>{Math.round(Math.min(d.top_share_of_change, 1) * 100)}%</td>
              <td>{Math.round(d.top_base_share * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Downstream({ ds, data }) {
  const tables = ds?.tables || []
  const kpis = ds?.kpis || []
  if (!tables.length && !kpis.length) return null
  return (
    <div className="pi-down">
      <h4>Downstream impact</h4>
      <ul>
        {tables.slice(0, 8).map((t) => (
          <li key={t.table}>
            <Dept name={t.department} small /> <b>{t.business_name}</b>
            <span className="pi-muted">
              {' '}
              · {t.hops} step{t.hops > 1 ? 's' : ''} away{t.typical_delay_days ? ` · typically ~${Math.round(t.typical_delay_days)} days later` : ''}
              {t.path?.length ? ` · ${t.path[t.path.length - 1].why}` : ''}
            </span>
          </li>
        ))}
      </ul>
      {kpis.length > 0 && (
        <p className="pi-muted">
          KPIs that will move with it: {kpis.slice(0, 6).map((k) => data.kpiById[k.kpi_id]?.name || k.business_name).join(' · ')}
        </p>
      )}
    </div>
  )
}

function Comparisons({ c, unit }) {
  if (!c) return null
  const rows = [
    ['Last 7 days', c.last_7_days_vs_prior, c.last_7_days_vs_last_year],
    ['Last 28 days', c.last_28_days_vs_prior, c.last_28_days_vs_last_year],
    ['Month to date', c.month_to_date?.vs_prior, c.month_to_date?.vs_last_year, c.month_to_date?.current],
    ['Last month', c.last_month?.vs_prior, c.last_month?.vs_last_year, c.last_month?.current],
    ['Quarter to date', c.quarter_to_date?.vs_prior, c.quarter_to_date?.vs_last_year, c.quarter_to_date?.current],
    ['Year to date', null, c.year_to_date?.vs_last_year, c.year_to_date?.current],
  ]
  return (
    <table className="pi-table pi-compare">
      <thead>
        <tr>
          <th></th>
          <th>Value</th>
          <th>vs previous</th>
          <th>vs last year</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, p, ly, cur]) => (
          <tr key={k}>
            <td>{k}</td>
            <td>{value(cur ?? p?.current ?? ly?.current, unit)}</td>
            <td>{p ? pct(p.change_pct) : '—'}{p?.unusual_z != null && Math.abs(p.unusual_z) >= 2.5 ? ' ⚑' : ''}</td>
            <td>{ly ? pct(ly.change_pct) : '—'}{ly?.unusual_z != null && Math.abs(ly.unusual_z) >= 2.5 ? ' ⚑' : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function WarningCard({ w, data, openId, setOpen }) {
  const open = openId === w.id
  const ev = w.evidence
  const kpi = w.kind !== 'data' && ev?.finding?.business_name ? data.kpiById[w.key?.split(':').slice(1, -1).join(':')] : null
  return (
    <article className={'pi-warn' + (open ? ' open' : '')} id={w.id}>
      <div className="pi-warn-head" onClick={() => setOpen(open ? null : w.id)}>
        <div className="pi-wrow">
          <SeverityBadge s={w.severity} />
          <span className="pi-kind">{KIND[w.kind]}</span>
          <span className={'pi-status ' + w.status}>{w.status === 'new' ? 'new today' : w.status === 'continuing' ? `since ${w.first_seen}` : 'resolved'}</span>
          {w.usd ? <span className="pi-usd">{money(w.usd)} at stake</span> : null}
          <span className="pi-timing">{w.timing}</span>
        </div>
        <h3>{w.title}</h3>
        <p>{w.reason}</p>
        <div className="pi-deps">{(w.departments || []).map((d) => <Dept key={d} name={d} small />)}</div>
      </div>
      {open && (
        <div className="pi-warn-body">
          <div className="pi-grid2">
            <div>
              <h4>Impact</h4>
              <p>{w.impact}</p>
              <h4>What to do</h4>
              <p>{w.todo}</p>
              {w.external && (
                <>
                  <h4>Real-world signal</h4>
                  <p>{w.external}</p>
                </>
              )}
              <p>
                <Confidence c={w.confidence} />
              </p>
            </div>
            <div>
              {kpi && <KpiChart kpi={kpi} height={200} compact />}
              {kpi && <Comparisons c={kpi.comparisons} unit={kpi.unit} />}
            </div>
          </div>
          <Drivers ev={ev} />
          <Downstream ds={w.downstream} data={data} />
          <details className="pi-tech">
            <summary>Technical detail</summary>
            <pre>{typeof ev?.technical === 'string' ? ev.technical : JSON.stringify(ev?.technical, null, 1)}</pre>
            <pre>{JSON.stringify(ev?.causes, null, 1)}</pre>
          </details>
        </div>
      )}
    </article>
  )
}

export default function Warnings({ data, params, go }) {
  const [openId, setOpen] = useState(params?.open || null)
  const [dep, setDep] = useState(params?.department || 'All')
  const [kind, setKind] = useState('All')
  const [sev, setSev] = useState(params?.severity || 'All')
  const deps = ['All', ...data.catalog.departments.map((d) => d.name)]
  const list = useMemo(
    () =>
      data.warnings
        .filter((w) => dep === 'All' || (w.departments || []).includes(dep))
        .filter((w) => kind === 'All' || w.kind === kind)
        .filter((w) => sev === 'All' || w.severity === sev)
        .sort((a, b) => (SEVERITY[a.severity]?.rank ?? 9) - (SEVERITY[b.severity]?.rank ?? 9)),
    [data, dep, kind, sev],
  )
  return (
    <div className="pi-page">
      <h1>Warnings</h1>
      <p className="pi-sub">What is happening, what is coming, and data problems — each with the business reason, who is affected downstream and what to do.</p>
      <div className="pi-filters">
        <select value={dep} onChange={(e) => setDep(e.target.value)}>
          {deps.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {['All', ...Object.keys(KIND)].map((k) => (
            <option key={k} value={k}>
              {k === 'All' ? 'All kinds' : KIND[k]}
            </option>
          ))}
        </select>
        <select value={sev} onChange={(e) => setSev(e.target.value)}>
          {['All', ...Object.keys(SEVERITY)].map((k) => (
            <option key={k} value={k}>
              {k === 'All' ? 'All severities' : SEVERITY[k].label}
            </option>
          ))}
        </select>
        <span className="pi-muted">{list.length} warnings</span>
      </div>
      {list.length ? list.map((w) => <WarningCard key={w.id} w={w} data={data} openId={openId} setOpen={setOpen} />) : <Empty>No warnings match.</Empty>}
    </div>
  )
}
