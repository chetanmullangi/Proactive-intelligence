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
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 8 }}>
        Audit &amp; data-quality status
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--ink)' }}>
        {hasAudit ? kpi.auditStatus : 'No reconciliation or duplicate-rate check was run against this KPI’s table this pass.'}
      </div>

      {weakReasons.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '18px 0 8px' }}>
            Suggested follow-up
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7, color: 'var(--ink)' }}>
            {weakReasons.map((r, i) => (
              <li key={i}>{r.text} — no strong evidence found so far; worth a dedicated pass.</li>
            ))}
          </ul>
        </>
      )}

      <div style={{ marginTop: 18, fontSize: 12, color: 'var(--ink-3)' }}>
        This dashboard reports detection, attribution and forecasts — not a recommended fix. Remediation is a business call for the KPI's owning team.
      </div>
    </div>
  )
}
