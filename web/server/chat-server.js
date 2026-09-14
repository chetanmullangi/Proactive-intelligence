// Local-only bridge between the "Ask the analyst" chat panel and a headless
// Claude Code invocation (`claude -p`). Runs entirely on this machine, bound
// to 127.0.0.1 only. Never exposes this to a network — it shells out to the
// `claude` CLI using your existing Claude Code login, and each question is a
// real (small) API call with a real, if small, cost.
//
// Security notes:
//  - The user's question is passed to `claude` as a single argv element via
//    execFile (no shell), so there is no shell-injection surface.
//  - `--restricted` strips tool access to anything that runs commands/code
//    plus WebFetch; `--disallowedTools` explicitly blocks the rest (file
//    edits, reads, search, subagents) so this is pure text Q&A grounded only
//    in the KPI context we hand it — it cannot touch the filesystem, run
//    code, or call other tools.

import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const PORT = process.env.CHAT_SERVER_PORT ? Number(process.env.CHAT_SERVER_PORT) : 8787
const MODEL = process.env.CHAT_SERVER_MODEL || 'claude-haiku-4-5-20251001'
const TIMEOUT_MS = 60_000

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let kpisCache = null
async function loadKpis() {
  if (kpisCache) return kpisCache
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'data', 'kpis.js')).href)
  kpisCache = mod
  return mod
}

const SYSTEM_RULES = `You are a business-facing analyst answering questions about healthcare claims KPIs, inside a chat panel in a web dashboard. You are talking to a claims manager or business stakeholder, not a data engineer or statistician.

The one rule that overrides everything else: your default answer is one to three plain, complete sentences a claims operations manager with no statistics or database background could read and immediately understand, with no follow-up question needed. Never use, in a default answer: z-score, r-squared, p-value, MAD, standard deviation, variance, regression, correlation coefficient, percentile, confidence interval as a number, SQL, table names, column names, or method/technique names. State real numbers in rounded, everyday terms ("about 500 a week", not "466.0").

You will be given the specific KPI's full record below, including both a plain-language layer (already written for a business reader) and a technical layer (the statistics and evidence behind it). Lead every answer from the plain layer. Only surface anything from the technical layer if the user's question explicitly asks how something was calculated, what the evidence/method was, or for the underlying statistics — and even then, preface it clearly as switching into technical detail.

If the question is about something not covered by the record below, say plainly that you don't have that specific information rather than guessing. Keep answers concise — a few sentences, not a report. Do not use any tools; answer directly and only from the context given.`

function buildPrompt({ kpi, allKpis, question, history }) {
  const historyText = (history || [])
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'Analyst'}: ${m.text}`)
    .join('\n')

  let context
  if (kpi) {
    context = `KPI record (JSON):\n${JSON.stringify(
      {
        name: kpi.name,
        domain: kpi.domain,
        unit: kpi.unit,
        current_value: kpi.value,
        plain_status: kpi.plainStatus,
        plain_reason: kpi.plainReason,
        plain_confidence: kpi.plainConfidence,
        technical_state: kpi.state,
        technical_why: kpi.why,
        technical_confidence: kpi.confidence,
        forecast: kpi.forecast,
        correlations: kpi.correlations,
        audit_status: kpi.auditStatus,
      },
      null,
      2
    )}`
  } else {
    context = `No single KPI is open right now — this is a portfolio-level question. Here is every tracked KPI's plain-language status:\n${JSON.stringify(
      (allKpis || []).map((k) => ({
        name: k.name,
        plain_status: k.plainStatus,
        plain_reason: k.plainReason,
      })),
      null,
      2
    )}`
  }

  return `${SYSTEM_RULES}\n\n${context}${
    historyText ? `\n\nRecent conversation:\n${historyText}` : ''
  }\n\nUser question: ${question}`
}

function askClaude(prompt) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      prompt,
      '--output-format',
      'json',
      '--restricted',
      '--disallowedTools',
      'Edit Write NotebookEdit Read Glob Grep Agent WebSearch WebFetch',
      '--model',
      MODEL,
    ]
    execFile(
      'claude',
      args,
      { timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(err.killed ? 'Request timed out.' : (stderr || err.message)))
          return
        }
        try {
          const parsed = JSON.parse(stdout)
          if (parsed.is_error || parsed.type === 'error') {
            reject(new Error(parsed.result || parsed.error || 'Claude returned an error.'))
            return
          }
          resolve({ reply: (parsed.result || '').trim(), costUsd: parsed.total_cost_usd })
        } catch {
          reject(new Error('Could not parse a response.'))
        }
      }
    )
  })
}

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'GET' && req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  if (req.method === 'POST' && req.url === '/api/ask') {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 20_000) req.destroy()
    })
    req.on('end', async () => {
      try {
        const { kpiId, question, history } = JSON.parse(body || '{}')
        if (!question || typeof question !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Missing question.' }))
          return
        }
        const { kpis } = await loadKpis()
        const kpi = kpiId ? kpis.find((k) => k.id === kpiId) : null
        const prompt = buildPrompt({ kpi, allKpis: kpis, question, history })
        const result = await askClaude(prompt)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch (e) {
        res.writeHead(502, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message || 'Something went wrong.' }))
      }
    })
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found.' }))
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Chat server listening on http://127.0.0.1:${PORT} (model: ${MODEL})`)
})
