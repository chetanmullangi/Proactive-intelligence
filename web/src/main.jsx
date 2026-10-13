import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './PiApp.jsx'   // the Proactive Intelligence app; the previous KPI Signal app is App.jsx
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
