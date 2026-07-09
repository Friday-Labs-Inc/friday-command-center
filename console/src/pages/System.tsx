// System — compute-node inventory and OS service status for the Mark 1 stack.
// Three physical nodes (Core Hub, Telemetry Gateway, Research Deck) with live
// service rows derived from the rover heartbeat; network topology below.

import { Button, InlineNotification, SkeletonText } from '@carbon/react'
import { Chip, Satellite, Microscope, Renew, Network_3, Router } from '@carbon/icons-react'
import { useAsync } from '../lib/useAsync'
import { ConfigCard, type CardStatus } from '../components/ConfigCard'
import * as api from '../lib/api'

// ── Local helpers ─────────────────────────────────────────────────────────────

type DotStatus = 'ok' | 'off'

function Dot({ status }: { status: DotStatus }) {
  return <span className={`cc-dot cc-dot--${status}`} aria-hidden="true" />
}

interface ServiceRow {
  label: string
  status: DotStatus
}

function ServiceRows({ services }: { services: ServiceRow[] }) {
  return (
    <>
      {services.map(({ label, status }) => (
        <div key={label} className="cc-kv">
          <span className="cc-kv__k">{label}</span>
          <span className="cc-kv__v">
            <Dot status={status} />
            {status === 'ok' ? 'active' : 'inactive'}
          </span>
        </div>
      ))}
    </>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function System() {
  const rovers = useAsync(() => api.rovers(), [])

  const rover = rovers.data?.[0]
  const roverOnline = !!rover && rover.status === 'Active'
  const coreStatus: CardStatus = rovers.loading ? 'off' : roverOnline ? 'ok' : 'off'
  const svc: DotStatus = roverOnline ? 'ok' : 'off'

  // Service manifests for each node. Core Hub reflects live rover data;
  // the other two nodes are not yet provisioned.
  const coreServices: ServiceRow[] = [
    { label: 'friday-core-os.target', status: svc },
    { label: 'module-registry', status: svc },
    { label: 'mosquitto-internal', status: svc },
    { label: 'micro-ros-agent-gpio', status: svc },
    { label: 'micro-ros-agent-udp', status: svc },
  ]

  const telemetryServices: ServiceRow[] = [
    { label: 'mosquitto-relay', status: 'off' },
    { label: 'modem-manager', status: 'off' },
    { label: 'health-beacon', status: 'off' },
  ]

  const researchServices: ServiceRow[] = [
    { label: 'friday-researchdeck-os.target', status: 'off' },
    { label: 'coral-inference', status: 'off' },
    { label: 'sensor-bridge', status: 'off' },
    { label: 'slam-node', status: 'off' },
  ]

  return (
    <div className="cc-page">
      <header className="cc-pagehead">
        <p className="cc-pagehead__eyebrow">System</p>
        <div className="cc-pagehead__row">
          <div>
            <h1 className="cc-pagehead__title">Compute nodes &amp; services</h1>
            <p className="cc-pagehead__sub">
              The OS services on each node of the Mark 1 stack.
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

        {rovers.error && (
          <InlineNotification
            kind="error"
            lowContrast
            hideCloseButton
            title="Rover status unavailable"
            subtitle={rovers.error.message}
          />
        )}

        <div className="cc-grid cc-grid--3">
          {/* Core Hub — tracks live rover heartbeat */}
          <ConfigCard status={coreStatus}>
            <div className="cc-card__head">
              <div>
                <p className="cc-card__eyebrow">Pi 4B · 10.0.1.1 · friday-core-os</p>
                <h3 className="cc-card__title">Core Hub</h3>
              </div>
              <Chip size={20} className="cc-card__icon" />
            </div>
            <div className="cc-card__body">
              {rovers.loading
                ? <SkeletonText paragraph lineCount={5} />
                : <ServiceRows services={coreServices} />}
            </div>
            <div className="cc-card__foot">
              <Button size="sm" renderIcon={Renew} disabled>Restart</Button>
              <span className="cc-card__meta">control API pending</span>
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
              <ServiceRows services={telemetryServices} />
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
              <ServiceRows services={researchServices} />
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
