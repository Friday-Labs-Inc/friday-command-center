import { useState, useEffect } from 'react'
import {
  Accordion,
  AccordionItem,
  Button,
  InlineNotification,
  PasswordInput,
  Tag,
  TextInput,
  Tile,
} from '@carbon/react'
import { gateway } from '../gateway'
import { agent } from '../agent'

export function CommandConsole() {
  const [operator, setOperator] = useState('OP-001')
  const [rover, setRover] = useState('MARK1-001')
  const [v, setV] = useState('0.5')
  const [w, setW] = useState('0.0')
  const [enrollKey, setEnrollKey] = useState('')
  const [enrolled, setEnrolled] = useState(false)
  const [agentUp, setAgentUp] = useState(false)
  const [out, setOut] = useState('')
  const [ok, setOk] = useState(false)
  const [busy, setBusy] = useState(false)

  // Refresh agent/keychain status on mount and whenever operator changes.
  useEffect(() => {
    agent.status(operator)
      .then(s => { setAgentUp(true); setEnrolled(!!s.enrolled) })
      .catch(() => { setAgentUp(false); setEnrolled(false) })
  }, [operator])

  async function enroll() {
    if (busy) return
    setBusy(true)
    setOut('')
    try {
      if (enrollKey.trim().length !== 64) throw new Error('private key must be 64 hex chars')
      const r = await agent.enroll(operator, enrollKey.trim())
      setEnrollKey('') // never keep the key in the page
      setEnrolled(true)
      setOk(true)
      setOut(`✓ enrolled in OS keychain — pubkey ${r.public_key.slice(0, 16)}… (register it in the allowlist)`)
    } catch (e: any) {
      setOk(false)
      setOut(`✗ ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function send() {
    if (busy) return
    setBusy(true)
    setOut('')
    try {
      const n = await gateway.issueNonce(rover, operator)
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
          linear_velocity: parseFloat(v),
          angular_velocity: parseFloat(w),
        },
      }
      const sb = await gateway.signBytes(envelope)
      const sig = await agent.sign(operator, sb.signing_hex) // key stays in the agent/keychain
      const res = await gateway.sendCommand(envelope, sig)
      setOk(true)
      setOut(`✓ signed by the agent (key never left the keychain) & dispatched — nonce ${res.nonce}`)
    } catch (e: any) {
      setOk(false)
      setOut(`✗ ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  const statusTagType = !agentUp ? 'red' : enrolled ? 'green' : 'gray'
  const statusTagText = !agentUp ? 'agent offline' : enrolled ? 'key in keychain' : 'not enrolled'

  return (
    <Tile className="cc-panel">
      <div className="cc-console-header">
        <h2 className="cc-panel-heading" style={{ margin: 0 }}>Command console</h2>
        <Tag type={statusTagType}>{statusTagText}</Tag>
      </div>

      <div className="cc-inputs-grid">
        <TextInput
          id="cc-operator"
          labelText="Operator"
          value={operator}
          onChange={e => setOperator(e.target.value)}
        />
        <TextInput
          id="cc-rover"
          labelText="Rover"
          value={rover}
          onChange={e => setRover(e.target.value)}
        />
        <TextInput
          id="cc-linear"
          labelText="Linear (m/s)"
          value={v}
          onChange={e => setV(e.target.value)}
        />
        <TextInput
          id="cc-angular"
          labelText="Angular (rad/s)"
          value={w}
          onChange={e => setW(e.target.value)}
        />
      </div>

      <Button
        kind="primary"
        disabled={busy || !agentUp || !enrolled}
        onClick={send}
        style={{ width: '100%', maxWidth: '100%', marginBottom: 'var(--cds-spacing-05)' }}
      >
        {busy ? 'signing…' : 'Sign & send (via keychain agent)'}
      </Button>

      <Accordion>
        <AccordionItem title="Enroll a key into the keychain (one-time)">
          <PasswordInput
            id="cc-enroll-key"
            labelText="Ed25519 private key"
            hideLabel
            placeholder="Ed25519 private key (64 hex)"
            value={enrollKey}
            onChange={e => setEnrollKey(e.target.value)}
          />
          <p
            style={{
              fontSize: '0.6875rem',
              color: 'var(--cds-support-warning)',
              marginTop: 'var(--cds-spacing-03)',
              marginBottom: 'var(--cds-spacing-03)',
            }}
          >
            Stored in the OS keychain by the local agent and cleared from this
            page. It is never sent to the Command Center server.
          </p>
          <Button
            kind="secondary"
            disabled={busy || !agentUp}
            onClick={enroll}
            style={{ width: '100%', maxWidth: '100%' }}
          >
            Enroll in keychain
          </Button>
        </AccordionItem>
      </Accordion>

      {out && (
        <InlineNotification
          lowContrast
          hideCloseButton
          kind={ok ? 'success' : 'error'}
          title=""
          subtitle={out}
        />
      )}
    </Tile>
  )
}
