// Replaces the original design's "Recommended action" (pros/cons). Our
// pipeline deliberately doesn't prescribe remediation — it stops at
// detection, attribution and audit. This panel shows what we actually have:
// audit/reconciliation status, and an honest "worth checking next" line
// pulled from the attribution text where one exists.
export default function FollowUpPanel({ kpi }) {
  const hasAudit = kpi.auditStatus && kpi.auditStatus !== 'n/a'
  const weakReasons = kpi.reasons.filter((r) => r.strength === 'weak')

  return (
    <div>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted-2)', marginBottom: 10 }}>
        Audit &amp; data-quality status
      </div>
      <div style={{ fontSize: 15, lineHeight: 1.55, color: 'var(--ink-soft)', maxWidth: '60ch' }}>
        {hasAudit ? kpi.auditStatus : 'No reconciliation or duplicate-rate check was run against this KPI’s table this pass.'}
      </div>

      {weakReasons.length > 0 && (
        <>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted-2)', margin: '24px 0 10px' }}>
            Worth investigating further
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7, color: 'var(--ink-soft)' }}>
            {weakReasons.map((r, i) => (
              <li key={i}>{r.text} — no strong evidence found in what's been discovered so far; would need a fresh investigation.</li>
            ))}
          </ul>
        </>
      )}

      <div style={{ marginTop: 24, fontSize: 12, color: 'var(--muted)', maxWidth: '60ch' }}>
        This dashboard reports detection, attribution, and forecasts — not a recommended fix. Remediation is a business call that belongs to the KPI's owning team.
      </div>
    </div>
  )
}
