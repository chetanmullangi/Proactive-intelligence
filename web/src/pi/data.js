import { useEffect, useState } from 'react'

const FILES = ['meta', 'warnings', 'outlook', 'kpis', 'catalog', 'graph', 'process', 'data_health', 'accuracy']

// Everything the engine exports (python -m pi export -> web/public/data/*.json), loaded once per page view.
export function useData() {
  const [state, setState] = useState({ loading: true, error: null, data: null })
  useEffect(() => {
    let alive = true
    Promise.all(
      FILES.map((f) =>
        fetch(`/data/${f}.json?ts=${Date.now()}`).then((r) => {
          if (!r.ok) throw new Error(`${f}.json: ${r.status}`)
          return r.json()
        }),
      ),
    )
      .then((parts) => {
        if (!alive) return
        const data = Object.fromEntries(FILES.map((f, i) => [f, parts[i]]))
        data.kpiById = Object.fromEntries(data.kpis.map((k) => [k.id, k]))
        data.tableById = Object.fromEntries(data.catalog.tables.map((t) => [t.fqn, t]))
        setState({ loading: false, error: null, data })
      })
      .catch((e) => alive && setState({ loading: false, error: String(e), data: null }))
    return () => {
      alive = false
    }
  }, [])
  return state
}
