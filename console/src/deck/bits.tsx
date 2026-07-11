// Small shared deck components — panel chrome, view headers, badges.

import type { ReactNode } from 'react'

export function Panel({ title, meta, children, style, className }: {
  title: string
  meta?: ReactNode
  children: ReactNode
  style?: React.CSSProperties
  className?: string
}) {
  return (
    <div className={`dk-panel ${className ?? ''}`} style={style}>
      <div className="dk-panelhead">
        <span className="t">{title}</span>
        {meta && <span className="m">{meta}</span>}
      </div>
      {children}
    </div>
  )
}

export function ViewHead({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: ReactNode }) {
  return (
    <div className="dk-viewhead">
      <div className="eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}

/** Honest-UI marker for any data not yet fed by real rover hardware. */
export function SimBadge({ label = 'SIMULATED FEED' }: { label?: string }) {
  return <span className="dk-sim">{label}</span>
}

export function Legend({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="dk-legend">
      {items.map(([color, label]) => (
        <span key={label}>
          <i style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  )
}
