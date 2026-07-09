// SecurityAudit — Security events and command audit log.
//
// Tab 1: Security events
//   • Rover Dropdown (from api.rovers()) + Severity Dropdown (client-side filter)
//   • DataTablePanel: event_time, rover, operator, category, severity →
//     StatusTag (severity), acknowledged → Tag green/gray, description,
//     Acknowledge ghost button on every unacked row.
//   • ackSecurityEvent(name) → toast notification + reload.
//
// Tab 2: Command audit log
//   • Rover Dropdown + Row-limit Dropdown (both server-side)
//   • DataTablePanel: received_at, rover, operator, command_class,
//     outcome → StatusTag, category, nonce (truncated), msg_id (truncated).
//
// Above the tab strip: live fault feed from useLiveStore().liveAlerts
// (shown only when faults are present; hides itself when empty).

import { useState } from 'react'
import {
  Button,
  Column,
  Dropdown,
  Grid,
  InlineLoading,
  InlineNotification,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Tag,
  ToastNotification,
} from '@carbon/react'
import { PageHeader } from '../components/PageHeader'
import { DataTablePanel, type DTPRow } from '../components/DataTablePanel'
import { StatusTag } from '../components/StatusTag'
import * as api from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { useLiveStore } from '../lib/store'

// ── Local types ───────────────────────────────────────────────────────────────

interface Toast {
  id: string
  kind: 'success' | 'error'
  title: string
  subtitle: string
}

interface FilterOption {
  value: string
  label: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_ROVERS: FilterOption = { value: '', label: 'All rovers' }

const SEVERITY_OPTS: FilterOption[] = [
  { value: '',         label: 'All severities' },
  { value: 'Critical', label: 'Critical'       },
  { value: 'Error',    label: 'Error'          },
  { value: 'Warning',  label: 'Warning'        },
  { value: 'Info',     label: 'Info'           },
]

const LIMIT_OPTS: FilterOption[] = [
  { value: '50',  label: '50 rows'  },
  { value: '100', label: '100 rows' },
  { value: '200', label: '200 rows' },
  { value: '500', label: '500 rows' },
]

const DEFAULT_LIMIT = LIMIT_OPTS[1] // 100 rows

const EVENT_HEADERS = [
  { key: 'event_time',  header: 'Time'        },
  { key: 'rover',       header: 'Rover'       },
  { key: 'operator',    header: 'Operator'    },
  { key: 'category',    header: 'Category'    },
  { key: 'severity',    header: 'Severity'    },
  { key: 'acked',       header: 'Status'      },
  { key: 'description', header: 'Description' },
  { key: 'ack_action',  header: ''            },
]

const AUDIT_HEADERS = [
  { key: 'received_at',   header: 'Received'  },
  { key: 'rover',         header: 'Rover'     },
  { key: 'operator',      header: 'Operator'  },
  { key: 'command_class', header: 'Class'     },
  { key: 'outcome',       header: 'Outcome'   },
  { key: 'category',      header: 'Category'  },
  { key: 'nonce',         header: 'Nonce'     },
  { key: 'msg_id',        header: 'Msg ID'    },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function trunc(s: string, n = 12): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

function toStr(item: FilterOption | null): string {
  return item?.label ?? ''
}

function pickOpt(opts: FilterOption[], value: string): FilterOption {
  return opts.find(o => o.value === value) ?? opts[0]
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SecurityAudit() {
  // ── Live WebSocket faults ──────────────────────────────────────────────────
  const { liveAlerts } = useLiveStore()

  // ── Toast state ────────────────────────────────────────────────────────────
  const [toasts, setToasts] = useState<Toast[]>([])

  function pushToast(kind: 'success' | 'error', title: string, subtitle: string): void {
    const id = `${Date.now()}-${Math.random()}`
    setToasts(prev => [...prev, { id, kind, title, subtitle }])
  }

  function dropToast(id: string): void {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  // ── Security events filters ────────────────────────────────────────────────
  const [evtRover, setEvtRover] = useState<FilterOption>(ALL_ROVERS)
  const [evtSeverity, setEvtSeverity] = useState<FilterOption>(SEVERITY_OPTS[0])
  const [ackingIds, setAckingIds] = useState<Set<string>>(new Set())

  // ── Audit log filters ──────────────────────────────────────────────────────
  const [auditRover, setAuditRover] = useState<FilterOption>(ALL_ROVERS)
  const [auditLimit, setAuditLimit] = useState<FilterOption>(DEFAULT_LIMIT)

  // ── API fetches ────────────────────────────────────────────────────────────
  const roversAsync = useAsync(() => api.rovers(), [])

  const eventsAsync = useAsync(
    () => api.securityEvents(evtRover.value || undefined, 200),
    [evtRover.value],
  )

  const auditAsync = useAsync(
    () => api.auditLog(auditRover.value || undefined, Number(auditLimit.value)),
    [auditRover.value, auditLimit.value],
  )

  // ── Shared rover dropdown options ──────────────────────────────────────────
  const roverOpts: FilterOption[] = [
    ALL_ROVERS,
    ...(roversAsync.data ?? []).map(r => ({ value: r.name, label: r.rover_name })),
  ]

  // ── Acknowledge action ─────────────────────────────────────────────────────
  async function handleAck(name: string): Promise<void> {
    setAckingIds(prev => new Set([...prev, name]))
    try {
      await api.ackSecurityEvent(name)
      pushToast('success', 'Event acknowledged', name)
      eventsAsync.reload()
    } catch (e) {
      pushToast('error', 'Acknowledge failed', e instanceof Error ? e.message : String(e))
    } finally {
      setAckingIds(prev => {
        const next = new Set(prev)
        next.delete(name)
        return next
      })
    }
  }

  // ── Security event rows ────────────────────────────────────────────────────
  const rawEvents = eventsAsync.data ?? []
  const filteredEvents = evtSeverity.value
    ? rawEvents.filter(e => e.severity === evtSeverity.value)
    : rawEvents

  const eventRows: DTPRow[] = filteredEvents.map(evt => ({
    id: evt.name,
    event_time: evt.event_time ?? '—',
    rover: evt.rover,
    operator: evt.operator ?? '—',
    category: evt.category,
    severity: <StatusTag status={evt.severity} severity />,
    acked: evt.acknowledged === 1
      ? <Tag type="green" size="sm">Acknowledged</Tag>
      : <Tag type="gray" size="sm">Pending</Tag>,
    description: evt.description
      ? (
        <span
          title={evt.description}
          style={{
            display: 'block',
            maxWidth: '22rem',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {evt.description}
        </span>
      )
      : '—',
    ack_action: evt.acknowledged === 0
      ? ackingIds.has(evt.name)
        ? <InlineLoading description="Acknowledging…" />
        : (
          <Button
            kind="ghost"
            size="sm"
            onClick={() => void handleAck(evt.name)}
          >
            Acknowledge
          </Button>
        )
      : null,
  }))

  // ── Audit log rows ─────────────────────────────────────────────────────────
  const auditRows: DTPRow[] = (auditAsync.data ?? []).map(entry => ({
    id: entry.name,
    received_at: entry.received_at,
    rover: entry.rover,
    operator: entry.operator,
    command_class: entry.command_class,
    outcome: <StatusTag status={entry.outcome} />,
    category: entry.category,
    nonce: trunc(entry.nonce),
    msg_id: trunc(entry.msg_id),
  }))

  // ── Toolbar actions ────────────────────────────────────────────────────────
  const eventsReloadBtn = (
    <Button kind="ghost" size="sm" onClick={eventsAsync.reload}>
      Reload
    </Button>
  )

  const auditReloadBtn = (
    <Button kind="ghost" size="sm" onClick={auditAsync.reload}>
      Reload
    </Button>
  )

  // ── Filter row style (shared) ──────────────────────────────────────────────
  const filterRowStyle: React.CSSProperties = {
    display: 'flex',
    gap: 'var(--cds-spacing-05)',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    marginTop: 'var(--cds-spacing-05)',
    marginBottom: 'var(--cds-spacing-05)',
  }

  const filterDropdownStyle: React.CSSProperties = {
    minWidth: '14rem',
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="cc-page">

      {/* ── Toast container (fixed, bottom-right) ─────────────────────────── */}
      {toasts.length > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: 'var(--cds-spacing-06)',
            right: 'var(--cds-spacing-06)',
            zIndex: 9000,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--cds-spacing-03)',
          }}
        >
          {toasts.map(t => (
            <ToastNotification
              key={t.id}
              kind={t.kind}
              title={t.title}
              subtitle={t.subtitle}
              onClose={() => dropToast(t.id)}
              timeout={5000}
            />
          ))}
        </div>
      )}

      {/* ── Page header ───────────────────────────────────────────────────── */}
      <PageHeader
        title="Security & audit"
        description="Security events, live fault stream, and command audit log."
      />

      {/* ── Live fault feed (hidden when empty) ───────────────────────────── */}
      {liveAlerts.length > 0 && (
        <Grid>
          <Column sm={4} md={8} lg={16}>
            <div style={{ marginBottom: 'var(--cds-spacing-05)' }}>
              <div className="cc-alerts-header">
                <span className="cc-panel-heading">Live fault stream</span>
                <Tag type="red" size="sm">{liveAlerts.length} active</Tag>
              </div>
              {liveAlerts.slice(0, 5).map((alert, i) => (
                <div key={i} className="cc-alert-row">
                  <span
                    style={{
                      color: 'var(--cds-text-secondary)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {alert.ts}
                  </span>
                  <Tag type="red" size="sm">{alert.kind}</Tag>
                  <span style={{ fontWeight: 600 }}>{alert.rover}</span>
                  {alert.topic && (
                    <span className="cc-feed-data">{alert.topic}</span>
                  )}
                </div>
              ))}
            </div>
          </Column>
        </Grid>
      )}

      {/* ── Tab strip ─────────────────────────────────────────────────────── */}
      <Tabs>
        <TabList aria-label="Security and audit sections" contained>
          <Tab>Security events</Tab>
          <Tab>Command audit log</Tab>
        </TabList>

        <TabPanels>

          {/* ── Tab 1: Security events ──────────────────────────────────── */}
          <TabPanel>

            {/* Filter row */}
            <div style={filterRowStyle}>
              <div style={filterDropdownStyle}>
                <Dropdown
                  id="evt-rover-filter"
                  titleText="Rover"
                  label="All rovers"
                  items={roverOpts}
                  itemToString={toStr}
                  selectedItem={pickOpt(roverOpts, evtRover.value)}
                  onChange={({ selectedItem }) =>
                    setEvtRover((selectedItem as FilterOption | null) ?? ALL_ROVERS)
                  }
                  size="sm"
                />
              </div>
              <div style={filterDropdownStyle}>
                <Dropdown
                  id="evt-severity-filter"
                  titleText="Severity"
                  label="All severities"
                  items={SEVERITY_OPTS}
                  itemToString={toStr}
                  selectedItem={evtSeverity}
                  onChange={({ selectedItem }) =>
                    setEvtSeverity((selectedItem as FilterOption | null) ?? SEVERITY_OPTS[0])
                  }
                  size="sm"
                />
              </div>
            </div>

            {/* Fetch error */}
            {eventsAsync.error && (
              <div style={{ marginBottom: 'var(--cds-spacing-05)' }}>
                <InlineNotification
                  lowContrast
                  hideCloseButton
                  kind="error"
                  title="Failed to load security events"
                  subtitle={eventsAsync.error.message}
                />
              </div>
            )}

            <DataTablePanel
              title="Security events"
              description={[
                `${filteredEvents.length} event${filteredEvents.length !== 1 ? 's' : ''}`,
                evtSeverity.value ? evtSeverity.label : '',
                evtRover.value ? evtRover.label : '',
              ]
                .filter(Boolean)
                .join(' · ')}
              headers={EVENT_HEADERS}
              rows={eventRows}
              loading={eventsAsync.loading && eventsAsync.data === null}
              searchable
              toolbarActions={eventsReloadBtn}
              pageSize={20}
            />
          </TabPanel>

          {/* ── Tab 2: Command audit log ─────────────────────────────────── */}
          <TabPanel>

            {/* Filter row */}
            <div style={filterRowStyle}>
              <div style={filterDropdownStyle}>
                <Dropdown
                  id="audit-rover-filter"
                  titleText="Rover"
                  label="All rovers"
                  items={roverOpts}
                  itemToString={toStr}
                  selectedItem={pickOpt(roverOpts, auditRover.value)}
                  onChange={({ selectedItem }) =>
                    setAuditRover((selectedItem as FilterOption | null) ?? ALL_ROVERS)
                  }
                  size="sm"
                />
              </div>
              <div style={{ minWidth: '10rem' }}>
                <Dropdown
                  id="audit-limit"
                  titleText="Row limit"
                  label="100 rows"
                  items={LIMIT_OPTS}
                  itemToString={toStr}
                  selectedItem={auditLimit}
                  onChange={({ selectedItem }) =>
                    setAuditLimit((selectedItem as FilterOption | null) ?? DEFAULT_LIMIT)
                  }
                  size="sm"
                />
              </div>
            </div>

            {/* Fetch error */}
            {auditAsync.error && (
              <div style={{ marginBottom: 'var(--cds-spacing-05)' }}>
                <InlineNotification
                  lowContrast
                  hideCloseButton
                  kind="error"
                  title="Failed to load audit log"
                  subtitle={auditAsync.error.message}
                />
              </div>
            )}

            <DataTablePanel
              title="Command audit log"
              description={[
                `${auditRows.length} entr${auditRows.length !== 1 ? 'ies' : 'y'}`,
                auditRover.value ? auditRover.label : '',
                `limit ${auditLimit.label}`,
              ]
                .filter(Boolean)
                .join(' · ')}
              headers={AUDIT_HEADERS}
              rows={auditRows}
              loading={auditAsync.loading && auditAsync.data === null}
              searchable
              toolbarActions={auditReloadBtn}
              pageSize={20}
            />
          </TabPanel>

        </TabPanels>
      </Tabs>
    </div>
  )
}
