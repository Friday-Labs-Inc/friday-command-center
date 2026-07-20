// Access — operator registry + active revocations. Deck-native port of the
// classic Operators page. Reads /api/operators + /api/revocations; actions
// revoke an operator and lift a revocation through the gateway.

import { useCallback, useEffect, useState } from 'react'
import { ViewHead, Panel } from '../bits'
import {
  operators as fetchOperators, revocations as fetchRevocations,
  revokeOperator, liftRevocation,
  type Operator, type Revocation,
} from '../../lib/api'

const mono = 'var(--mono)'

function statusChip(status: string) {
  const s = status.toLowerCase()
  if (s === 'active') return <span className="dk-chip ok">{status}</span>
  if (s === 'revoked') return <span className="dk-chip crit">{status}</span>
  if (s === 'lifted') return <span className="dk-chip prov">{status}</span>
  return <span className="dk-chip standby">{status}</span>
}

export function AccessView() {
  const [ops, setOps] = useState<Operator[] | null>(null)
  const [revs, setRevs] = useState<Revocation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    fetchOperators().then(setOps).catch(e => setError(String(e)))
    fetchRevocations().then(setRevs).catch(e => setError(String(e)))
  }, [])
  useEffect(() => { load() }, [load])

  const doRevoke = async (op: Operator) => {
    if (!window.confirm(`Revoke ${op.operator_id} on ALL rovers? Its command authority stops immediately.`)) return
    setBusy(op.name); setError(null)
    try {
      await revokeOperator({ operator: op.operator_id, scope: 'All Rovers', reason: 'Revoked from deck' })
      await new Promise(r => setTimeout(r, 300)); load()
    } catch (e) { setError(String(e)) } finally { setBusy(null) }
  }
  const doLift = async (rev: Revocation) => {
    setBusy(rev.name); setError(null)
    try {
      await liftRevocation(rev.name)
      await new Promise(r => setTimeout(r, 300)); load()
    } catch (e) { setError(String(e)) } finally { setBusy(null) }
  }

  const activeRevs = (revs ?? []).filter(r => r.status === 'Active')

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: '20px 26px' }}>
      <ViewHead
        eyebrow="SECURITY · ACCESS"
        title="Access"
        sub={<>
          {ops ? <span className="dk-chip ok">{ops.filter(o => o.status === 'Active').length} ACTIVE OPERATORS</span> : <span className="dk-chip standby">LOADING…</span>}
          {activeRevs.length > 0 && <span className="dk-chip crit" style={{ marginLeft: 6 }}>{activeRevs.length} REVOKED</span>}
        </>}
      />

      <div style={{ display: 'grid', gap: 14, maxWidth: 1050, marginTop: 84 }}>
        <Panel title="Operator registry" meta={<button className="dk-btn" onClick={load}>REFRESH</button>}>
          <div style={{ padding: '4px 0' }}>
            {error && <div style={{ padding: '8px 14px', fontFamily: mono, fontSize: 11, color: 'var(--crit)' }}>{error}</div>}
            {!ops && !error && <div style={{ padding: '12px 14px', fontFamily: mono, fontSize: 11, color: 'var(--dim)' }}>loading…</div>}
            {ops?.map(o => (
              <div key={o.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', borderBottom: '1px solid rgba(90,115,150,0.14)' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontFamily: mono, fontSize: 12, color: 'var(--ice)' }}>{o.operator_id} <span style={{ color: 'var(--dim)' }}>· {o.operator_name}</span></div>
                  <div style={{ fontFamily: mono, fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>key {o.key_fingerprint || '—'}</div>
                </div>
                {statusChip(o.status)}
                <button className="dk-btn" disabled={busy === o.name || o.status !== 'Active'} style={{ borderColor: o.status === 'Active' ? 'rgba(255,77,106,0.4)' : undefined }} onClick={() => doRevoke(o)}>
                  {busy === o.name ? '…' : 'revoke'}
                </button>
              </div>
            ))}
            {ops?.length === 0 && <div style={{ padding: '12px 14px', fontFamily: mono, fontSize: 11, color: 'var(--dim)' }}>no operators registered</div>}
          </div>
        </Panel>

        <Panel title="Revocations" meta={<span className="dk-chip prov">{activeRevs.length} ACTIVE</span>}>
          <div style={{ padding: '4px 0' }}>
            {revs?.length === 0 && <div style={{ padding: '12px 14px', fontFamily: mono, fontSize: 11, color: 'var(--dim)' }}>no revocations on record</div>}
            {revs?.map(r => (
              <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', borderBottom: '1px solid rgba(90,115,150,0.14)' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontFamily: mono, fontSize: 12, color: 'var(--ice)' }}>{r.operator} <span style={{ color: 'var(--dim)' }}>· {r.scope}{r.rover ? ` (${r.rover})` : ''}</span></div>
                  <div style={{ fontFamily: mono, fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>{r.reason || '—'} · epoch {r.epoch}</div>
                </div>
                {statusChip(r.status)}
                {r.status === 'Active' && (
                  <button className="dk-btn" disabled={busy === r.name} onClick={() => doLift(r)}>
                    {busy === r.name ? '…' : 'lift'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}
