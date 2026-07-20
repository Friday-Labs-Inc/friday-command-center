// Certificates — rover TLS certificates + certificate authorities. Deck-native
// port of the classic Certificates page. Reads /api/certificates +
// /api/certificate-authorities; revokes an active certificate.

import { useCallback, useEffect, useState } from 'react'
import { ViewHead, Panel } from '../bits'
import {
  certificates as fetchCerts, certificateAuthorities as fetchCAs, revokeCertificate,
  type Certificate, type CertAuthority,
} from '../../lib/api'

const mono = 'var(--mono)'

function certChip(status: string) {
  const s = status.toLowerCase()
  if (s === 'active') return <span className="dk-chip ok">{status}</span>
  if (s === 'revoked') return <span className="dk-chip crit">{status}</span>
  return <span className="dk-chip standby">{status}</span>
}

export function CertificatesView() {
  const [certs, setCerts] = useState<Certificate[] | null>(null)
  const [cas, setCAs] = useState<CertAuthority[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    fetchCerts().then(setCerts).catch(e => setError(String(e)))
    fetchCAs().then(setCAs).catch(() => { /* CAs optional */ })
  }, [])
  useEffect(() => { load() }, [load])

  const doRevoke = async (c: Certificate) => {
    const reason = window.prompt(`Revoke certificate for ${c.rover}? Reason:`, 'Compromised')
    if (!reason) return
    setBusy(c.name); setError(null)
    try {
      await revokeCertificate(c.name, reason)
      await new Promise(r => setTimeout(r, 300)); load()
    } catch (e) { setError(String(e)) } finally { setBusy(null) }
  }

  const active = (certs ?? []).filter(c => c.status === 'Active').length

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: '20px 26px' }}>
      <ViewHead
        eyebrow="SECURITY · CERTIFICATES"
        title="Certificates"
        sub={<>
          {certs ? <span className="dk-chip ok">{active} ACTIVE CERTS</span> : <span className="dk-chip standby">LOADING…</span>}
          {cas && <span className="dk-chip prov" style={{ marginLeft: 6 }}>{cas.length} CA{cas.length === 1 ? '' : 's'}</span>}
        </>}
      />

      <div style={{ display: 'grid', gap: 14, maxWidth: 1100, marginTop: 84 }}>
        <Panel title="Rover TLS certificates" meta={<button className="dk-btn" onClick={load}>REFRESH</button>}>
          <div style={{ padding: '4px 0' }}>
            {error && <div style={{ padding: '8px 14px', fontFamily: mono, fontSize: 11, color: 'var(--crit)' }}>{error}</div>}
            {certs?.length === 0 && <div style={{ padding: '12px 14px', fontFamily: mono, fontSize: 11, color: 'var(--dim)' }}>no certificates issued yet — rovers authenticate via the mTLS certs on disk; issue records appear here once enrolled through the CA</div>}
            {certs?.map(c => (
              <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', borderBottom: '1px solid rgba(90,115,150,0.14)' }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontFamily: mono, fontSize: 12, color: 'var(--ice)' }}>{c.common_name} <span style={{ color: 'var(--dim)' }}>· {c.rover}</span></div>
                  <div style={{ fontFamily: mono, fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>serial {c.serial} · CA {c.issuing_ca} · expires {c.expires_on ? new Date(c.expires_on).toLocaleDateString() : '—'}</div>
                </div>
                {certChip(c.status)}
                {c.status === 'Active' && (
                  <button className="dk-btn" disabled={busy === c.name} style={{ borderColor: 'rgba(255,77,106,0.4)' }} onClick={() => doRevoke(c)}>
                    {busy === c.name ? '…' : 'revoke'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Certificate authorities">
          <div style={{ padding: '4px 0' }}>
            {(!cas || cas.length === 0) && <div style={{ padding: '12px 14px', fontFamily: mono, fontSize: 11, color: 'var(--dim)' }}>no CA on record</div>}
            {cas?.map(ca => (
              <div key={ca.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', borderBottom: '1px solid rgba(90,115,150,0.14)' }}>
                <div style={{ flex: 1, fontFamily: mono, fontSize: 12, color: 'var(--ice)' }}>{ca.common_name}</div>
                {certChip(ca.status)}
                <span style={{ fontFamily: mono, fontSize: 9.5, color: 'var(--dim)' }}>{ca.created ? new Date(ca.created).toLocaleDateString() : ''}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}
