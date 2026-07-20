// System — live systemd units on the Core Hub (via os-control agent) with
// start/stop/restart control, plus the protocol/broker settings. Deck-native
// port of the classic System + Settings pages.

import { useCallback, useEffect, useState } from 'react'
import { ViewHead, Panel } from '../bits'
import {
  systemServices, systemServiceAction, settings as fetchSettings,
  type SystemService, type Settings, type ServiceAction,
} from '../../lib/api'

const mono = 'var(--mono)'

function activeChip(active: string) {
  if (active === 'active') return <span className="dk-chip ok">ACTIVE</span>
  if (active === 'failed') return <span className="dk-chip crit">FAILED</span>
  if (active === 'activating' || active === 'deactivating') return <span className="dk-chip standby">{active.toUpperCase()}</span>
  return <span className="dk-chip prov">{(active || 'unknown').toUpperCase()}</span>
}

export function SystemView() {
  const [services, setServices] = useState<SystemService[] | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)   // unit name being acted on

  const load = useCallback(() => {
    systemServices().then(setServices).catch(e => setError(String(e)))
    fetchSettings().then(setSettings).catch(() => { /* settings optional */ })
  }, [])

  useEffect(() => { load() }, [load])

  const act = async (name: string, action: ServiceAction) => {
    setBusy(name); setError(null)
    try {
      await systemServiceAction(name, action)
      // give systemd a beat, then refresh live state
      await new Promise(r => setTimeout(r, 600))
      const fresh = await systemServices()
      setServices(fresh)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: '20px 26px' }}>
      <ViewHead
        eyebrow="CONTROL · SYSTEM"
        title="System"
        sub={<>
          {services
            ? <span className="dk-chip ok">{services.filter(s => s.active === 'active').length}/{services.length} UNITS ACTIVE</span>
            : <span className="dk-chip standby">READING os-control…</span>}
          {' '}<span style={{ color: 'var(--dim)', fontSize: 11 }}>live systemd units on the Core Hub</span>
        </>}
      />

      <div style={{ display: 'grid', gap: 14, maxWidth: 1000, marginTop: 84 }}>
        <Panel title="Core Hub services" meta={<button className="dk-btn" onClick={load}>REFRESH</button>}>
          <div style={{ padding: '6px 0' }}>
            {error && <div style={{ padding: '8px 14px', fontFamily: mono, fontSize: 11, color: 'var(--crit)' }}>{error}</div>}
            {!services && !error && <div style={{ padding: '12px 14px', fontFamily: mono, fontSize: 11, color: 'var(--dim)' }}>loading…</div>}
            {services?.map(s => (
              <div key={s.name} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px',
                borderBottom: '1px solid rgba(90,115,150,0.14)',
              }}>
                <div style={{ minWidth: 260, flex: 1 }}>
                  <div style={{ fontFamily: mono, fontSize: 12, color: 'var(--ice)' }}>{s.name}</div>
                  <div style={{ fontFamily: mono, fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>{s.description}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 120 }}>
                  {activeChip(s.active)}
                  <span style={{ fontFamily: mono, fontSize: 9.5, color: 'var(--dim)' }}>{s.sub}</span>
                </div>
                <div style={{ display: 'flex', gap: 5 }}>
                  {(['restart', 'stop', 'start'] as ServiceAction[]).map(a => (
                    <button
                      key={a}
                      className="dk-btn"
                      disabled={busy === s.name}
                      style={a === 'stop' ? { borderColor: 'rgba(255,77,106,0.4)' } : undefined}
                      onClick={() => act(s.name, a)}
                    >
                      {busy === s.name ? '…' : a}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        {settings && (
          <Panel title="Protocol & broker" meta={<span className="dk-chip prov">READ-ONLY</span>}>
            <div style={{ padding: '10px 14px' }}>
              {[
                ['protocol major', String(settings.protocol_major)],
                ['broker', `${settings.broker_host}:${settings.broker_port}`],
                ['command expiry', `${settings.command_expiry_s} s`],
                ['clock skew tolerance', `${settings.clock_skew_tolerance_s} s`],
                ['default authority lease', `${settings.default_authority_lease_s} s`],
              ].map(([k, v]) => (
                <div key={k} className="dk-kv"><span className="k">{k}</span><span className="v">{v}</span></div>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  )
}
