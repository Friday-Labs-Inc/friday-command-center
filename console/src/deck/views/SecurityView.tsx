// Security — signed-command audit trail + security events. Deck-native port of
// the classic Security Audit page. Reads /api/audit + /api/security-events;
// acknowledges an event through the gateway.

import { useCallback, useEffect, useState } from 'react'
import { ViewHead, Panel } from '../bits'
import {
  auditLog as fetchAudit, securityEvents as fetchEvents, ackSecurityEvent,
  type AuditEntry, type SecurityEvent,
} from '../../lib/api'

const mono = 'var(--mono)'

function sevChip(sev: string) {
  const s = sev.toLowerCase()
  if (s === 'critical' || s === 'error') return <span className="dk-chip crit">{sev}</span>
  if (s === 'warning') return <span className="dk-chip standby">{sev}</span>
  return <span className="dk-chip prov">{sev}</span>
}
function outcomeChip(o: string) {
  const s = o.toLowerCase()
  if (s === 'accepted') return <span className="dk-chip ok">{o}</span>
  if (s === 'rejected' || s === 'replayed') return <span className="dk-chip crit">{o}</span>
  return <span className="dk-chip standby">{o}</span>
}

export function SecurityView() {
  const [audit, setAudit] = useState<AuditEntry[] | null>(null)
  const [events, setEvents] = useState<SecurityEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    fetchAudit(undefined, 100).then(setAudit).catch(e => setError(String(e)))
    fetchEvents(undefined, 100).then(setEvents).catch(e => setError(String(e)))
  }, [])
  useEffect(() => { load() }, [load])

  const doAck = async (ev: SecurityEvent) => {
    setBusy(ev.name); setError(null)
    try {
      await ackSecurityEvent(ev.name)
      await new Promise(r => setTimeout(r, 300)); load()
    } catch (e) { setError(String(e)) } finally { setBusy(null) }
  }

  const openEvents = (events ?? []).filter(e => !e.acknowledged)

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: '20px 26px' }}>
      <ViewHead
        eyebrow="SECURITY · AUDIT TRAIL"
        title="Security"
        sub={<>
          {audit ? <span className="dk-chip ok">{audit.length} AUDIT ENTRIES</span> : <span className="dk-chip standby">LOADING…</span>}
          {openEvents.length > 0 && <span className="dk-chip crit" style={{ marginLeft: 6 }}>{openEvents.length} UNACKED EVENTS</span>}
        </>}
      />

      <div style={{ display: 'grid', gap: 14, maxWidth: 1100, marginTop: 84 }}>
        <Panel title="Security events" meta={<button className="dk-btn" onClick={load}>REFRESH</button>}>
          <div style={{ padding: '4px 0' }}>
            {error && <div style={{ padding: '8px 14px', fontFamily: mono, fontSize: 11, color: 'var(--crit)' }}>{error}</div>}
            {events?.length === 0 && <div style={{ padding: '12px 14px', fontFamily: mono, fontSize: 11, color: 'var(--ok)' }}>no security events — clean</div>}
            {events?.map(e => (
              <div key={e.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', borderBottom: '1px solid rgba(90,115,150,0.14)', opacity: e.acknowledged ? 0.55 : 1 }}>
                {sevChip(e.severity)}
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontFamily: mono, fontSize: 12, color: 'var(--ice)' }}>{e.category} <span style={{ color: 'var(--dim)' }}>· {e.rover}{e.operator ? ` · ${e.operator}` : ''}</span></div>
                  <div style={{ fontFamily: mono, fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>{e.description || e.source_fault || '—'}{e.event_time ? ` · ${new Date(e.event_time).toLocaleString()}` : ''}</div>
                </div>
                {e.acknowledged
                  ? <span className="dk-chip prov">ACKED</span>
                  : <button className="dk-btn" disabled={busy === e.name} onClick={() => doAck(e)}>{busy === e.name ? '…' : 'ack'}</button>}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Signed-command audit" meta={<span className="dk-chip prov">LAST {audit?.length ?? 0}</span>}>
          <div style={{ padding: '4px 0', maxHeight: 460, overflow: 'auto' }}>
            {audit?.length === 0 && <div style={{ padding: '12px 14px', fontFamily: mono, fontSize: 11, color: 'var(--dim)' }}>no commands recorded</div>}
            {audit?.map(a => (
              <div key={a.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 14px', borderBottom: '1px solid rgba(90,115,150,0.10)' }}>
                {outcomeChip(a.outcome)}
                <div style={{ flex: 1, minWidth: 220, fontFamily: mono, fontSize: 11, color: 'var(--ice)' }}>
                  {a.command_class} <span style={{ color: 'var(--dim)' }}>· {a.rover} · {a.operator} · nonce {a.nonce}</span>
                </div>
                <span style={{ fontFamily: mono, fontSize: 9.5, color: 'var(--dim)' }}>{a.category}</span>
                <span style={{ fontFamily: mono, fontSize: 9.5, color: 'var(--dim)', minWidth: 130, textAlign: 'right' }}>{a.received_at ? new Date(a.received_at).toLocaleString() : '—'}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}
