// Offline fallback for risk-grounded chat, used only when the live analyst
// server isn't reachable. Built solely from the risk's plain-language fields.
import { formatUsd } from '../data/risks.js'

export function riskSuggestions() {
  return ['What should we check first?', 'How sure are we about this?', 'How much money is at stake?', 'Why this group of claims?']
}

export function riskIntro(risk) {
  return `I have the full record for “${risk.headline}” loaded — who’s affected, the estimated exposure, and what’s driving it. Ask me anything about it.`
}

export function answerRisk(risk, question) {
  const t = question.toLowerCase()
  const exposure = `About ${formatUsd(risk.exposureUsd)} across ${risk.affectedCount} ${risk.affectedUnit} may be affected if the pattern continues — that’s an estimate of what’s at risk, not money already lost. ${risk.costNote || ''}`
  if (t.includes('check') || t.includes('first') || t.includes('do ') || t.includes('action') || t.includes('fix')) {
    return risk.actions.map((a) => `${a.action} (${a.role}, ${a.byWhen})`).join(' Then: ')
  }
  if (t.includes('money') || t.includes('stake') || t.includes('exposure') || t.includes('cost') || t.includes('$')) return exposure
  if (t.includes('sure') || t.includes('confiden') || t.includes('trust')) {
    return risk.confidenceLine || `This comes from a model trained on past claims, so it’s a signal of likely trouble rather than a certainty.`
  }
  if (t.includes('mean') || t.includes('what is') || t.includes("what's")) return risk.whatThisMeans
  return `${risk.whatsHappening} ${risk.whyItsHappening}`
}
