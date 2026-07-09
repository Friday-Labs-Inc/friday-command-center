// ConfigCard — a Carbon Tile on --cds-layer with an optional status accent
// stripe. The single card primitive for the OS control panel.

import type { ReactNode, CSSProperties } from 'react'
import { Layer, Tile } from '@carbon/react'

export type CardStatus = 'ok' | 'warn' | 'err' | 'off'

const ACCENT: Record<CardStatus, string> = {
  ok: 'var(--cds-support-success)',
  warn: 'var(--cds-support-warning)',
  err: 'var(--cds-support-error)',
  off: 'var(--cds-border-subtle-02)',
}

interface ConfigCardProps {
  status?: CardStatus
  onClick?: () => void
  children: ReactNode
}

export function ConfigCard({ status, onClick, children }: ConfigCardProps) {
  const style = (status ? { ['--cc-accent']: ACCENT[status] } : undefined) as CSSProperties | undefined
  return (
    <Layer>
      <Tile
        className="cc-card"
        style={style}
        onClick={onClick}
        {...(onClick ? { role: 'button', tabIndex: 0 } : {})}
      >
        {children}
      </Tile>
    </Layer>
  )
}
