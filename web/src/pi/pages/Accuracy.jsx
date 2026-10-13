import { Card } from '../ui.jsx'
import { Bars } from '../Chart.jsx'

export default function Accuracy({ data }) {
  const f = data.accuracy.forecasts.slice().sort((a, b) => (b.skill_vs_naive ?? -1) - (a.skill_vs_naive ?? -1))
  const ob = data.accuracy.order_book
  const latest = {}
  for (const r of ob) latest[r.chain] = r
  const beat = f.filter((x) => (x.skill_vs_naive ?? 0) > 0.02).length
  return (
    <div className="pi-page">
      <h1>How much to trust it</h1>
      <p className="pi-sub">Every forecast and projection is tested against what actually happened before it is shown.</p>
      <Card title={`Forecasts: ${beat} of ${f.length} beat repeating the last value`} sub="Out-of-sample backtest over the last 26 periods. Where a forecast does not beat the naive guess, the app treats it as 'about the current level'.">
        <Bars
          rows={f.map((x) => ({
            k: x.name || x.id,
            v: x.skill_vs_naive ?? 0,
            label: `${x.skill_vs_naive != null ? Math.round(x.skill_vs_naive * 100) + '%' : '—'} · ${x.method.replace('_', ' ')}`,
          }))}
          height={10}
        />
      </Card>
      <Card title="Pipeline projections, checked four weeks later" sub="What the engine would have projected four weeks ago from the open items at that time, against what actually arrived. Projections off by more than 35% are not used for warnings.">
        <table className="pi-table">
          <thead>
            <tr>
              <th>Process</th>
              <th>Projected 4 weeks ago</th>
              <th>Actually arrived</th>
              <th>Error</th>
              <th>Next 4 weeks</th>
            </tr>
          </thead>
          <tbody>
            {Object.values(latest).map((r) => {
              const p = data.process.find((x) => x.id === r.chain)
              return (
                <tr key={r.chain}>
                  <td>
                    {p ? `${p.parent} → ${p.parent === p.child ? 'corrected claim' : p.child}${p.segment ? ' (' + p.segment.split('=')[1].toLowerCase() + ')' : ''}` : r.chain}
                  </td>
                  <td>{r.projected_4_weeks_ago}</td>
                  <td>{r.actually_arrived}</td>
                  <td className={r.error_pct != null && Math.abs(r.error_pct) > 35 ? 'pi-bad' : ''}>{r.error_pct != null ? r.error_pct + '%' : '—'}</td>
                  <td>{r.next_4_weeks}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
