import { Card, Dept, SeverityBadge, Empty } from '../ui.jsx'
import { KIND, SEVERITY, isNum, pct, value } from '../format.js'

const ORDER = ['revenue', 'total_cost', 'medical_loss_ratio', 'cost_pmpm', 'medical_cost', 'pharmacy_cost', 'membership', 'member_months']
const LABEL = {
  revenue: 'Premium revenue',
  total_cost: 'Total medical + pharmacy cost',
  medical_loss_ratio: 'Medical loss ratio',
  cost_pmpm: 'Cost per member per month',
  medical_cost: 'Medical claims cost',
  pharmacy_cost: 'Pharmacy cost',
  membership: 'Members in force (avg)',
  member_months: 'Member months',
}
const BAD_UP = new Set(['total_cost', 'medical_loss_ratio', 'cost_pmpm', 'medical_cost', 'pharmacy_cost'])

export default function Overview({ data, go }) {
  const periods = [...new Set(data.outlook.map((o) => o.period))].sort()
  const open = data.warnings.filter((w) => w.status !== 'resolved')
  const top = open.filter((w) => w.kind !== 'good_news').slice(0, 6)
  const sev = Object.fromEntries(Object.keys(SEVERITY).map((s) => [s, open.filter((w) => w.severity === s).length]))
  return (
    <div className="pi-page">
      <div className="pi-hero">
        <div>
          <h1>Proactive intelligence</h1>
          <p className="pi-sub">
            {data.meta.database} · data as of {data.meta.as_of} · {data.meta.tables} tables understood · {data.meta.kpis} KPIs watched daily
          </p>
        </div>
        <div className="pi-sevstrip">
          {['critical', 'high', 'medium', 'low'].map((s) => (
            <button key={s} className="pi-sevcount" onClick={() => go('warnings', { severity: s })}>
              <b style={{ color: SEVERITY[s].fg }}>{sev[s] || 0}</b>
              <span>{SEVERITY[s].label}</span>
            </button>
          ))}
        </div>
      </div>

      {periods.map((p, i) => (
        <Card key={p} title={`${p} ${i === 0 ? '(this quarter, projected)' : '(next quarter, projected)'}`} sub="Actuals so far plus the forecast, against the same quarter last year. Ranges are approximate.">
          <div className="pi-outlook">
            {ORDER.map((m) => {
              const o = data.outlook.find((x) => x.metric === m && x.period === p)
              if (!o) return null
              const ch = isNum(o.last_year) && o.last_year ? (o.point / o.last_year - 1) * 100 : null
              const bad = ch !== null && (BAD_UP.has(m) ? ch > 3 : ch < -3)
              const good = ch !== null && (BAD_UP.has(m) ? ch < -3 : ch > 3)
              return (
                <div key={m} className="pi-ocard">
                  <span className="pi-olabel">{LABEL[m] || o.name}</span>
                  <b className="pi-oval">{value(o.point, o.unit)}</b>
                  <span className="pi-orange">
                    range {value(o.lower, o.unit)} – {value(o.upper, o.unit)}
                  </span>
                  {ch !== null && (
                    <span className={'pi-ochg ' + (bad ? 'bad' : good ? 'good' : '')}>
                      {pct(ch)} vs {p.replace(/^(\d{4})/, (y) => String(Number(y) - 1))}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      ))}

      <div className="pi-grid2">
        <Card title="What needs attention" sub="Ranked by business impact. Open a warning for the reason, the downstream impact and what to do." right={<button className="pi-link" onClick={() => go('warnings')}>All warnings →</button>}>
          {top.length ? (
            <ul className="pi-wlist">
              {top.map((w) => (
                <li key={w.id} onClick={() => go('warnings', { open: w.id })}>
                  <div className="pi-wrow">
                    <SeverityBadge s={w.severity} />
                    <span className="pi-kind">{KIND[w.kind]}</span>
                    {w.status === 'new' && <span className="pi-new">new</span>}
                  </div>
                  <b>{w.title}</b>
                  <p>{w.reason}</p>
                  <div className="pi-deps">{(w.departments || []).slice(0, 4).map((d) => <Dept key={d} name={d} small />)}</div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Nothing needs attention today.</Empty>
          )}
        </Card>
        <Card title="Departments" sub="Who owns the data and how many open warnings touch them." right={<button className="pi-link" onClick={() => go('catalog')}>Ownership →</button>}>
          <ul className="pi-deplist">
            {data.catalog.departments.map((d) => (
              <li key={d.name} onClick={() => go('warnings', { department: d.name })}>
                <Dept name={d.name} />
                <span className="pi-muted">
                  {d.tables.length} tables · {d.kpis} KPIs
                </span>
                <b className={d.warnings ? 'pi-hot' : ''}>{d.warnings} open</b>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}
