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
      'For about 2.1% of claims (2,103 of 99,271), the total payment recorded for the whole claim doesn\'t match the sum of its individual line-item payments. On the single worst claim, that gap is over $108,000. The share of mismatched claims has held steady since 2020, so this is a long-standing gap, not a new one. Until it is reconciled, we can\'t be fully certain which figure — the claim total or the line total — is the accurate one for those claims.',
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
    id: 'claims-feed-stopped',
    title: 'No claims for visits after 30 June have arrived — and that is what is driving the payment drop',
    severity: 'High',
    reason:
      'The newest claim in the data is for a visit on 30 June. Pharmacy data stops on 3 July, and premium, member-month and enrollment data stop in June. Payment data runs to the 1 September payment run, but every payment made since July has been for a visit on or before 30 June. So the weekly payment runs are working through the last claims that came in, and fewer are left each week (1,131 payments in July, 556 in August, 58 in the 1 September run). The loading log shows the last successful load on 4 September, even though loads are scheduled daily. Until new claims arrive, payments will keep falling and most of this dashboard will keep showing June.',
    relatedKpiIds: ['payment-count', 'payment-amount', 'header-count', 'header-paid', 'pharmacy-count', 'eligibility-records'],
  },
  {
    id: 'future-submission-dates',
    title: '97 claims are dated as submitted in the future',
    severity: 'Medium',
    reason:
      '97 claims (about 0.1% of 99,271) have a submission date after today, from 27 September 2026 to as late as April 2027. A claim can\'t be submitted before it happens in real time, so these dates are wrong at the source. None of the dashboard measures count claims by submission date, so the numbers here aren\'t affected. But anything that relies on when a claim was submitted, such as how long claims take to be paid or the proactive risk models, should exclude or correct these first.',
    relatedKpiIds: ['header-count', 'denial-rate'],
  },
]

export function flagById(id) {
  return flags.find((f) => f.id === id)
}
