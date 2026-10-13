import { Card, Empty, SeverityBadge } from '../ui.jsx'
import { Bars } from '../Chart.jsx'
import { pct } from '../format.js'

const TYPE = {
  future_date: 'Dates in the future',
  load_gap: 'Records not yet in the warehouse',
  feed_stale: 'No new records arriving',
  header_line_mismatch: 'Totals do not match their lines',
  duplicate_key: 'Duplicate records',
  orphan_key: 'References to missing records',
}

export default function Health({ data }) {
  const h = data.data_health
  const issues = h.checks.filter((c) => c.failed > 0).sort((a, b) => (a.severity > b.severity ? 1 : -1))
  return (
    <div className="pi-page">
      <h1>Data health</h1>
      <p className="pi-sub">Problems in the data itself, how late data arrives, and whether the daily summaries still reconcile with the raw tables.</p>
      <Card title="Open data problems">
        {issues.length ? (
          <table className="pi-table">
            <thead>
              <tr>
                <th></th>
                <th>Problem</th>
                <th>Table</th>
                <th>Records</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((c) => (
                <tr key={c.id}>
                  <td>
                    <SeverityBadge s={c.severity === 'high' ? 'high' : c.severity === 'medium' ? 'medium' : 'low'} />
                  </td>
                  <td>{TYPE[c.type] || c.type}</td>
                  <td>{c.name}</td>
                  <td>
                    {Number(c.failed).toLocaleString()}
                    {c.checked ? <span className="pi-muted"> of {Number(c.checked).toLocaleString()}</span> : ''}
                  </td>
                  <td className="pi-small pi-mono">{Object.entries(c.detail || {}).map(([k, v]) => `${k}: ${v}`).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No data problems found.</Empty>
        )}
      </Card>
      <div className="pi-grid2">
        <Card title="How late data arrives" sub="Share of a day's records that have arrived after N days (measured on mature history). Recent periods are judged only once mostly complete.">
          <table className="pi-table">
            <thead>
              <tr>
                <th>Table</th>
                <th>Measure</th>
                {[0, 7, 14, 30, 60, 90].map((d) => (
                  <th key={d}>{d}d</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {h.completeness.map((c) => (
                <tr key={c.table + c.kind}>
                  <td>{c.name}</td>
                  <td className="pi-small">{c.kind === 'arrival' ? 'received' : 'decided'}{c.source?.startsWith('inherited') ? ' (inherited)' : ''}</td>
                  {[0, 7, 14, 30, 60, 90].map((d) => (
                    <td key={d}>{c.by_day[d] != null ? Math.round(c.by_day[d] * 100) + '%' : '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Daily summaries" sub="Incremental build per table; totals are reconciled against the raw table every week.">
          <Bars
            rows={h.builds
              .slice()
              .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
              .map((b) => ({ k: b.name, v: 1, color: b.reconcile_ok ? '#12b76a' : '#f04438', label: `${b.mode} · ${b.reconcile_ok ? 'reconciled' : 'MISMATCH'}`, title: b.detail }))}
            height={10}
          />
        </Card>
      </div>
    </div>
  )
}
