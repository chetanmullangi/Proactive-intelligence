import { useState } from 'react'
import { Card, Dept } from '../ui.jsx'
import { value } from '../format.js'

export default function Catalog({ data, go }) {
  const [dep, setDep] = useState('All')
  const tables = data.catalog.tables.filter((t) => dep === 'All' || t.department === dep)
  return (
    <div className="pi-page">
      <h1>Data & departments</h1>
      <p className="pi-sub">What every table holds, who owns it, and the business processes learned from the data.</p>
      <div className="pi-deptiles">
        {data.catalog.departments.map((d) => (
          <button key={d.name} className={'pi-deptile' + (dep === d.name ? ' sel' : '')} onClick={() => setDep(dep === d.name ? 'All' : d.name)}>
            <Dept name={d.name} />
            <span>
              {d.tables.length} tables · {d.kpis} KPIs · <b>{d.warnings}</b> open warnings
            </span>
          </button>
        ))}
      </div>
      <Card title="Business processes" sub="Learned from keys and dates: how often one record leads to another and how long it takes.">
        <table className="pi-table">
          <thead>
            <tr>
              <th>From</th>
              <th>To</th>
              <th>Happens for</th>
              <th>Typical delay</th>
              <th>90% within</th>
              <th>Amount each</th>
              <th>Based on</th>
            </tr>
          </thead>
          <tbody>
            {data.process.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.parent}
                  {p.segment ? <span className="pi-muted"> ({p.segment.split('=')[1].toLowerCase()})</span> : ''}
                </td>
                <td>{p.parent === p.child ? 'a corrected claim' : p.child}</td>
                <td>{(p.conversion * 100).toFixed(1)}%</td>
                <td>{Math.round(p.p50)} days</td>
                <td>{Math.round(p.p90)} days</td>
                <td>{p.amount ? value(p.amount, 'USD') : '—'}</td>
                <td className="pi-muted">{p.n.toLocaleString()} records</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title={`Tables${dep !== 'All' ? ' — ' + dep : ''}`} sub="Role, grain and business dates are inferred from the data and reviewed by the profiler agent.">
        <table className="pi-table">
          <thead>
            <tr>
              <th>Table</th>
              <th>Owner</th>
              <th>Role</th>
              <th>Rows</th>
              <th>What one row is</th>
              <th>Business date / arrives</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {tables
              .slice()
              .sort((a, b) => Number(b.kpi_source) - Number(a.kpi_source) || a.business_name.localeCompare(b.business_name))
              .map((t) => (
                <tr key={t.fqn} onClick={() => go('impact', { node: t.fqn })} className="pi-click">
                  <td>
                    <b>{t.business_name}</b>
                    <div className="pi-muted pi-small">{t.schema}.{t.name}</div>
                  </td>
                  <td>
                    <Dept name={t.department} small />
                  </td>
                  <td>{t.role}</td>
                  <td>{Number(t.rows).toLocaleString()}</td>
                  <td>{t.grain}</td>
                  <td className="pi-small">
                    {t.event_date || '—'}
                    {t.arrival_date ? ` / ${t.arrival_date}` : ''}
                  </td>
                  <td className="pi-small pi-muted">
                    {t.superseded_by ? `copied into ${data.tableById[t.superseded_by]?.business_name}` : t.kpi_source ? `${t.kpis} KPIs` : ''}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
