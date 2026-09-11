import { useEffect, useState } from 'react'

// Per-viewer persistence only — this lives in the browser's localStorage, not
// shared across devices or synced anywhere. That's the right fit here: it's
// "keep my place when I close and reopen this tab," not shared app state.
const PREFIX = 'kpisignal.'

export function usePersisted(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(PREFIX + key)
      return raw != null ? JSON.parse(raw) : initial
    } catch {
      return initial
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value))
    } catch {
      // private browsing / storage disabled / quota exceeded — fail silently,
      // the app still works, it just won't remember state this session
    }
  }, [key, value])

  return [value, setValue]
}
