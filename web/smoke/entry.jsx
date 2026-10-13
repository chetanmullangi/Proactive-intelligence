import fs from 'fs'
import React from 'react'
import { renderToString } from 'react-dom/server'
import Overview from '../src/pi/pages/Overview.jsx'
import Warnings from '../src/pi/pages/Warnings.jsx'
import Kpis from '../src/pi/pages/Kpis.jsx'
import Impact from '../src/pi/pages/Impact.jsx'
import Catalog from '../src/pi/pages/Catalog.jsx'
import Health from '../src/pi/pages/Health.jsx'
import Accuracy from '../src/pi/pages/Accuracy.jsx'
const FILES = ['meta', 'warnings', 'outlook', 'kpis', 'catalog', 'graph', 'process', 'data_health', 'accuracy']
const data = Object.fromEntries(FILES.map((f) => [f, JSON.parse(fs.readFileSync(`public/data/${f}.json`, 'utf8'))]))
data.kpiById = Object.fromEntries(data.kpis.map((k) => [k.id, k]))
data.tableById = Object.fromEntries(data.catalog.tables.map((t) => [t.fqn, t]))
const go = () => {}
const firstWarn = data.warnings[0]?.id
for (const [name, C, params] of [['overview', Overview, {}], ['warnings', Warnings, { open: firstWarn }], ['kpis', Kpis, {}], ['impact', Impact, {}], ['catalog', Catalog, {}], ['health', Health, {}], ['accuracy', Accuracy, {}]]) {
  try {
    const html = renderToString(React.createElement(C, { data, params, go }))
    console.log(name, 'ok', html.length, 'chars')
  } catch (e) {
    console.log(name, 'FAILED', e.stack.split('\n').slice(0, 4).join(' | '))
  }
}
