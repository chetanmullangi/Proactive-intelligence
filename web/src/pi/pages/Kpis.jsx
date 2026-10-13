import { useMemo, useState } from 'react'
import { Card, Dept, StateBadge } from '../ui.jsx'
import KpiChart from '../Chart.jsx'
import { STATE, isNum, pct, value } from '../format.js'

const RANK = { attention: 0, stale: 1, watch: 2, too_early: 3, normal: 4, insufficient_history: 5, no_data: 6 }

export default function Kpis({ data, params, go }) {
  const [sel, setSel] = useState(params?.id || null)
  const [q, setQ] = useState('')
  const [dep, setDep] = useState('All')
  const list = useMemo(
    () =>
      data.kpis
        .filter((k) => dep === 'All' || k.department === dep)
        .filter((k) => !q || (k.name + ' ' + (k.description || '')).toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => (RANK[a.state] ?? 9) - (RANK[b.state] ?? 9) || Math.abs(b.z || 0) - Math.abs(a.z || 0)),
    [data, q, dep],
  )
  const k = sel ? data.kpiById[sel] : list[0]
  return (
    <div className="pi-page pi-split">
      <aside className="pi-listpane">
        <input placeholder="Search KPIs" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={dep} onChange={(e) => setDep(e.target.value)}>
          {['All', ...data.catalog.departments.map((d) => d.name)].map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <ul>
          {list.map((x) => (
            <li key={x.id} className={k && k.id === x.id ? 'sel' : ''} onClick={() => setSel(x.id)}>
              <i style={{ background: STATE[x.state]?.fg || '#98a2b3' }} />
              <span>{x.name}</span>
            </li>
          ))}
        </ul>
      </aside>
      {k && <KpiDetail k={k} data={data} go={go} />}
    </div>
  )
}

function KpiDetail({ k, data, go }) {
  const c = k.comparisons || {}
  const fq = k.forecast
  const t13 = k.trend?.last_13
  return (
    <div className="pi-detail">
      <div className="pi-wrow">
        <StateBadge s={k.state} />
        <Dept name={k.department} small />
        <span className="pi-muted">{k.table_name}</span>
      </div>
      <h1>{k.name}</h1>
      <p className="pi-sub">{k.description}</p>
      <div className="pi-stats">
        <div>
          <span>Latest judged {k.grain}</span>
          <b>{value(k.actual, k.unit)}</b>
          <em>{k.period}</em>
        </div>
        <div>
          <span>Expected</span>
          <b>{value(k.expected, k.unit)}</b>
          <em>
            normal {value(k.lower, k.unit)} – {value(k.upper, k.unit)}
          </em>
        </div>
        <div>
          <span>Last 28 days vs last year</span>
          <b>{pct(c.last_28_days_vs_last_year?.change_pct)}</b>
          <em>vs prior 28 days {pct(c.last_28_days_vs_prior?.change_pct)}</em>
        </div>
        <div>
          <span>Trend (13 {k.grain}s)</span>
          <b>{isNum(t13?.pct_per_period) ? pct(t13.pct_per_period, 1) + ` / ${k.grain}` : '—'}</b>
          <em>{t13?.significant ? 'a real trend' : 'no clear trend'}</em>
        </div>
      </div>
      <Card
        title="History and forecast"
        sub={
          fq
            ? `Forecast method chosen by backtest: ${fq.method.replace('_', ' ')} — ${
                fq.skill > 0.02 ? `${Math.round(fq.skill * 100)}% more accurate than repeating the last value` : 'no better than repeating the last value, so read it as "about the current level"'
              }. Dotted = still filling in; open circles = estimated final values.`
            : 'No forecast for this KPI (too little history or not an additive measure).'
        }
      >
        <KpiChart kpi={k} />
      </Card>
      <div className="pi-grid2">
        <Card title="Comparisons">
          <table className="pi-table">
            <tbody>
              {[
                ['Last 7 days vs previous 7', c.last_7_days_vs_prior],
                ['Last 7 days vs same week last year', c.last_7_days_vs_last_year],
                ['Last 28 days vs previous 28', c.last_28_days_vs_prior],
                ['Last 28 days vs last year', c.last_28_days_vs_last_year],
              ].map(([lbl, x]) => (
                <tr key={lbl}>
                  <td>{lbl}</td>
                  <td>{x ? pct(x.change_pct) : '—'}</td>
                  <td className="pi-muted">{x?.typical_abs_change_pct != null ? `usually moves ±${Math.round(x.typical_abs_change_pct)}%` : ''}</td>
                </tr>
              ))}
              {[
                ['Month to date', c.month_to_date],
                ['Last month', c.last_month],
                ['Quarter to date', c.quarter_to_date],
                ['Year to date', c.year_to_date],
              ].map(([lbl, x]) => (
                <tr key={lbl}>
                  <td>{lbl}</td>
                  <td>{value(x?.current, k.unit)}</td>
                  <td className="pi-muted">
                    {x?.vs_prior ? `vs previous ${pct(x.vs_prior.change_pct)}` : ''} {x?.vs_last_year ? ` · vs last year ${pct(x.vs_last_year.change_pct)}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="How it was judged" sub="For the data team.">
          <p className="pi-mono">{k.why}</p>
          <p className="pi-muted">
            Freshness: {k.freshness_days ?? '—'} days since the last mature data point · completeness of the judged period {isNum(k.completeness) ? Math.round(k.completeness * 100) + '%' : '—'}
            {k.newer_filling_in ? ` · ${k.newer_filling_in} newer ${k.grain}(s) still filling in` : ''}
          </p>
          <button className="pi-link" onClick={() => go('impact', { node: k.table })}>
            What depends on this →
          </button>
        </Card>
      </div>
    </div>
  )
}
