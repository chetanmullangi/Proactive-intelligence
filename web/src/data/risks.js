// Proactive risk patterns from snowflake-risk-predictor, run incrementally
// against HEALTH_CARE (the same runs that populate HEALTH_CARE.ANALYTICS.RISK_SIGNALS).
// Sourced from reports/HEALTH_CARE/risk_manifest.json and
// reports/HEALTH_CARE/proactive_risk_brief.md. Nothing here is invented — a
// field the run didn't produce is simply absent.
//
// This file is business-facing only. No model metrics, table/column names,
// or statistical vocabulary — that layer lives in the Snowflake tables and
// reports/ for the data team, not in this app.
//
// Exposure is an estimate of what may be affected if a pattern continues,
// never money already lost.

export const riskRunAt = '2026-09-16T04:10:59.871Z'
// Second run (incremental #2). denial_risk/payment_delay_risk/pharmacy_reject_risk
// re-verified as unchanged (byte-identical flagged sets/exposure vs. the first run).
// Added coverage_lapse_risk, discovered while investigating the enrollment domain
// FACT_PREMIUM/FACT_MEMBER_MONTH sit in — see its lowConfidenceCaveat: the segment-level
// pattern is real, but there is no trustworthy per-member score behind it yet.
export const recheckDate = '2026-10-14'

export const impactMeta = {
  High: { fg: 'var(--anomaly-fg)', mark: 'var(--anomaly-mark)', bg: 'var(--anomaly-bg)', bd: 'var(--anomaly-bd)', label: 'High impact', rank: 0 },
  Medium: { fg: 'var(--watch-fg)', mark: 'var(--watch-mark)', bg: 'var(--watch-bg)', bd: 'var(--watch-bd)', label: 'Medium impact', rank: 1 },
  Low: { fg: 'var(--stable-fg)', mark: 'var(--stable-mark)', bg: 'var(--stable-bg)', bd: 'var(--stable-bd)', label: 'Low impact', rank: 2 },
}

export const risks = [
  {
    id: 'denial_risk',
    targetLabel: 'Denial risk',
    relatedKpiIds: ['denial-rate'],
    headline: 'Corrected claims are being denied a second time before they get paid',
    impact: 'High',
    whatsHappening:
      'When a claim that was already sent back once for correction gets resubmitted, it is being denied again far more often than a normal claim — 55% of the time, versus roughly 10% for claims overall. 33 claims sitting in the queue right now fit this pattern, mostly from specialist, lab, and imaging providers.',
    whatThisMeans:
      'A "resubmitted claim" is one that has already been sent back once to fix a problem and is now going through the process again. A "denial" means the insurer refused to pay the claim — often because required information was missing, the patient wasn\'t eligible, or a billing code was wrong; the specific reason on file for that is called the "denial reason." "Exposure" below is the dollar value tied to the claims we\'ve flagged as being at risk of this happening — not money that has already been lost.',
    whyItsHappening:
      'The pattern points to claims going back out for resubmission without the original denial reason actually being fixed — the same mistake is going back out as-is. It concentrates among specialist, laboratory, and imaging providers, who most likely need clearer guidance on what to correct before resubmitting.',
    exposureUsd: 57714,
    costNote: 'This is the submitted-charge value of the 33 flagged claims — an estimate of what\'s at risk if the pattern continues, not confirmed lost revenue.',
    affectedCount: 33,
    affectedUnit: 'claims',
    affectedDescription: 'concentrated among specialist, laboratory, and imaging providers',
    actions: [
      { action: 'Pull all 33 flagged claims into a manual pre-resubmission review before they go back out', role: 'Claims quality lead', byWhen: 'by Sep 19 (this week)', where: 'Resubmission review queue' },
      { action: 'Confirm the original denial reason was actually corrected on each claim before it is resubmitted', role: 'Claims examiners on specialist/lab/imaging accounts', byWhen: 'before each claim goes back out', where: 'Claim record, denial-reason field' },
      { action: 'Send providers a short reminder on the most common denial reasons and how to fix them before resubmitting', role: 'Provider relations', byWhen: 'by Sep 29', where: 'Provider portal bulletin' },
    ],
    target: { goal: 'Second-denial rate on resubmitted claims down from 55% to under 25%', recheckDate: '2026-10-14' },
    confidenceLine: 'Confidence: High — based on 15,000 past claims, and this pattern held up consistently across every check we ran.',
  },
  {
    id: 'payment_delay_risk',
    targetLabel: 'Payment-delay risk',
    relatedKpiIds: ['payment-amount', 'payment-count'],
    headline: 'Corrected claims are taking much longer to get paid than new claims',
    impact: 'Medium',
    whatsHappening:
      'Claims that are corrected and resubmitted are taking substantially longer to get paid than first-time claims — about 34% of them are at risk of a slow payment, compared to about 11% of claims overall. 45 claims right now fit this pattern, concentrated among imaging and diagnostic-imaging providers.',
    whatThisMeans:
      'A "corrected claim" (sometimes called a "replacement claim") is a fixed version of a claim already submitted — for example, correcting a wrong billing code or adding a missing detail. "Claims at risk" here means claims we expect, based on how similar claims have behaved, to take longer than 44 days to pay — not claims already confirmed to be late.',
    whyItsHappening:
      'Corrected claims appear to be re-entering the same full review process as a brand-new claim, instead of a faster path built specifically for corrections — which adds the extra time. It concentrates among imaging and diagnostic-imaging providers.',
    exposureUsd: 110739,
    costNote: 'This is the submitted-charge value tied to the 45 claims expected to be slow — dollars sitting in a longer payment cycle, not money that has been lost.',
    affectedCount: 45,
    affectedUnit: 'claims',
    affectedDescription: 'concentrated among imaging and diagnostic-imaging providers',
    actions: [
      { action: 'Stand up a dedicated fast-track queue for corrected claims, separate from new-claim intake', role: 'Claims operations manager', byWhen: 'by Oct 6', where: 'Claims workflow / routing configuration' },
      { action: 'Audit the 45 flagged claims, prioritizing imaging and diagnostic-imaging providers, to confirm none are stuck in the standard queue', role: 'Claims operations team', byWhen: 'by Sep 19 (this week)', where: 'Claims queue dashboard' },
    ],
    target: { goal: 'Corrected claims paid within 44 days at the same rate as first-time claims (currently an 11% risk rate)', recheckDate: '2026-10-14' },
    confidenceLine: 'Confidence: Medium — the overall pattern is less precise than the denial-risk finding above, but the concentration among corrected claims from imaging providers is a strong, repeatable signal.',
  },
  {
    id: 'pharmacy_reject_risk',
    targetLabel: 'Pharmacy rejection risk',
    relatedKpiIds: ['pharmacy-count', 'pharmacy-paid'],
    headline: 'Two medication types are being rejected at the pharmacy more than usual',
    impact: 'Low',
    whatsHappening:
      'Prescriptions for diuretics (blood-pressure and fluid medications) and SNRIs (a class of antidepressants) are being rejected at the pharmacy counter at roughly 2.7 times the normal rate. Over the last 60 days, 118 prescriptions across these two drug types were flagged.',
    whatThisMeans:
      '"Prescriptions at risk" means fills we expect, based on recent patterns, to be rejected at the pharmacy counter — not prescriptions confirmed rejected. A "rejection" means the pharmacy could not fill the prescription as submitted, usually due to a coverage or authorization issue.',
    whyItsHappening:
      'The likely cause is a recent change to which drugs are covered (the formulary) or a new prior-authorization requirement affecting these two drug classes specifically. The dollar impact is small, but each rejection means a member leaves the pharmacy without their medication that day.',
    exposureUsd: 2724,
    costNote: 'Small in dollar terms by design — the real cost here is member experience, not revenue. Treat this figure as a rough estimate, not a precise loss.',
    affectedCount: 118,
    affectedUnit: 'prescriptions',
    affectedDescription: 'across the two drug classes, out of the last 60 days of pharmacy fills',
    actions: [
      { action: 'Check whether a formulary or prior-authorization change was made recently for diuretics or SNRIs', role: 'Pharmacy benefits manager', byWhen: 'by Sep 29', where: 'Formulary change log' },
      { action: 'If a change is found, confirm members and prescribers were notified in advance', role: 'Pharmacy benefits manager', byWhen: 'by Sep 29', where: 'Member/provider communications record' },
    ],
    target: { goal: 'Rejection rate on diuretics and SNRIs back down to the normal baseline', recheckDate: '2026-10-14' },
    confidenceLine: 'Confidence: Low — this is an early, thin signal worth watching, not yet a confirmed pattern.',
  },
  {
    id: 'coverage_lapse_risk',
    targetLabel: 'Coverage-lapse risk',
    relatedKpiIds: ['eligibility-records'],
    headline: 'Individual-market members and a cluster of employer groups are lapsing coverage at well above the average rate',
    impact: 'Medium',
    whatsHappening:
      'Members enrolled through the individual market — people who bought coverage on their own rather than through an employer — stop renewing their coverage at roughly one-and-a-half times the rate of the overall member population (about 10% versus 7%). A smaller cluster of 6 specific employer groups shows an even sharper pattern: members in those groups lapse coverage at nearly double the average rate. This is a real, repeatable pattern found directly in several years of enrollment history, and it shows up again independently when looking at which currently-enrolled members carry the same risk characteristics.',
    whatThisMeans:
      '"Lapsing coverage" means a member\'s coverage segment ends without a follow-on segment picking up right after — a real disenrollment, not a renewal or plan change. "Exposure" below is the annualized premium tied to currently-active members in the flagged segments — not premium already lost.',
    whyItsHappening:
      'No single confirmed cause yet — this needs a closer look with better data (payment history, member engagement/contact signals) before a specific driver can be pinned down. Renewal outreach, pricing, and service experience for the individual-market book and these 6 groups are the places to check first.',
    exposureUsd: 3790000,
    costNote: 'This is the annualized premium tied to the 361 currently-active members in the flagged segments (250 individual-market, 111 across the 6 flagged groups) — an estimate of what\'s at risk if the pattern continues, not premium already lost.',
    affectedCount: 361,
    affectedUnit: 'members',
    affectedDescription: 'currently-active members across the individual-market segment and 6 employer groups',
    lowConfidenceCaveat:
      'Unlike the other findings in this brief, we could not build a reliable score that ranks individual members by risk — the underlying pattern is real at the segment level (the individual-market book, these 6 groups), but a model that tries to say "this specific person is at risk" is not trustworthy yet. Treat this as "these segments deserve a closer look," not a precise list of who will leave.',
    actions: [
      { action: 'Review renewal outreach, pricing, and service experience for the individual-market book specifically', role: 'Member retention / renewals lead', byWhen: 'by Sep 29', where: 'Individual-market renewal process' },
      { action: 'Review the same for the 6 flagged employer groups (GRP00069, GRP00073, GRP00075, GRP00084, GRP00042, GRP00102)', role: 'Group account managers for those 6 groups', byWhen: 'by Sep 29', where: 'Employer group account records' },
      { action: 'Gather better data (payment history, member engagement/contact signals) before attempting a per-member action list', role: 'Data/analytics team', byWhen: 'ongoing', where: 'Member engagement data sources' },
    ],
    target: { goal: 'Individual-market and flagged-group lapse rate down toward the overall population average (about 7%)', recheckDate: '2026-10-14' },
    confidenceLine: 'Confidence: Low — the segment-level pattern is real and corroborated two independent ways, but there is no reliable per-member list behind it yet, so this is the least certain finding in this brief despite being the largest by dollar exposure.',
  },
]

export const skippedRisks = [
  {
    label: '30-day readmissions',
    plainReason: 'There are too few past readmissions in this data to predict them reliably yet. Worth revisiting as more history builds up.',
  },
  {
    label: 'Underpayment against contracted rates',
    plainReason: 'This data doesn’t include the contracted rate for each procedure, so there’s nothing to compare a payment against to tell whether a payer paid less than agreed.',
  },
]

export function riskById(id) {
  return risks.find((r) => r.id === id)
}

export function formatUsd(n) {
  if (n >= 1000) return `$${Math.round(n / 1000).toLocaleString()}K`
  return `$${Math.round(n).toLocaleString()}`
}
