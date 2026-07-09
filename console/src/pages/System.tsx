// System — compute-node inventory and OS service control for the Mark 1 stack.
// Core Hub shows LIVE systemd status from the os-control agent and lets the
// operator start/stop/restart the allowlisted units. Telemetry Gateway and
// Research Deck have no agent yet, so their rows are static placeholders.

import { useState } from 'react'
import {
  Button, InlineNotification, SkeletonText, ToastNotification,
  OverflowMenu, OverflowMenuItem,
} from '@carbon/react'
import { Chip, Satellite, Microscope, Renew, Network_3, Router } from '@carbon/icons-react'
import { useAsync } from '../lib/useAsync'
import { ConfigCard, type CardStatus } from '../components/ConfigCard'
import * as api from '../lib/api'
import type { SystemService, ServiceAction } from '../lib/api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function Dot({ status }: { status: CardStatus }) {
  return <span className={`cc-dot cc-dot--${status}`} aria-hidden="true" />
}

const PAST: Record<ServiceAction, string> = {
  start: 'started', stop: 'stopped', restart: 'restarted',
}

const unitLabel = (name: string) => name.replace(/\.service$/, '')

// systemd ActiveState → dot colour
function svcDot(active: string): CardStatus {
  if (active === 'active') return 'ok'
  if (active === 'failed') return 'err'
  if (active === 'activating' || active === 'deactivating' || active === 'reloading') return 'warn'
  return 'off'
}

// roll the units up into a single node status
function nodeStatus(services: SystemService[] | null): CardStatus {
  if (!services || services.length === 0) return 'off'
  if (services.some((s) => s.active === 'failed')) return 'err'
  if (services.every((s) => s.active === 'active')) return 'ok'
  return 'warn'
}

interface StaticRow { label: string; status: CardStatus }

function StaticRows({ rows }: { rows: StaticRow[] }) {
  return (
    <>
      {rows.map(({ label, status }) => (
        <div key={label} className="cc-kv">
          <span className="cc-kv__k">{label}</span>
          <span className="cc-kv__v"><Dot status={status} />{status === 'ok' ? 'active' : 'inactive'}</span>
        </div>
      ))}
    </>
  )
}

type Toast = { kind: 'success' | 'error'; title: string; subtitle: string }

// ── Page ──────────────────────────────────────────────────────────────────────

export function System() {
  const services = useAsync(() => api.systemServices(), [])
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)

  async function handleAction(name: string, action: ServiceAction) {
    setBusy(name)
    try {
      const res = await api.systemServiceAction(name, action)
      setToast(res.ok
        ? { kind: 'success', title: `${unitLabel(name)} ${PAST[action]}`, subtitle: `now ${res.active} · ${res.sub}` }
        : { kind: 'error', title: `${action} failed`, subtitle: res.stderr || 'see agent logs on the Core Hub' })
      services.reload()
    } catch (e) {
      setToast({ kind: 'error', title: `${action} failed`, subtitle: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  const coreStatus = services.loading && !services.data
    ? 'off'
    : services.error ? 'warn' : nodeStatus(services.data)

  const telemetryRows: StaticRow[] = [
    { label: 'mosquitto-relay', status: 'off' },
    { label: 'modem-manager', status: 'off' },
    { label: 'health-beacon', status: 'off' },
  ]
  const researchRows: StaticRow[] = [
    { label: 'friday-researchdeck-os.target', status: 'off' },
    { label: 'coral-inference', status: 'off' },
    { label: 'sensor-bridge', status: 'off' },
    { label: 'slam-node', status: 'off' },
  ]

  return (
    <div className="cc-page">
      {/* ── Action toast ──────────────────────────────────────────────────── */}
      {toast && (
        <div style={{ position: 'fixed', top: '3.75rem', right: '1.5rem', zIndex: 9000 }}>
          <ToastNotification
            kind={toast.kind}
            lowContrast
            title={toast.title}
            subtitle={toast.subtitle}
            timeout={6000}
            onCloseButtonClick={() => setToast(null)}
          />
        </div>
      )}

      <header className="cc-pagehead">
        <p className="cc-pagehead__eyebrow">System</p>
        <div className="cc-pagehead__row">
          <div>
            <h1 className="cc-pagehead__title">Compute nodes &amp; services</h1>
            <p className="cc-pagehead__sub">
              Live OS service control for the Mark 1 stack. Core Hub is wired to the
              on-board control agent; start, stop and restart its services from here.
            </p>
          </div>
        </div>
      </header>

      {/* ── Nodes ─────────────────────────────────────────────────────────── */}
      <section className="cc-section">
        <div className="cc-section__head">
          <h2 className="cc-section__title">Nodes</h2>
          <span className="cc-section__meta">3 compute nodes</span>
        </div>

        <div className="cc-grid cc-grid--3">
          {/* Core Hub — LIVE via os-control agent */}
          <ConfigCard status={coreStatus}>
            <div className="cc-card__head">
              <div>
                <p className="cc-card__eyebrow">Pi 4B · 10.0.1.1 · friday-core-os</p>
                <h3 className="cc-card__title">Core Hub</h3>
              </div>
              <Chip size={20} className="cc-card__icon" />
            </div>
            <div className="cc-card__body">
              {services.loading && !services.data ? (
                <SkeletonText paragraph lineCount={5} />
              ) : services.error ? (
                <InlineNotification
                  kind="warning"
                  lowContrast
                  hideCloseButton
                  title="OS-control agent unreachable"
                  subtitle={services.error.message}
                />
              ) : (
                (services.data ?? []).map((svc) => (
                  <div key={svc.name} className="cc-kv">
                    <span className="cc-kv__k">{unitLabel(svc.name)}</span>
                    <span
                      className="cc-kv__v"
                      style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', justifyContent: 'flex-end' }}
                    >
                      <Dot status={svcDot(svc.active)} />
                      {svc.active}
                      <OverflowMenu
                        size="sm"
                        flipped
                        aria-label={`${unitLabel(svc.name)} actions`}
                        disabled={busy === svc.name}
                      >
                        <OverflowMenuItem itemText="Restart" onClick={() => handleAction(svc.name, 'restart')} />
                        <OverflowMenuItem itemText="Start" onClick={() => handleAction(svc.name, 'start')} />
                        <OverflowMenuItem itemText="Stop" isDelete onClick={() => handleAction(svc.name, 'stop')} />
                      </OverflowMenu>
                    </span>
                  </div>
                ))
              )}
            </div>
            <div className="cc-card__foot">
              <Button
                kind="ghost"
                size="sm"
                renderIcon={Renew}
                onClick={() => services.reload()}
                disabled={services.loading}
              >
                Refresh
              </Button>
              <span className="cc-card__meta">
                {services.error ? 'agent offline' : 'live · os-control agent'}
              </span>
            </div>
          </ConfigCard>

          {/* Telemetry Gateway — image not built yet */}
          <ConfigCard status="off">
            <div className="cc-card__head">
              <div>
                <p className="cc-card__eyebrow">Pi 3B+ · 10.0.1.2 · friday-telemetry-os</p>
                <h3 className="cc-card__title">Telemetry Gateway</h3>
              </div>
              <Satellite size={20} className="cc-card__icon" />
            </div>
            <div className="cc-card__body">
              <StaticRows rows={telemetryRows} />
            </div>
            <div className="cc-card__foot">
              <Button size="sm" renderIcon={Renew} disabled>Restart</Button>
              <span className="cc-card__meta">image not built yet</span>
            </div>
          </ConfigCard>

          {/* Research Deck — hardware pending */}
          <ConfigCard status="off">
            <div className="cc-card__head">
              <div>
                <p className="cc-card__eyebrow">Pi 5 · 10.0.1.3 · friday-researchdeck-os</p>
                <h3 className="cc-card__title">Research Deck</h3>
              </div>
              <Microscope size={20} className="cc-card__icon" />
            </div>
            <div className="cc-card__body">
              <StaticRows rows={researchRows} />
            </div>
            <div className="cc-card__foot">
              <Button size="sm" renderIcon={Renew} disabled>Restart</Button>
              <span className="cc-card__meta">hardware pending (Pi 5 + AI HAT+ 2)</span>
            </div>
          </ConfigCard>
        </div>
      </section>

      {/* ── Network ────────────────────────────────────────────────────────── */}
      <section className="cc-section">
        <div className="cc-section__head">
          <h2 className="cc-section__title">Network</h2>
        </div>
        <div className="cc-grid cc-grid--2">
          {/* Command Center link */}
          <ConfigCard status="ok">
            <div className="cc-card__head">
              <div>
                <p className="cc-card__eyebrow">MQTT uplink</p>
                <h3 className="cc-card__title">Command Center link</h3>
              </div>
              <Network_3 size={20} className="cc-card__icon" />
            </div>
            <div className="cc-card__body">
              <div className="cc-kv">
                <span className="cc-kv__k">Transport</span>
                <span className="cc-kv__v">signed MQTT / mTLS</span>
              </div>
              <div className="cc-kv">
                <span className="cc-kv__k">Broker</span>
                <span className="cc-kv__v">EMQX</span>
              </div>
              <div className="cc-kv">
                <span className="cc-kv__k">Wire</span>
                <span className="cc-kv__v">CBOR · Ed25519</span>
              </div>
            </div>
          </ConfigCard>

          {/* Internal & tunnel */}
          <ConfigCard status="warn">
            <div className="cc-card__head">
              <div>
                <p className="cc-card__eyebrow">LAN · VPN</p>
                <h3 className="cc-card__title">Internal &amp; tunnel</h3>
              </div>
              <Router size={20} className="cc-card__icon" />
            </div>
            <div className="cc-card__body">
              <div className="cc-kv">
                <span className="cc-kv__k">Internal bridge</span>
                <span className="cc-kv__v"><code>10.0.1.0/24</code></span>
              </div>
              <div className="cc-kv">
                <span className="cc-kv__k">WireGuard</span>
                <span className="cc-kv__v">not configured</span>
              </div>
              <div className="cc-kv">
                <span className="cc-kv__k">LAN</span>
                <span className="cc-kv__v">Wi-Fi / Ethernet</span>
              </div>
            </div>
          </ConfigCard>
        </div>
      </section>
    </div>
  )
}
