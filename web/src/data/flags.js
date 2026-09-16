// Data-quality items worth a second look — pulled from real audit/reconciliation
// checks already computed by the pipeline (see each KPI's auditStatus in
// kpis.js), reframed in plain business language. These are not KPI anomalies
// or predictive risks — they're things about the underlying data itself that
// could affect the numbers built on top of it, so they're kept separate from
// both the KPI portfolio and the risk brief.

export const flags = [
  {
    id: 'duplicate-claims',
    title: 'Duplicate claims across the claims system',
    severity: 'Medium',
    reason:
      '444 of the last 99,271 claims (about 0.45%) appear to be exact duplicates. It\'s a small share, but it shows up consistently across claim volume, billed amount, allowed amount, paid amount, and the denial rate — meaning every one of those numbers could be very slightly inflated by the same duplicate records.',
    relatedKpiIds: ['header-count', 'header-billed', 'header-allowed', 'header-paid', 'denial-rate'],
  },
  {
    id: 'payment-reconciliation-mismatch',
    title: 'Claim-level and line-level payment totals don\'t always match',
    severity: 'High',
    reason:
      'For about 2.1% of claims (2,103 of 99,271), the total payment recorded for the whole claim doesn\'t match the sum of its individual line-item payments. On the single worst claim, that gap is over $108,000. Until this is reconciled, we can\'t be fully certain which figure — the claim total or the line total — is the accurate one for those claims.',
    relatedKpiIds: ['header-paid', 'line-paid'],
  },
  {
    id: 'cost-spike-unverified',
    title: 'A cluster of high-cost claims in the week of May 4 hasn\'t been traced to specific claims',
    severity: 'Medium',
    reason:
      'Billed, allowed, and paid amounts all spiked sharply in the same week while claim volume stayed normal — consistent with a handful of unusually expensive claims rather than a data error. That said, no one has pulled the individual claims behind the spike to confirm what actually happened, so this is an educated read, not a verified one.',
    relatedKpiIds: ['header-billed', 'header-allowed', 'header-paid'],
  },
  {
    id: 'stale-vs-fresh-data',
    title: 'Most of this dashboard is about 2 months older than the claims-payment numbers',
    severity: 'Medium',
    reason:
      'Claim volume, billed/allowed/paid amounts, denials, encounters, and pharmacy figures all reflect data through late June. The claims-payment numbers (Claim Payments Disbursed) are current through late August. Comparing "today\'s" payment decline against two-month-old claim volume could make the two look more — or less — connected than they really are, until the older data refreshes.',
    relatedKpiIds: ['payment-count', 'payment-amount'],
  },
]

export function flagById(id) {
  return flags.find((f) => f.id === id)
}
