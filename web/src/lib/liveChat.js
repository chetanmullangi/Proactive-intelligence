// Talks to the local chat bridge server (web/server/chat-server.js), which
// shells out to a headless Claude Code invocation grounded in the KPI's
// record. Falls back to the offline canned engine (chatEngine.js) in App.jsx
// if the server isn't running — this module just throws on failure so the
// caller can decide what to do.

const SERVER_URL = 'http://127.0.0.1:8787'

export async function askLive(kpi, question, history) {
  const res = await fetch(`${SERVER_URL}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kpiId: kpi ? kpi.id : null,
      question,
      history: (history || []).map((m) => ({ role: m.role === 'u' ? 'user' : 'analyst', text: m.text })),
    }),
    signal: AbortSignal.timeout(65_000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) throw new Error(data.error || `Server responded ${res.status}`)
  return data.reply
}
