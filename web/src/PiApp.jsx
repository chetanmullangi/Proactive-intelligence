import { useEffect, useState } from 'react'
import { useData } from './pi/data.js'
import Overview from './pi/pages/Overview.jsx'
import Warnings from './pi/pages/Warnings.jsx'
import Kpis from './pi/pages/Kpis.jsx'
import Impact from './pi/pages/Impact.jsx'
import Catalog from './pi/pages/Catalog.jsx'
import Health from './pi/pages/Health.jsx'
import Accuracy from './pi/pages/Accuracy.jsx'
import './pi/pi.css'

const PAGES = [
  { key: 'overview', label: 'Overview', icon: 'M3 12l9-8 9 8M5 10v10h14V10' },
  { key: 'warnings', label: 'Warnings', icon: 'M12 3 2.5 20h19zM12 9v5M12 17.5v.01' },
  { key: 'kpis', label: 'KPIs', icon: 'M4 19h16M7 16V9M12 16V5M17 16v-4' },
  { key: 'impact', label: 'Impact map', icon: 'M5 6h4v4H5zM15 4h4v4h-4zM15 15h4v4h-4zM9 8l6-2M9 8l6 9' },
  { key: 'catalog', label: 'Data & departments', icon: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6' },
  { key: 'health', label: 'Data health', icon: 'M3 12h4l3-7 4 14 3-7h4' },
  { key: 'accuracy', label: 'Accuracy', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z' },
]

function readHash() {
  const [page, q] = window.location.hash.replace(/^#\/?/, '').split('?')
  const params = Object.fromEntries(new URLSearchParams(q || ''))
  return { page: PAGES.some((p) => p.key === page) ? page : 'overview', params }
}

export default function PiApp() {
  const { loading, error, data } = useData()
  const [route, setRoute] = useState(readHash())
  useEffect(() => {
    const on = () => setRoute(readHash())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const go = (page, params = {}) => {
    const q = new URLSearchParams(params).toString()
    window.location.hash = `/${page}${q ? '?' + q : ''}`
    window.scrollTo(0, 0)
  }
  if (loading) return <div className="pi-loading">Loading the latest run…</div>
  if (error)
    return (
      <div className="pi-loading">
        Could not load the engine's data ({error}). Run <code>py -3.12 -m pi export</code> from the repository root.
      </div>
    )
  const open = data.warnings.filter((w) => w.status !== 'resolved' && ['critical', 'high'].includes(w.severity)).length
  const Page = { overview: Overview, warnings: Warnings, kpis: Kpis, impact: Impact, catalog: Catalog, health: Health, accuracy: Accuracy }[route.page]
  return (
    <div className="pi-shell">
      <nav className="pi-rail">
        <div className="pi-brand">
          <span className="pi-logo">◆</span>
          <div>
            <b>Proactive Intelligence</b>
            <span>{data.meta.database}</span>
          </div>
        </div>
        {PAGES.map((p) => (
          <button key={p.key} className={'pi-nav' + (route.page === p.key ? ' sel' : '')} onClick={() => go(p.key)}>
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d={p.icon} />
            </svg>
            <span>{p.label}</span>
            {p.key === 'warnings' && open > 0 && <em>{open}</em>}
          </button>
        ))}
        <div className="pi-railfoot">
          <span>Data as of {data.meta.as_of}</span>
          <span>Run {String(data.meta.generated_at).replace('T', ' ').slice(0, 16)} UTC</span>
        </div>
      </nav>
      <main className="pi-main">
        <Page key={route.page + JSON.stringify(route.params)} data={data} params={route.params} go={go} />
      </main>
    </div>
  )
}
