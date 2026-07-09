// CommandConsole — sign and dispatch motion commands through the gateway.
// The operator's private key lives entirely in the OS keychain via the local
// signing agent (agent.ts); it is never stored in the page or transmitted to
// the Command Center server.

import { useState, useEffect } from 'react'
import {
  Accordion,
  AccordionItem,
  ActionableNotification,
  Button,
  Column,
  Form,
  Grid,
  InlineLoading,
  Layer,
  NumberInput,
  PasswordInput,
  Select,
  SelectItem,
  Stack,
  Tag,
  Tile,
} from '@carbon/react'
import { Terminal } from '@carbon/icons-react'
import { PageHeader } from '../components/PageHeader'
import { rovers as apiRovers, issueNonce, signBytes, sendCommand } from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { agent } from '../agent'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Outcome {
  ok: boolean
  message: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CommandConsole() {
  // ── Rover list (for Select) ──────────────────────────────────────────────────
  const { data: roverList, loading: roversLoading } = useAsync(() => apiRovers(), [])

  // ── Form state ───────────────────────────────────────────────────────────────
  const [operator, setOperator] = useState('OP-001')
  const [rover, setRover] = useState('')
  const [linearV, setLinearV] = useState<number>(0)
  const [angularV, setAngularV] = useState<number>(0)
  const [enrollKey, setEnrollKey] = useState('')

  // ── Agent / keychain state ───────────────────────────────────────────────────
  const [agentUp, setAgentUp] = useState(false)
  const [enrolled, setEnrolled] = useState(false)

  // ── Action state ─────────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  // Seed rover selection from the first item once the list arrives.
  useEffect(() => {
    if (roverList && roverList.length > 0 && !rover) {
      setRover(roverList[0].name)
    }
  }, [roverList, rover])

  // Probe the signing agent whenever the operator field changes.
  useEffect(() => {
    let cancelled = false
    agent
      .status(operator)
      .then(s => {
        if (cancelled) return
        setAgentUp(true)
        setEnrolled(!!s.enrolled)
      })
      .catch(() => {
        if (cancelled) return
        setAgentUp(false)
        setEnrolled(false)
      })
    return () => {
      cancelled = true
    }
  }, [operator])

  // ── Enroll key ───────────────────────────────────────────────────────────────
  async function enroll() {
    if (busy) return
    setBusy(true)
    setOutcome(null)
    try {
      if (enrollKey.trim().length !== 64) {
        throw new Error('Private key must be exactly 64 hex characters (32 bytes).')
      }
      const r = await agent.enroll(operator, enrollKey.trim())
      setEnrollKey('') // clear — key must never linger in the page
      setEnrolled(true)
      setOutcome({
        ok: true,
        message:
          `Key enrolled in OS keychain — pubkey ${(r.public_key as string).slice(0, 16)}… ` +
          `Register it in the operator allowlist before sending commands.`,
      })
    } catch (e: unknown) {
      setOutcome({ ok: false, message: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  // ── Send command ─────────────────────────────────────────────────────────────
  async function send() {
    if (busy) return
    setBusy(true)
    setOutcome(null)
    try {
      // 1. Issue a gateway nonce (prevents replay).
      const n = await issueNonce(rover, operator)

      // 2. Build the unsigned command envelope.
      const envelope = {
        protocol_version: { major: 0, minor: 1, patch: 0 },
        rover_id: rover,
        sender_id: operator,
        msg_id: n.nonce,
        nonce: n.nonce,
        issued_at: n.issued_at,
        expires_at: n.expires_at,
        payload: {
          class: 'motion',
          type: 1,
          linear_velocity: linearV,
          angular_velocity: angularV,
        },
      }

      // 3. Ask the gateway for the canonical bytes to sign.
      const sb = await signBytes(envelope)

      // 4. Ask the local signing agent to sign (key stays in the OS keychain).
      const sig = await agent.sign(operator, sb.signing_hex)

      // 5. Dispatch the signed envelope.
      const res = await sendCommand(envelope, sig)

      setOutcome({
        ok: true,
        message:
          `Command dispatched — signed by the keychain agent, key never left the OS. ` +
          `Nonce: ${res.nonce}`,
      })
    } catch (e: unknown) {
      setOutcome({ ok: false, message: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  // ── Derived UI state ─────────────────────────────────────────────────────────
  const agentTagType = !agentUp ? 'red' : enrolled ? 'green' : 'gray'
  const agentTagLabel = !agentUp ? 'agent offline' : enrolled ? 'key in keychain' : 'not enrolled'
  const canSend = agentUp && enrolled && !busy && !!rover

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="cc-page">
      <PageHeader
        title="Command console"
        description="Sign and dispatch motion commands through the gateway. The operator key never leaves the OS keychain."
      />

      <Grid>
        <Column sm={4} md={6} lg={8}>
          <Layer>
            <Tile>
              {/* ── Agent status header ───────────────────────────────────── */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 'var(--cds-spacing-05)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--cds-spacing-03)' }}>
                  <Terminal size={16} style={{ color: 'var(--cds-text-secondary)' }} />
                  <span
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      letterSpacing: '0.05em',
                      textTransform: 'uppercase',
                      color: 'var(--cds-text-secondary)',
                    }}
                  >
                    Signing agent
                  </span>
                </div>
                <Tag type={agentTagType} size="sm">
                  {agentTagLabel}
                </Tag>
              </div>

              {/* ── Command form ──────────────────────────────────────────── */}
              <Form
                onSubmit={(e: React.FormEvent) => {
                  e.preventDefault()
                  send()
                }}
              >
                <Stack gap={5}>
                  <Select
                    id="cc-operator-input"
                    labelText="Operator"
                    value={operator}
                    onChange={e => setOperator(e.target.value)}
                  >
                    {/* Free-typed operator: render current value as the only item so the
                        select reflects the TextInput-equivalent. Operators page is the
                        canonical management surface; here we keep a simple text entry. */}
                    <SelectItem value={operator} text={operator} />
                  </Select>

                  <Select
                    id="cc-rover"
                    labelText="Rover"
                    value={rover}
                    onChange={e => setRover(e.target.value)}
                    disabled={roversLoading || (!roverList?.length && !roversLoading)}
                  >
                    {roversLoading && (
                      <SelectItem value="" text="Loading rovers…" />
                    )}
                    {!roversLoading && (!roverList || roverList.length === 0) && (
                      <SelectItem value="" text="No rovers available" />
                    )}
                    {roverList?.map(r => (
                      <SelectItem
                        key={r.name}
                        value={r.name}
                        text={`${r.rover_name} (${r.rover_id})`}
                      />
                    ))}
                  </Select>

                  <NumberInput
                    id="cc-linear"
                    label="Linear velocity (m/s)"
                    value={linearV}
                    step={0.1}
                    min={-0.5}
                    max={0.5}
                    onChange={(_e, { value }) =>
                      setLinearV(typeof value === 'number' ? value : parseFloat(String(value)) || 0)
                    }
                  />

                  <NumberInput
                    id="cc-angular"
                    label="Angular velocity (rad/s)"
                    value={angularV}
                    step={0.1}
                    min={-1}
                    max={1}
                    onChange={(_e, { value }) =>
                      setAngularV(typeof value === 'number' ? value : parseFloat(String(value)) || 0)
                    }
                  />

                  <Button
                    kind="primary"
                    type="submit"
                    disabled={!canSend}
                    style={{ width: '100%', maxWidth: '100%' }}
                  >
                    {busy ? (
                      <InlineLoading description="Signing…" status="active" />
                    ) : (
                      'Sign & send (via keychain agent)'
                    )}
                  </Button>
                </Stack>
              </Form>

              {/* ── Enroll accordion ──────────────────────────────────────── */}
              <div style={{ marginTop: 'var(--cds-spacing-05)' }}>
                <Accordion>
                  <AccordionItem title="Enroll a key into the keychain (one-time)">
                    <Stack gap={4}>
                      <PasswordInput
                        id="cc-enroll-key"
                        labelText="Ed25519 private key (64 hex)"
                        placeholder="Ed25519 private key — 64 hex characters"
                        value={enrollKey}
                        onChange={e => setEnrollKey(e.target.value)}
                      />
                      <p
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--cds-support-warning)',
                          lineHeight: '1.4',
                        }}
                      >
                        Stored in the OS keychain by the local agent and cleared from
                        this page immediately. It is never transmitted to the Command
                        Center server.
                      </p>
                      <Button
                        kind="secondary"
                        disabled={busy || !agentUp}
                        onClick={enroll}
                        style={{ width: '100%', maxWidth: '100%' }}
                      >
                        Enroll in keychain
                      </Button>
                    </Stack>
                  </AccordionItem>
                </Accordion>
              </div>

              {/* ── Outcome notification ──────────────────────────────────── */}
              {outcome && (
                <div style={{ marginTop: 'var(--cds-spacing-05)' }}>
                  <ActionableNotification
                    inline
                    lowContrast
                    kind={outcome.ok ? 'success' : 'error'}
                    title=""
                    subtitle={outcome.message}
                    actionButtonLabel="Dismiss"
                    onActionButtonClick={() => setOutcome(null)}
                    hideCloseButton={false}
                    onClose={() => setOutcome(null)}
                  />
                </div>
              )}
            </Tile>
          </Layer>
        </Column>
      </Grid>
    </div>
  )
}
