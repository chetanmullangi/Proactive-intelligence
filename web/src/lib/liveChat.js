// Talks to the local chat bridge server (web/server/chat-server.js), which
// shells out to a headless Claude Code invocation grounded in one KPI's or one
// risk pattern's record. Throws on failure so the caller can fall back to the
// offline answers.

const SERVER_URL = 'http://127.0.0.1:8787'

export async function askLive({ kpiId = null, riskId = null }, question, history) {
  const res = await fetch(`${SERVER_URL}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kpiId,
      riskId,
      question,
      history: (history || []).map((m) => ({ role: m.role === 'u' ? 'user' : 'analyst', text: m.text })),
    }),
    signal: AbortSignal.timeout(65_000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) throw new Error(data.error || `Server responded ${res.status}`)
  return data.reply
}
