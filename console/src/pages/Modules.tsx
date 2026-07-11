// Modules — module registry for the Friday Labs OS control panel.
// The "Registered" section is LIVE: it polls the Core Hub's registry snapshot
// (core_hub exports /var/lib/friday/registry.json → os-control agent →
// gateway /api/modules/registry). Liveness colors mirror the health monitor:
// OK (heartbeats current) / DEGRADED / DEAD. Registration is automatic via the
// ROS module-agent; the "Register module" button surfaces that explanation.

import { useState, useEffect, useCallback } from 'react'
import {
  Button,
  ComposedModal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ToastNotification,
  InlineNotification,
  SkeletonPlaceholder,
} from '@carbon/react'
import { Add, Chip, Microscope, Rocket, Satellite, Debug } from '@carbon/icons-react'
import { ConfigCard, type CardStatus } from '../components/ConfigCard'
import { modulesRegistry, type RegistryModule } from '../lib/api'

// ── Local helpers ────────────────────────────────────────────────────────────

function Dot({ status }: { status: CardStatus }) {
  const cls = {
    ok:   'cc-dot--ok',
    warn: 'cc-dot--warn',
    err:  'cc-dot--err',
    off:  'cc-dot--off',
  }[status]
  return <span className={`cc-dot ${cls}`} aria-hidden="true" />
}

const LIVENESS_STATUS: Record<RegistryModule['liveness'], CardStatus> = {
  OK: 'ok',
  DEGRADED: 'warn',
  DEAD: 'err',
  UNKNOWN: 'off',
}

const LIVENESS_LABEL: Record<RegistryModule['liveness'], string> = {
  OK: 'live · heartbeats current',
  DEGRADED: 'degraded · heartbeats late',
  DEAD: 'dead · no heartbeats',
  UNKNOWN: 'unknown',
}

function typeIcon(hw: string) {
  const cls = 'cc-card__icon'
  if (hw === 'locomotion') return <Chip size={20} className={cls} />
  if (hw === 'aerial_bay') return <Rocket size={20} className={cls} />
  if (hw === 'sensor') return <Microscope size={20} className={cls} />
  if (hw === 'telemetry') return <Satellite size={20} className={cls} />
  if (hw === 'test') return <Debug size={20} className={cls} />
  return <Chip size={20} className={cls} />
}

function LiveModuleCard({ m }: { m: RegistryModule }) {
  const status = LIVENESS_STATUS[m.liveness] ?? 'off'
  return (
    <ConfigCard status={status}>
      <div className="cc-card__head">
        <div>
          <p className="cc-card__eyebrow">{m.hardware_type} · protocol {m.protocol}</p>
          <h3 className="cc-card__title">{m.module_id}</h3>
        </div>
        {typeIcon(m.hardware_type)}
      </div>
      <div className="cc-card__body">
        <div className="cc-kv">
          <span className="cc-kv__k">Status</span>
          <span className="cc-kv__v">
            <Dot status={status} />
            {LIVENESS_LABEL[m.liveness] ?? m.liveness}
          </span>
        </div>
        <div className="cc-kv">
          <span className="cc-kv__k">Heartbeat</span>
          <span className="cc-kv__v">
            {m.heartbeat_age_s == null ? '—' : `${m.heartbeat_age_s.toFixed(1)} s ago`}
          </span>
        </div>
        <div className="cc-kv">
          <span className="cc-kv__k">Namespace</span>
          <span className="cc-kv__v"><code>{m.namespace}</code></span>
        </div>
        <div className="cc-kv">
          <span className="cc-kv__k">Capabilities</span>
          <span className="cc-kv__v">{m.capabilities.join(' · ') || '—'}</span>
        </div>
        <div className="cc-kv">
          <span className="cc-kv__k">Firmware</span>
          <span className="cc-kv__v">{m.fw_version} · sw {m.sw_version}</span>
        </div>
      </div>
      <div className="cc-card__foot">
        <p className="cc-card__meta">registered with the Core Hub module-registry</p>
      </div>
    </ConfigCard>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

const POLL_MS = 5000

export function Modules() {
  const [modalOpen, setModalOpen] = useState(false)
  const [toast, setToast] = useState(false)
  const [modules, setModules] = useState<RegistryModule[] | null>(null)
  const [regError, setRegError] = useState<string | null>(null)

  const openModal  = useCallback(() => setModalOpen(true),  [])
  const closeModal = useCallback(() => setModalOpen(false), [])

  // "Got it" — close the modal and fire the informational toast.
  const handleGotIt = useCallback(() => {
    setModalOpen(false)
    setToast(true)
    setTimeout(() => setToast(false), 6000)
  }, [])

  // Live registry poll.
  useEffect(() => {
    let alive = true
    const load = () =>
      modulesRegistry()
        .then((snap) => {
          if (!alive) return
          setModules(snap.modules)
          setRegError(null)
        })
        .catch((e: Error) => {
          if (!alive) return
          setRegError(e.message)
        })
    load()
    const t = setInterval(load, POLL_MS)
    return () => { alive = false; clearInterval(t) }
  }, [])

  return (
    <div className="cc-page">

      {/* ── Toast (fixed, floats above page chrome) ───────────────────────── */}
      {toast && (
        <div style={{ position: 'fixed', top: '3.75rem', right: '1.5rem', zIndex: 9000 }}>
          <ToastNotification
            kind="info"
            title="Registration is automatic"
            subtitle="Modules self-register when they connect via the ROS module-agent — no manual enrollment needed."
            timeout={6000}
            onCloseButtonClick={() => setToast(false)}
          />
        </div>
      )}

      {/* ── Page header ────────────────────────────────────────────────────── */}
      <header className="cc-pagehead">
        <p className="cc-pagehead__eyebrow">Modules</p>
        <div className="cc-pagehead__row">
          <div>
            <h1 className="cc-pagehead__title">Module registry</h1>
            <p className="cc-pagehead__sub">
              Every module that registers with the Core Hub, with live liveness
              from its 5 Hz heartbeat.
            </p>
          </div>
          <Button kind="primary" size="md" renderIcon={Add} onClick={openModal}>
            Register module
          </Button>
        </div>
      </header>

      {/* ── Live registry ──────────────────────────────────────────────────── */}
      <section className="cc-section">
        <h2 className="cc-section__title">Registered with the Core Hub</h2>
        {regError && (
          <InlineNotification
            kind="warning"
            lowContrast
            hideCloseButton
            title="Registry unreachable"
            subtitle={`Live data unavailable — ${regError}`}
            style={{ marginBottom: 'var(--cds-spacing-05)' }}
          />
        )}
        {modules === null && !regError && (
          <SkeletonPlaceholder style={{ width: '100%', height: '10rem' }} />
        )}
        {modules !== null && modules.length === 0 && (
          <ConfigCard status="off">
            <div className="cc-card__head">
              <div>
                <p className="cc-card__eyebrow">registry empty</p>
                <h3 className="cc-card__title">No modules registered</h3>
              </div>
              <Chip size={20} className="cc-card__icon" />
            </div>
            <div className="cc-card__body">
              <p style={{ fontSize: '0.875rem', lineHeight: '1.5rem', color: 'var(--cds-text-secondary)' }}>
                Modules self-register when they connect and are configured by the
                Core Hub. The registry is in-memory — it clears when the Core Hub
                restarts, and repopulates as modules re-register.
              </p>
            </div>
          </ConfigCard>
        )}
        {modules !== null && modules.length > 0 && (
          <div className="cc-grid">
            {modules.map((m) => <LiveModuleCard key={m.module_id} m={m} />)}
          </div>
        )}
      </section>

      {/* ── Planned hardware (not yet connected) ───────────────────────────── */}
      <section className="cc-section">
        <h2 className="cc-section__title">Planned · not yet connected</h2>
        <div className="cc-grid">

          {/* ── Environmental sensors (Research Deck) ────────────────────── */}
          <ConfigCard status="off">
            <div className="cc-card__head">
              <div>
                <p className="cc-card__eyebrow">Research Deck</p>
                <h3 className="cc-card__title">Environmental sensors</h3>
              </div>
              <Microscope size={20} className="cc-card__icon" />
            </div>
            <div className="cc-card__body">
              <div className="cc-kv">
                <span className="cc-kv__k">Status</span>
                <span className="cc-kv__v"><Dot status="off" />off · pending</span>
              </div>
              <div className="cc-kv">
                <span className="cc-kv__k">Sensors</span>
                <span className="cc-kv__v">camera · IMU · GPS · mmWave</span>
              </div>
            </div>
            <div className="cc-card__foot">
              <p className="cc-card__meta">arrives with the Research Deck</p>
            </div>
          </ConfigCard>

          {/* ── Telemetry Gateway ─────────────────────────────────────────── */}
          <ConfigCard status="off">
            <div className="cc-card__head">
              <div>
                <p className="cc-card__eyebrow">Pi 3B+</p>
                <h3 className="cc-card__title">Telemetry Gateway</h3>
              </div>
              <Satellite size={20} className="cc-card__icon" />
            </div>
            <div className="cc-card__body">
              <div className="cc-kv">
                <span className="cc-kv__k">Status</span>
                <span className="cc-kv__v"><Dot status="off" />off · not connected</span>
              </div>
            </div>
            <div className="cc-card__foot">
              <p className="cc-card__meta">gateway image not built</p>
            </div>
          </ConfigCard>

        </div>
      </section>

      {/* ── Register module modal ─────────────────────────────────────────────── */}
      <ComposedModal open={modalOpen} onClose={closeModal} size="sm">
        <ModalHeader label="Modules" title="Register a module" />
        <ModalBody>
          <p style={{ fontSize: '0.875rem', lineHeight: '1.5rem', marginBottom: 'var(--cds-spacing-05)', color: 'var(--cds-text-primary)' }}>
            Registration is <strong>automatic</strong>. When a module connects to
            the Core Hub via micro-ROS or UART, it fires a RegisterModule request
            during its lifecycle <code>configure</code> step and enrolls itself in
            the registry.
          </p>
          <p style={{ fontSize: '0.875rem', lineHeight: '1.5rem', color: 'var(--cds-text-secondary)' }}>
            To bring a new module online: flash its firmware with the correct{' '}
            <code>DOMAIN_ID</code> and <code>MODULE_ID</code>, then connect it
            to the Core Hub. No manual enrollment step is needed — the module
            will appear here automatically.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button kind="secondary" onClick={closeModal}>Cancel</Button>
          <Button kind="primary" onClick={handleGotIt}>Got it</Button>
        </ModalFooter>
      </ComposedModal>

    </div>
  )
}
