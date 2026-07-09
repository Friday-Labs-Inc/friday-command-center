// RoverDetail — drill-down for a single rover.
// Route: /rovers/:id  (id = rover name / rover_id from the fleet list)
// Tabs: Overview | Commands | Security | Certificates | Allowlist
//
// LAYER MODEL:
//   page background (--cds-background)
//   └─ <Layer>   → layer-01 (Tile content, DataTablePanel)
//
// This file is self-contained. Shared files (api, store, useAsync,
// PageHeader, StatusTag, DataTablePanel) are imported; not modified.

import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import {
  Accordion,
  AccordionItem,
  Button,
  Column,
  Grid,
  InlineLoading,
  InlineNotification,
  Layer,
  PasswordInput,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Tag,
  TextInput,
  Tile,
} from '@carbon/react'
import { Renew } from '@carbon/icons-react'

import { PageHeader } from '../components/PageHeader'
import { StatusTag } from '../components/StatusTag'
import { DataTablePanel } from '../components/DataTablePanel'
import { useAsync } from '../lib/useAsync'
import { useLiveStore } from '../lib/store'
import * as api from '../lib/api'
import { agent } from '../agent'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtNum(n: number | null | undefined, decimals = 3): string {
  if (n == null) return '—'
  return n.toFixed(decimals)
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return s
  }
}

// ── Column definitions ────────────────────────────────────────────────────────

const AUDIT_HEADERS = [
  { key: 'issued_at',     header: 'Issued'   },
  { key: 'command_class', header: 'Class'    },
  { key: 'outcome',       header: 'Outcome'  },
  { key: 'operator',      header: 'Operator' },
  { key: 'nonce',         header: 'Nonce'    },
]

const SEC_HEADERS = [
  { key: 'event_time',  header: 'Time'        },
  { key: 'category',    header: 'Category'    },
  { key: 'severity',    header: 'Severity'    },
  { key: 'description', header: 'Description' },
  { key: 'action',      header: 'Action'      },
]

const CERT_HEADERS = [
  { key: 'common_name', header: 'Common name' },
  { key: 'status',      header: 'Status'      },
  { key: 'issuing_ca',  header: 'Issuing CA'  },
  { key: 'serial',      header: 'Serial'      },
  { key: 'issued_on',   header: 'Issued'      },
  { key: 'expires_on',  header: 'Expires'     },
]

const ALLOW_HEADERS = [
  { key: 'operator',   header: 'Operator'   },
  { key: 'enabled',    header: 'Access'     },
  { key: 'epoch',      header: 'Epoch'      },
  { key: 'granted_on', header: 'Granted on' },
  { key: 'granted_by', header: 'Granted by' },
  { key: 'notes',      header: 'Notes'      },
]

// ── Component ─────────────────────────────────────────────────────────────────

export function RoverDetail() {
  const { id = '' } = useParams<{ id: string }>()

  // ── Data fetches (all hooks at top level — Rules of Hooks) ────────────────
  const roversQ    = useAsync(() => api.rovers(), [])
  const stateSnapQ = useAsync(
    () => (id ? api.roverState(id) : Promise.reject(new Error('No rover id'))),
    [id],
  )
  const eventsQ = useAsync(
    () => (id ? api.securityEvents(id, 100) : Promise.reject(new Error('No rover id'))),
    [id],
  )
  const certsQ = useAsync(
    () => (id ? api.certificates(undefined, id) : Promise.reject(new Error('No rover id'))),
    [id],
  )
  const allowQ = useAsync(
    () => (id ? api.allowlist(id) : Promise.reject(new Error('No rover id'))),
    [id],
  )
  const auditQ = useAsync(
    () => (id ? api.auditLog(id, 100) : Promise.reject(new Error('No rover id'))),
    [id],
  )

  const live = useLiveStore()

  // ── Derived rover identity ─────────────────────────────────────────────────
  const rover     = roversQ.data?.find(r => r.name === id || r.rover_id === id) ?? null
  const liveMatch = live.rover.rover === id && live.rover.updated !== null
  const pose = liveMatch
    ? { x: live.rover.x, y: live.rover.y, theta: live.rover.theta, updated: live.rover.updated }
    : stateSnapQ.data
    ? { x: stateSnapQ.data.x, y: stateSnapQ.data.y, theta: stateSnapQ.data.theta, updated: stateSnapQ.data.updated }
    : null

  const roverFeed    = live.feed.filter(f => f.rover === id).slice(0, 25)
  const pageTitle    = roversQ.loading
    ? (id || 'Rover')
    : (rover?.rover_name ?? rover?.rover_id ?? (id || 'Rover'))

  // ── Acknowledge security event ─────────────────────────────────────────────
  const [ackBusy,     setAckBusy]     = useState<Set<string>>(new Set())
  const [ackFeedback, setAckFeedback] = useState<{ kind: 'success' | 'error'; msg: string } | null>(null)

  async function handleAck(name: string) {
    setAckBusy(prev => new Set(prev).add(name))
    setAckFeedback(null)
    try {
      await api.ackSecurityEvent(name)
      eventsQ.reload()
      setAckFeedback({ kind: 'success', msg: `Event ${name} acknowledged.` })
    } catch (e) {
      setAckFeedback({ kind: 'error', msg: e instanceof Error ? e.message : String(e) })
    } finally {
      setAckBusy(prev => { const n = new Set(prev); n.delete(name); return n })
    }
  }

  // ── Inline command console (rover pre-bound to id) ─────────────────────────
  const [operator,  setOperator]  = useState('OP-001')
  const [linearV,   setLinearV]   = useState('0.5')
  const [angularV,  setAngularV]  = useState('0.0')
  const [enrollKey, setEnrollKey] = useState('')
  const [agentUp,   setAgentUp]   = useState(false)
  const [enrolled,  setEnrolled]  = useState(false)
  const [cmdBusy,   setCmdBusy]   = useState(false)
  const [cmdOut,    setCmdOut]    = useState('')
  const [cmdOk,     setCmdOk]     = useState(false)

  // Probe the signing agent whenever the operator field changes.
  useEffect(() => {
    let cancelled = false
    agent.status(operator)
      .then(s  => { if (!cancelled) { setAgentUp(true);  setEnrolled(!!s.enrolled) } })
      .catch(() => { if (!cancelled) { setAgentUp(false); setEnrolled(false) } })
    return () => { cancelled = true }
  }, [operator])

  async function handleEnroll() {
    if (cmdBusy) return
    setCmdBusy(true)
    setCmdOut('')
    try {
      if (enrollKey.trim().length !== 64) {
        throw new Error('Private key must be exactly 64 hex characters (32 bytes).')
      }
      const r = await agent.enroll(operator, enrollKey.trim())
      setEnrollKey('') // never keep the raw key in the page
      setEnrolled(true)
      setCmdOk(true)
      setCmdOut(
        `Key enrolled in OS keychain — pubkey ${(r.public_key as string).slice(0, 16)}…` +
        ` Register it in the operator allowlist before sending commands.`,
      )
    } catch (e) {
      setCmdOk(false)
      setCmdOut(e instanceof Error ? e.message : String(e))
    } finally {
      setCmdBusy(false)
    }
  }

  async function handleSend() {
    if (cmdBusy) return
    setCmdBusy(true)
    setCmdOut('')
    try {
      // 1. Issue a gateway nonce (prevents replay).
      const n = await api.issueNonce(id, operator)

      // 2. Build the unsigned command envelope (rover_id bound to this page's id).
      const envelope = {
        protocol_version: { major: 0, minor: 1, patch: 0 },
        rover_id:   id,
        sender_id:  operator,
        msg_id:     n.nonce,
        nonce:      n.nonce,
        issued_at:  n.issued_at,
        expires_at: n.expires_at,
        payload: {
          class:            'motion',
          type:             1,
          linear_velocity:  parseFloat(linearV),
          angular_velocity: parseFloat(angularV),
        },
      }

      // 3. Ask the gateway for the canonical bytes to sign.
      const sb = await api.signBytes(envelope)

      // 4. Ask the local signing agent to sign (key stays in the keychain).
      const sig = await agent.sign(operator, sb.signing_hex)

      // 5. Dispatch the signed envelope.
      const res = await api.sendCommand(envelope, sig)

      setCmdOk(true)
      setCmdOut(
        `Command dispatched — signed by the keychain agent, key never left the OS. Nonce: ${res.nonce}`,
      )
      auditQ.reload()
    } catch (e) {
      setCmdOk(false)
      setCmdOut(e instanceof Error ? e.message : String(e))
    } finally {
      setCmdBusy(false)
    }
  }

  const agentTagType = !agentUp ? 'red' : enrolled ? 'green' : 'gray'
  const agentTagText = !agentUp ? 'agent offline' : enrolled ? 'key in keychain' : 'not enrolled'

  // ── Table row builders ─────────────────────────────────────────────────────

  const auditRows = (auditQ.data ?? []).map(e => ({
    id:            e.name,
    issued_at:     fmtDate(e.issued_at),
    command_class: e.command_class,
    outcome:       <StatusTag status={e.outcome} />,
    operator:      e.operator,
    nonce:         e.nonce.length > 14 ? `${e.nonce.slice(0, 14)}…` : e.nonce,
  }))

  const secRows = (eventsQ.data ?? []).map(e => ({
    id:          e.name,
    event_time:  fmtDate(e.event_time),
    category:    e.category,
    severity:    <StatusTag status={e.severity} severity />,
    description: e.description ?? '—',
    action: e.acknowledged === 1
      ? <Tag type="green" size="sm">Acknowledged</Tag>
      : (
        <Button
          kind="ghost"
          size="sm"
          disabled={ackBusy.has(e.name)}
          onClick={() => { void handleAck(e.name) }}
        >
          {ackBusy.has(e.name) ? 'Working…' : 'Acknowledge'}
        </Button>
      ),
  }))

  const certRows = (certsQ.data ?? []).map(c => ({
    id:          c.name,
    common_name: c.common_name,
    status:      <StatusTag status={c.status} />,
    issuing_ca:  c.issuing_ca,
    serial:      c.serial,
    issued_on:   fmtDate(c.issued_on),
    expires_on:  fmtDate(c.expires_on),
  }))

  const allowRows = (allowQ.data ?? []).map(a => ({
    id:         a.name,
    operator:   a.operator,
    enabled:    a.enabled === 1
      ? <Tag type="green" size="sm">Enabled</Tag>
      : <Tag type="red"   size="sm">Disabled</Tag>,
    epoch:      String(a.epoch),
    granted_on: fmtDate(a.granted_on),
    granted_by: a.granted_by,
    notes:      a.notes || '—',
  }))

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="cc-page">
      <PageHeader
        title={pageTitle}
        breadcrumbs={[
          { label: 'Fleet', href: '/' },
          { label: pageTitle },
        ]}
        actions={rover ? (
          <div style={{
            display:        'flex',
            alignItems:     'center',
            gap:            'var(--cds-spacing-03)',
            justifyContent: 'flex-end',
          }}>
            <StatusTag status={rover.status} size="md" />
            <Button
              kind="ghost"
              size="sm"
              renderIcon={Renew}
              iconDescription="Reload rover data"
              hasIconOnly
              onClick={() => {
                roversQ.reload()
                stateSnapQ.reload()
              }}
            />
          </div>
        ) : undefined}
      />

      {/* Top-level fetch error */}
      {roversQ.error && (
        <Grid>
          <Column sm={4} md={8} lg={16}>
            <div style={{ marginBottom: 'var(--cds-spacing-05)' }}>
              <InlineNotification
                kind="error"
                title="Failed to load rover — "
                subtitle={roversQ.error.message}
                hideCloseButton
              />
            </div>
          </Column>
        </Grid>
      )}

      <Tabs>
        <TabList aria-label="Rover detail sections" contained>
          <Tab>Overview</Tab>
          <Tab>Commands</Tab>
          <Tab>Security</Tab>
          <Tab>Certificates</Tab>
          <Tab>Allowlist</Tab>
        </TabList>

        <TabPanels>

          {/* ── Tab 1: Overview ───────────────────────────────────────────── */}
          <TabPanel>
            <Grid>
              {/* Left column — pose + identity */}
              <Column sm={4} md={4} lg={8}>
                <Layer>
                  <Tile>
                    {/* Pose */}
                    <div style={{
                      display:     'flex',
                      alignItems:  'center',
                      gap:         'var(--cds-spacing-03)',
                      marginBottom: 'var(--cds-spacing-04)',
                    }}>
                      <p className="cc-panel-heading" style={{ margin: 0 }}>Pose</p>
                      {liveMatch && <Tag type="green" size="sm">live</Tag>}
                    </div>

                    {stateSnapQ.loading && !pose && (
                      <InlineLoading description="Loading pose…" />
                    )}
                    {stateSnapQ.error && (
                      <InlineNotification
                        kind="error"
                        title=""
                        subtitle={stateSnapQ.error.message}
                        hideCloseButton
                        lowContrast
                      />
                    )}
                    {pose && (
                      <>
                        <div style={{
                          display:             'grid',
                          gridTemplateColumns: 'repeat(3, 1fr)',
                          gap:                 'var(--cds-spacing-05)',
                          marginBottom:        'var(--cds-spacing-05)',
                        }}>
                          {(['X (m)', 'Y (m)', 'θ (rad)'] as const).map((label, i) => {
                            const vals = [fmtNum(pose.x), fmtNum(pose.y), fmtNum(pose.theta)]
                            return (
                              <div key={label}>
                                <p className="cc-kpi-label">{label}</p>
                                <p className="cc-kpi-value" style={{
                                  fontSize:           '1.25rem',
                                  fontVariantNumeric: 'tabular-nums',
                                }}>
                                  {vals[i]}
                                </p>
                              </div>
                            )
                          })}
                        </div>
                        {pose.updated && (
                          <p className="cc-subheading">Updated {pose.updated}</p>
                        )}
                      </>
                    )}

                    {/* Identity */}
                    <p className="cc-panel-heading" style={{ marginTop: 'var(--cds-spacing-06)' }}>
                      Identity
                    </p>
                    {roversQ.loading ? (
                      <InlineLoading description="Loading…" />
                    ) : rover ? (
                      <>
                        {(
                          [
                            ['Rover ID',  rover.rover_id],
                            ['Fleet',     rover.fleet            || '—'],
                            ['Owner org', rover.owner_org        || '—'],
                            ['Firmware',  rover.firmware_version || '—'],
                            ['Last seen', fmtDate(rover.last_seen)],
                          ] as [string, string][]
                        ).map(([label, value]) => (
                          <div key={label} className="cc-telemetry-row">
                            <span className="cc-telemetry-label">{label}</span>
                            <span style={label === 'Firmware' ? { fontFamily: 'monospace' } : undefined}>
                              {value}
                            </span>
                          </div>
                        ))}
                        <div
                          className="cc-telemetry-row"
                          style={{ borderBottom: 'none', alignItems: 'flex-start', paddingBottom: 0 }}
                        >
                          <span className="cc-telemetry-label" style={{ flexShrink: 0 }}>
                            TLS fingerprint
                          </span>
                          <span style={{
                            fontFamily: 'monospace',
                            fontSize:   '0.6875rem',
                            color:      'var(--cds-text-secondary)',
                            wordBreak:  'break-all',
                            textAlign:  'right',
                          }}>
                            {rover.tls_cert_fingerprint || '—'}
                          </span>
                        </div>
                      </>
                    ) : (
                      <p style={{ fontSize: '0.875rem', color: 'var(--cds-text-secondary)' }}>
                        Rover not found.
                      </p>
                    )}
                  </Tile>
                </Layer>
              </Column>

              {/* Right column — live feed */}
              <Column sm={4} md={4} lg={8}>
                <Layer>
                  <Tile style={{ height: '100%' }}>
                    <div style={{
                      display:        'flex',
                      alignItems:     'center',
                      justifyContent: 'space-between',
                      marginBottom:   'var(--cds-spacing-04)',
                    }}>
                      <p className="cc-panel-heading" style={{ margin: 0 }}>Live feed</p>
                      <Tag type={live.connected ? 'green' : 'gray'} size="sm">
                        {live.connected ? 'connected' : 'disconnected'}
                      </Tag>
                    </div>

                    {roverFeed.length === 0 ? (
                      <p style={{ fontSize: '0.875rem', color: 'var(--cds-text-secondary)' }}>
                        No events for this rover yet.
                      </p>
                    ) : (
                      <div style={{
                        display:       'flex',
                        flexDirection: 'column',
                        gap:           'var(--cds-spacing-01)',
                        overflow:      'hidden',
                      }}>
                        {roverFeed.map((f, i) => (
                          <div key={`${f.ts}-${f.kind}-${i}`} className="cc-feed-row">
                            <span style={{ color: 'var(--cds-text-secondary)', flexShrink: 0 }}>
                              {f.ts}
                            </span>
                            <Tag type={f.kind === 'fault' ? 'red' : 'blue'} size="sm">
                              {f.kind}
                            </Tag>
                            {f.topic && <span className="cc-feed-data">{f.topic}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </Tile>
                </Layer>
              </Column>
            </Grid>
          </TabPanel>

          {/* ── Tab 2: Commands ───────────────────────────────────────────── */}
          <TabPanel>
            <Grid>
              <Column sm={4} md={5} lg={7}>
                <Layer>
                  <Tile>
                    {/* Signing agent status */}
                    <div className="cc-console-header">
                      <span style={{
                        fontSize:      '0.75rem',
                        fontWeight:    600,
                        letterSpacing: '0.05em',
                        textTransform: 'uppercase',
                        color:         'var(--cds-text-secondary)',
                      }}>
                        Signing agent
                      </span>
                      <Tag type={agentTagType} size="sm">{agentTagText}</Tag>
                    </div>

                    {/* Rover (read-only — bound to this rover's id) */}
                    <div style={{ marginBottom: 'var(--cds-spacing-05)' }}>
                      <p className="cc-kpi-label">Rover</p>
                      <p style={{
                        fontSize:   '0.875rem',
                        fontFamily: 'monospace',
                        color:      'var(--cds-text-primary)',
                        margin:     0,
                      }}>
                        {id}
                      </p>
                    </div>

                    <div className="cc-inputs-grid" style={{ marginBottom: 'var(--cds-spacing-05)' }}>
                      <TextInput
                        id="rd-operator"
                        labelText="Operator ID"
                        value={operator}
                        onChange={e => setOperator(e.target.value)}
                      />
                      <div />
                      <TextInput
                        id="rd-linear"
                        labelText="Linear velocity (m/s)"
                        value={linearV}
                        onChange={e => setLinearV(e.target.value)}
                      />
                      <TextInput
                        id="rd-angular"
                        labelText="Angular velocity (rad/s)"
                        value={angularV}
                        onChange={e => setAngularV(e.target.value)}
                      />
                    </div>

                    <Button
                      kind="primary"
                      disabled={cmdBusy || !agentUp || !enrolled}
                      onClick={() => { void handleSend() }}
                      style={{ width: '100%', maxWidth: '100%', marginBottom: 'var(--cds-spacing-05)' }}
                    >
                      {cmdBusy ? 'Signing…' : 'Sign & send via keychain agent'}
                    </Button>

                    <Accordion>
                      <AccordionItem title="Enroll a key into the keychain (one-time)">
                        <PasswordInput
                          id="rd-enroll-key"
                          labelText="Ed25519 private key (64 hex)"
                          hideLabel
                          placeholder="Ed25519 private key — 64 hex characters"
                          value={enrollKey}
                          onChange={e => setEnrollKey(e.target.value)}
                        />
                        <p style={{
                          fontSize: '0.6875rem',
                          color:    'var(--cds-support-warning)',
                          margin:   'var(--cds-spacing-03) 0',
                        }}>
                          Stored in the OS keychain by the local agent and cleared from this
                          page immediately. It is never transmitted to the Command Center server.
                        </p>
                        <Button
                          kind="secondary"
                          disabled={cmdBusy || !agentUp}
                          onClick={() => { void handleEnroll() }}
                          style={{ width: '100%', maxWidth: '100%' }}
                        >
                          Enroll in keychain
                        </Button>
                      </AccordionItem>
                    </Accordion>

                    {cmdOut && (
                      <div style={{ marginTop: 'var(--cds-spacing-05)' }}>
                        <InlineNotification
                          lowContrast
                          hideCloseButton
                          kind={cmdOk ? 'success' : 'error'}
                          title=""
                          subtitle={cmdOut}
                        />
                      </div>
                    )}
                  </Tile>
                </Layer>
              </Column>
            </Grid>

            <div style={{ marginTop: 'var(--cds-spacing-06)' }}>
              <DataTablePanel
                title="Command audit log"
                description={`Signed commands dispatched to rover ${id}.`}
                headers={AUDIT_HEADERS}
                rows={auditRows}
                loading={auditQ.loading}
                searchable
                pageSize={10}
              />
              {auditQ.error && (
                <div style={{ marginTop: 'var(--cds-spacing-04)' }}>
                  <InlineNotification
                    kind="error"
                    title="Audit log failed to load — "
                    subtitle={auditQ.error.message}
                    hideCloseButton
                  />
                </div>
              )}
            </div>
          </TabPanel>

          {/* ── Tab 3: Security ───────────────────────────────────────────── */}
          <TabPanel>
            {ackFeedback && (
              <div style={{ marginBottom: 'var(--cds-spacing-05)' }}>
                <InlineNotification
                  kind={ackFeedback.kind}
                  title=""
                  subtitle={ackFeedback.msg}
                  onCloseButtonClick={() => setAckFeedback(null)}
                />
              </div>
            )}
            <DataTablePanel
              title="Security events"
              description={`Active and acknowledged security events for rover ${id}.`}
              headers={SEC_HEADERS}
              rows={secRows}
              loading={eventsQ.loading}
              searchable
              pageSize={10}
            />
            {eventsQ.error && (
              <div style={{ marginTop: 'var(--cds-spacing-04)' }}>
                <InlineNotification
                  kind="error"
                  title="Security events failed to load — "
                  subtitle={eventsQ.error.message}
                  hideCloseButton
                />
              </div>
            )}
          </TabPanel>

          {/* ── Tab 4: Certificates ───────────────────────────────────────── */}
          <TabPanel>
            <DataTablePanel
              title="Certificates"
              description={`TLS and signing certificates for rover ${id}.`}
              headers={CERT_HEADERS}
              rows={certRows}
              loading={certsQ.loading}
              searchable
              pageSize={10}
            />
            {certsQ.error && (
              <div style={{ marginTop: 'var(--cds-spacing-04)' }}>
                <InlineNotification
                  kind="error"
                  title="Certificates failed to load — "
                  subtitle={certsQ.error.message}
                  hideCloseButton
                />
              </div>
            )}
          </TabPanel>

          {/* ── Tab 5: Allowlist ──────────────────────────────────────────── */}
          <TabPanel>
            <DataTablePanel
              title="Operator allowlist"
              description={`Operators authorized to command rover ${id}.`}
              headers={ALLOW_HEADERS}
              rows={allowRows}
              loading={allowQ.loading}
              searchable
              pageSize={10}
            />
            {allowQ.error && (
              <div style={{ marginTop: 'var(--cds-spacing-04)' }}>
                <InlineNotification
                  kind="error"
                  title="Allowlist failed to load — "
                  subtitle={allowQ.error.message}
                  hideCloseButton
                />
              </div>
            )}
          </TabPanel>

        </TabPanels>
      </Tabs>
    </div>
  )
}
