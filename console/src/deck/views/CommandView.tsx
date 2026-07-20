// Command — sign and dispatch a motion command through the gateway. The operator
// key never leaves the local signing agent (OS keychain). Deck-native port of
// the classic Command Console. Flow: issue nonce -> canonical bytes -> local
// agent signs -> gateway dispatches.

import { useEffect, useState } from 'react'
import { ViewHead, Panel } from '../bits'
import { rovers as fetchRovers, issueNonce, signBytes, sendCommand, type Rover } from '../../lib/api'
import { agent } from '../../agent'

const mono = 'var(--mono)'

type AgentState = 'checking' | 'offline' | 'not-enrolled' | 'ready'

export function CommandView() {
  const [rovers, setRovers] = useState<Rover[]>([])
  const [rover, setRover] = useState('')
  const [operator] = useState('OP-001')
  const [linearV, setLinearV] = useState(0)
  const [angularV, setAngularV] = useState(0)
  const [agentState, setAgentState] = useState<AgentState>('checking')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    fetchRovers().then(rs => {
      const real = rs.filter(r => r.name !== 'MROVER')
      setRovers(real)
      if (real.length && !rover) setRover(real[0].name)
    }).catch(() => {})
    agent.status(operator)
      .then((s: { enrolled?: boolean }) => setAgentState(s.enrolled ? 'ready' : 'not-enrolled'))
      .catch(() => setAgentState('offline'))
  }, [operator, rover])

  const canSend = agentState === 'ready' && !busy && !!rover

  const send = async () => {
    if (!canSend) return
    setBusy(true); setOutcome(null)
    try {
      const n = await issueNonce(rover, operator)
      const envelope = {
        protocol_version: { major: 0, minor: 1, patch: 0 },
        rover_id: rover, sender_id: operator,
        msg_id: n.nonce, nonce: n.nonce, issued_at: n.issued_at, expires_at: n.expires_at,
        payload: { class: 'motion', type: 1, linear_velocity: linearV, angular_velocity: angularV },
      }
      const sb = await signBytes(envelope)
      const sig = await agent.sign(operator, sb.signing_hex)
      const res = await sendCommand(envelope, sig)
      setOutcome({ ok: true, msg: `Command dispatched — signed by the keychain agent, key never left the OS. Nonce ${res.nonce}` })
    } catch (e) {
      setOutcome({ ok: false, msg: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  const agentChip = {
    checking: <span className="dk-chip standby">CHECKING…</span>,
    offline: <span className="dk-chip crit">AGENT OFFLINE</span>,
    'not-enrolled': <span className="dk-chip standby">NOT ENROLLED</span>,
    ready: <span className="dk-chip ok">KEY IN KEYCHAIN</span>,
  }[agentState]

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: '20px 26px' }}>
      <ViewHead
        eyebrow="SECURITY · COMMAND"
        title="Command"
        sub={<>{agentChip} <span style={{ color: 'var(--dim)', fontSize: 11 }}>operator key signs locally — never sent to the server</span></>}
      />

      <div style={{ display: 'grid', gap: 14, maxWidth: 720, marginTop: 84 }}>
        <Panel title="Compose motion command" meta={<span className="dk-chip prov">{operator}</span>}>
          <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{ fontFamily: mono, fontSize: 10, color: 'var(--dim)', marginBottom: 5, letterSpacing: '0.08em' }}>TARGET ROVER</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {rovers.map(r => (
                  <button key={r.name} className="dk-btn" style={r.name === rover ? { borderColor: 'var(--cyan)', color: 'var(--cyan)' } : undefined} onClick={() => setRover(r.name)}>
                    {r.name}
                  </button>
                ))}
                {rovers.length === 0 && <span style={{ fontFamily: mono, fontSize: 11, color: 'var(--dim)' }}>no rovers</span>}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <label style={{ fontFamily: mono, fontSize: 11, color: 'var(--ice)' }}>
                <div style={{ color: 'var(--dim)', fontSize: 10, marginBottom: 4 }}>LINEAR m/s</div>
                <input type="number" step="0.05" value={linearV} onChange={e => setLinearV(Number(e.target.value))}
                  style={{ width: 110, fontFamily: mono, fontSize: 13, color: 'var(--ice)', background: 'rgba(11,18,32,0.6)', border: '1px solid var(--line-bright)', borderRadius: 3, padding: '7px 9px', outline: 'none' }} />
              </label>
              <label style={{ fontFamily: mono, fontSize: 11, color: 'var(--ice)' }}>
                <div style={{ color: 'var(--dim)', fontSize: 10, marginBottom: 4 }}>ANGULAR rad/s</div>
                <input type="number" step="0.05" value={angularV} onChange={e => setAngularV(Number(e.target.value))}
                  style={{ width: 110, fontFamily: mono, fontSize: 13, color: 'var(--ice)', background: 'rgba(11,18,32,0.6)', border: '1px solid var(--line-bright)', borderRadius: 3, padding: '7px 9px', outline: 'none' }} />
              </label>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button className="dk-btn primary" disabled={!canSend} onClick={send}>
                {busy ? 'SIGNING & DISPATCHING…' : 'SIGN & DISPATCH'}
              </button>
              {agentState === 'offline' && (
                <span style={{ fontFamily: mono, fontSize: 10.5, color: 'var(--dim)', lineHeight: 1.4 }}>
                  Start the local signing agent (127.0.0.1:7070) and enroll {operator}'s key to dispatch.
                </span>
              )}
              {agentState === 'not-enrolled' && (
                <span style={{ fontFamily: mono, fontSize: 10.5, color: 'var(--dim)' }}>Agent up — enroll {operator}'s key to dispatch.</span>
              )}
            </div>

            {outcome && (
              <div style={{ fontFamily: mono, fontSize: 11, lineHeight: 1.5, color: outcome.ok ? 'var(--ok)' : 'var(--crit)', padding: '8px 10px', border: `1px solid ${outcome.ok ? 'rgba(59,232,150,0.3)' : 'rgba(255,77,106,0.3)'}`, borderRadius: 4 }}>
                {outcome.msg}
              </div>
            )}
          </div>
        </Panel>

        <Panel title="Pipeline">
          <div style={{ padding: '12px 14px', fontFamily: mono, fontSize: 11, color: 'var(--dim)', lineHeight: 1.9 }}>
            <div>1 · gateway issues a single-use <b style={{ color: 'var(--ice)' }}>nonce</b> (replay guard)</div>
            <div>2 · envelope built + gateway returns <b style={{ color: 'var(--ice)' }}>canonical bytes</b></div>
            <div>3 · local agent <b style={{ color: 'var(--ice)' }}>signs</b> — key stays in the OS keychain</div>
            <div>4 · gateway verifies + <b style={{ color: 'var(--ice)' }}>dispatches</b> to the rover authority chain</div>
          </div>
        </Panel>
      </div>
    </div>
  )
}
