// Settings — read-only view of Command Center protocol and broker configuration.
// Fetches settings() singleton from the control-plane gateway and presents
// fields grouped by concern. No mutation endpoint exists; the InlineNotification
// makes the read-only nature explicit.

import {
  Column,
  Grid,
  InlineNotification,
  Layer,
  StructuredListBody,
  StructuredListCell,
  StructuredListRow,
  StructuredListWrapper,
  Tile,
} from '@carbon/react'
import { Wifi } from '@carbon/icons-react'

import * as api from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { useLiveStore } from '../lib/store'
import { PageHeader } from '../components/PageHeader'
import { StatusTag } from '../components/StatusTag'

// ── Field metadata ────────────────────────────────────────────────────────────

interface FieldDef {
  key: keyof api.Settings
  label: string
  unit: string
  /** Render value in a monospaced face (hostnames, ports). */
  mono?: boolean
}

const GROUPS: Array<{ heading: string; fields: FieldDef[] }> = [
  {
    heading: 'Protocol',
    fields: [
      { key: 'protocol_major', label: 'Protocol version', unit: 'major revision' },
    ],
  },
  {
    heading: 'Message broker',
    fields: [
      { key: 'broker_host', label: 'Broker host', unit: 'hostname', mono: true },
      { key: 'broker_port', label: 'Broker port', unit: 'TCP port', mono: true },
    ],
  },
  {
    heading: 'Timing',
    fields: [
      { key: 'command_expiry_s',          label: 'Command expiry',         unit: 's' },
      { key: 'clock_skew_tolerance_s',    label: 'Clock skew tolerance',   unit: 's' },
      { key: 'default_authority_lease_s', label: 'Authority lease',        unit: 's' },
    ],
  },
]

// ── FieldRow ──────────────────────────────────────────────────────────────────

interface FieldRowProps {
  field: FieldDef
  data: api.Settings | null
  loading: boolean
}

function FieldRow({ field, data, loading }: FieldRowProps) {
  const placeholder = loading || data === null
  const value = placeholder ? '—' : String(data[field.key])

  return (
    <StructuredListRow>
      <StructuredListCell noWrap>
        <span className="st-label">{field.label}</span>
      </StructuredListCell>
      <StructuredListCell>
        <span
          className={placeholder ? 'st-value-ph' : 'st-value'}
          style={
            field.mono
              ? { fontFamily: '"IBM Plex Mono", "Courier New", monospace', fontSize: '0.8125rem' }
              : undefined
          }
        >
          {value}
        </span>
      </StructuredListCell>
      <StructuredListCell noWrap>
        <span className="st-unit">{field.unit}</span>
      </StructuredListCell>
    </StructuredListRow>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function Settings() {
  const { data, loading, error } = useAsync(() => api.settings(), [])
  const live = useLiveStore()

  const gatewayOrigin = typeof window !== 'undefined' ? window.location.origin : '—'

  return (
    <div className="cc-page">
      <style>{`
        .st-label {
          color: var(--cds-text-secondary);
          font-size: 0.875rem;
        }
        .st-value {
          color: var(--cds-text-primary);
          font-variant-numeric: tabular-nums;
        }
        .st-value-ph {
          color: var(--cds-text-placeholder);
        }
        .st-unit {
          color: var(--cds-text-secondary);
          font-size: 0.75rem;
          letter-spacing: 0.02em;
        }
        .st-group {
          margin-bottom: var(--cds-spacing-06);
        }
        .st-group:last-child {
          margin-bottom: 0;
        }
      `}</style>

      <PageHeader
        title="Settings"
        description="Command Center protocol and broker configuration."
      />

      <Grid>
        {/* ── Read-only info banner ─────────────────────────────────────── */}
        <Column sm={4} md={8} lg={16}>
          <div style={{ marginBottom: 'var(--cds-spacing-05)' }}>
            <InlineNotification
              kind="info"
              title="Read-only — "
              subtitle="Settings are managed in the control plane (Frappe). This is a read-only view."
              lowContrast
              hideCloseButton
            />
          </div>
        </Column>

        {/* ── Fetch error ───────────────────────────────────────────────── */}
        {error && (
          <Column sm={4} md={8} lg={16}>
            <div style={{ marginBottom: 'var(--cds-spacing-05)' }}>
              <InlineNotification
                kind="error"
                title="Could not load settings — "
                subtitle={error.message}
                lowContrast
              />
            </div>
          </Column>
        )}

        {/* ── Settings structured list ──────────────────────────────────── */}
        <Column sm={4} md={5} lg={10}>
          <div style={{ marginTop: 'var(--cds-spacing-04)' }}>
            <Layer>
              <Tile>
                {GROUPS.map(group => (
                  <div key={group.heading} className="st-group">
                    <p className="cc-panel-heading">{group.heading}</p>
                    <StructuredListWrapper isCondensed>
                      <StructuredListBody>
                        {group.fields.map(field => (
                          <FieldRow
                            key={field.key}
                            field={field}
                            data={data}
                            loading={loading}
                          />
                        ))}
                      </StructuredListBody>
                    </StructuredListWrapper>
                  </div>
                ))}
              </Tile>
            </Layer>
          </div>
        </Column>

        {/* ── Connection tile ───────────────────────────────────────────── */}
        <Column sm={4} md={3} lg={6}>
          <div style={{ marginTop: 'var(--cds-spacing-04)' }}>
            <Layer>
              <Tile>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--cds-spacing-02)',
                    marginBottom: 'var(--cds-spacing-04)',
                  }}
                >
                  <Wifi size={14} style={{ color: 'var(--cds-text-secondary)' }} />
                  <p className="cc-panel-heading" style={{ margin: 0 }}>
                    Connection
                  </p>
                </div>

                <StructuredListWrapper isCondensed>
                  <StructuredListBody>
                    <StructuredListRow>
                      <StructuredListCell noWrap>
                        <span className="st-label">Gateway</span>
                      </StructuredListCell>
                      <StructuredListCell>
                        <span
                          style={{
                            fontFamily: '"IBM Plex Mono", "Courier New", monospace',
                            fontSize: '0.8125rem',
                            color: 'var(--cds-text-primary)',
                            wordBreak: 'break-all',
                          }}
                        >
                          {gatewayOrigin}
                        </span>
                      </StructuredListCell>
                    </StructuredListRow>

                    <StructuredListRow>
                      <StructuredListCell noWrap>
                        <span className="st-label">WebSocket</span>
                      </StructuredListCell>
                      <StructuredListCell>
                        <StatusTag
                          status={live.connected ? 'online' : 'offline'}
                          size="sm"
                        />
                      </StructuredListCell>
                    </StructuredListRow>
                  </StructuredListBody>
                </StructuredListWrapper>
              </Tile>
            </Layer>
          </div>
        </Column>
      </Grid>
    </div>
  )
}
