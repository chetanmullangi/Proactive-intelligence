import { impactMeta, formatUsd } from '../data/risks.js'
import { kpiById } from '../data/kpis.js'

const label = { fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }
const body = { margin: 0, fontSize: 14, lineHeight: 1.65, color: 'var(--ink)' }

const icon = (d) => ({ size = 15, color = 'currentColor' } = {}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
)

const IconPulse = icon(<path d="M3 12h4l2.5 7L14 5l2.5 7H21" />)
const IconSearch = icon(<><circle cx="10.5" cy="10.5" r="6.5" /><path d="M20 20l-4.3-4.3" /></>)
const IconDollar = icon(<><circle cx="12" cy="12" r="9" /><path d="M12 7v10M15 9.5c0-1.4-1.3-2.5-3-2.5s-3 1-3 2.3c0 3 6 1.6 6 4.5 0 1.4-1.4 2.4-3 2.4s-3-1-3-2.4" /></>)
const IconCheck = icon(<><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.3 2.3L16 9.5" /></>)
const IconTarget = icon(<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="0.6" fill="currentColor" /></>)

function SectionHeading({ Icon, tone, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <span style={{ display: 'flex', color: tone || 'var(--ink-3)' }}><Icon /></span>
      <span style={label}>{children}</span>
    </div>
  )
}

export default function RiskCard({ risk, rank, selected, onAsk, onOpenKpi }) {
  const meta = impactMeta[risk.impact]
  const relatedKpis = (risk.relatedKpiIds || []).map(kpiById).filter(Boolean)

  return (
    <article
      id={`risk-card-${risk.id}`}
      style={{
        borderRadius: 14, background: '#fff', padding: '22px 24px 24px',
        border: `1px solid ${selected ? 'var(--pri)' : 'var(--line)'}`,
        borderLeft: `4px solid ${meta.mark}`,
        boxShadow: selected ? '0 0 0 3px var(--pri-soft)' : 'none',
        display: 'flex', flexDirection: 'column', gap: 18, scrollMarginTop: 16,
      }}
    >
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)' }}>{String(rank).padStart(2, '0')}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, borderRadius: 999, padding: '4px 10px', color: meta.fg, background: meta.bg }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: meta.mark }} />{meta.label}
          </span>
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{risk.targetLabel}</span>
          {risk.confidenceLine && (
            <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--ink-3)', marginLeft: 'auto' }}>{risk.confidenceLine.split(' — ')[0]}</span>
          )}
        </div>
        <h2 style={{ margin: 0, fontSize: 22, lineHeight: 1.3, letterSpacing: '-0.02em', fontWeight: 600 }}>{risk.headline}</h2>
      </div>

      {risk.lowConfidenceCaveat && (
        <div style={{ display: 'flex', gap: 10, background: 'var(--watch-bg)', border: '1px solid var(--watch-bd)', borderRadius: 12, padding: '12px 15px' }}>
          <span style={{ flexShrink: 0, fontSize: 13, fontWeight: 700, color: 'var(--watch-fg)' }}>!</span>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--watch-fg)' }}>{risk.lowConfidenceCaveat}</p>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 20, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <SectionHeading Icon={IconPulse}>What's happening</SectionHeading>
            <p style={body}>{risk.whatsHappening}</p>
          </div>
          <div style={{ display: 'flex', gap: 10, background: 'var(--rail-bg)', border: '1px solid var(--line)', borderRadius: 12, padding: '13px 15px' }}>
            <span style={{ flexShrink: 0, display: 'flex', color: meta.fg, marginTop: 2 }}><IconSearch /></span>
            <div>
              <div style={{ ...label, marginBottom: 4 }}>Why</div>
              <p style={{ ...body, fontSize: 13.5 }}>{risk.whyItsHappening}</p>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ background: 'var(--rail-bg)', border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px' }}>
              <SectionHeading Icon={IconDollar}>Exposure</SectionHeading>
              <div className="mono" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 6 }}>{formatUsd(risk.exposureUsd)}</div>
            </div>
            <div style={{ background: 'var(--rail-bg)', border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px' }}>
              <div style={label}>Affected</div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 6 }}>{risk.affectedCount}</div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{risk.affectedUnit}</div>
            </div>
          </div>
          <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)' }}>{risk.affectedDescription}. {risk.costNote}</p>
        </div>
      </div>

      <div>
        <SectionHeading Icon={IconCheck} tone={meta.fg}>What to do</SectionHeading>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 10, marginTop: 10 }}>
          {risk.actions.map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px' }}>
              <span
                className="mono"
                style={{
                  flexShrink: 0, width: 20, height: 20, borderRadius: '50%', background: meta.bg, color: meta.fg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700,
                }}
              >
                {i + 1}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.4, color: 'var(--ink)' }}>{a.action}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 5, lineHeight: 1.5 }}>
                  {a.role} · {a.byWhen}<br />{a.where}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f6f6ff', border: '1px solid #dedefb', borderRadius: 12, padding: '12px 16px', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', color: 'var(--pri)' }}><IconTarget /></span>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--ink)' }}>
          <strong>Goal:</strong> {risk.target.goal}
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--pri)', fontWeight: 600, whiteSpace: 'nowrap' }}>Re-check {risk.target.recheckDate}</span>
      </div>

      {relatedKpis.length > 0 && (
        <div>
          <div style={label}>Related KPI{relatedKpis.length > 1 ? 's' : ''}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {relatedKpis.map((k) => (
              <button
                key={k.id}
                onClick={() => onOpenKpi(k.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--line)', borderRadius: 999, background: '#fff', color: 'var(--ink-2)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 500, padding: '6px 12px', cursor: 'pointer' }}
              >
                {k.name} <span style={{ color: 'var(--ink-3)' }}>↗</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <button className="btn-outline" onClick={() => onAsk(risk.id)}>Ask the analyst about this risk</button>
      </div>
    </article>
  )
}
