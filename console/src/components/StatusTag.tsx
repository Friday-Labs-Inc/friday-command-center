// StatusTag — maps domain status strings and severity levels to Carbon Tag types.
// Centralised here so every page uses the same colour vocabulary.
// Import: import { StatusTag } from '../components/StatusTag'

import { Tag } from '@carbon/react'

// The subset of Carbon Tag types used in this app.
type CarbonTagType =
  | 'green'
  | 'red'
  | 'blue'
  | 'cyan'
  | 'magenta'
  | 'gray'
  | 'warm-gray'
  | 'purple'

// ── Status → tag type mapping ─────────────────────────────────────────────────
// Rule: online/Active/Accepted/Approved → green; Warning/Draft/Pending → cyan or blue;
//       Error/Revoked/Rejected → red; Critical → magenta; Info → blue;
//       offline/unknown/Lifted → gray.

const STATUS_TYPE: Record<string, CarbonTagType> = {
  // Positive
  online: 'green',
  Online: 'green',
  active: 'green',
  Active: 'green',
  accepted: 'green',
  Accepted: 'green',
  approved: 'green',
  Approved: 'green',
  Enrolled: 'green',
  Completed: 'green',
  // Neutral / pending
  pending: 'cyan',
  Pending: 'cyan',
  draft: 'blue',
  Draft: 'blue',
  Warning: 'cyan',
  warning: 'cyan',
  Info: 'blue',
  info: 'blue',
  // Negative / revoked
  revoked: 'red',
  Revoked: 'red',
  rejected: 'red',
  Rejected: 'red',
  error: 'red',
  Error: 'red',
  Aborted: 'red',
  Suspended: 'red',
  // Critical
  critical: 'magenta',
  Critical: 'magenta',
  // Inactive / unknown
  offline: 'gray',
  Offline: 'gray',
  unknown: 'gray',
  Unknown: 'gray',
  lifted: 'gray',
  Lifted: 'gray',
  inactive: 'gray',
  Inactive: 'gray',
}

// Severity-specific mapping (for Security Events).
const SEVERITY_TYPE: Record<string, CarbonTagType> = {
  Critical: 'red',
  Error: 'magenta',
  Warning: 'cyan',
  Info: 'blue',
}

export interface StatusTagProps {
  /** The status or severity string to display */
  status: string
  /** When true, uses the severity colour palette (Critical/Error/Warning/Info) */
  severity?: boolean
  size?: 'sm' | 'md' | 'lg'
}

export function StatusTag({ status, severity = false, size = 'sm' }: StatusTagProps) {
  const map = severity ? SEVERITY_TYPE : STATUS_TYPE
  const type: CarbonTagType = (map[status] as CarbonTagType | undefined) ?? 'gray'
  return (
    <Tag type={type} size={size}>
      {status}
    </Tag>
  )
}
