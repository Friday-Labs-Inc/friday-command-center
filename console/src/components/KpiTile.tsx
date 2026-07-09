// KpiTile — a metric summary tile for dashboards.
// Wraps Carbon <Tile> in <Layer> so it renders on layer-01.
// Import: import { KpiTile } from '../components/KpiTile'

import type { FC, ReactNode } from 'react'
import { Layer, Tile } from '@carbon/react'

export interface KpiTileProps {
  /** Short label above the value (e.g. "Active rovers") */
  label: string
  /** Primary display value (e.g. 4 or "12 / 20") */
  value: string | number
  /** Optional icon component from @carbon/icons-react */
  icon?: FC<{ size?: number; className?: string }>
  /** Optional trend / badge / sub-value rendered below the value */
  trend?: ReactNode
}

export function KpiTile({ label, value, icon: Icon, trend }: KpiTileProps) {
  return (
    <Layer>
      <Tile className="cc-kpi-tile">
        <div className="cc-kpi-inner">
          {Icon && (
            <Icon size={20} className="cc-kpi-icon" />
          )}
          <p className="cc-kpi-label">{label}</p>
          <p className="cc-kpi-value">{value}</p>
          {trend != null && (
            <div className="cc-kpi-trend">{trend}</div>
          )}
        </div>
      </Tile>
    </Layer>
  )
}
