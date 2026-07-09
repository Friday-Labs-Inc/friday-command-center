// Modules — module registry for the Friday Labs OS control panel.
// Shows every module configured to connect to the Core Hub, with live status
// for the ones actively reporting. Registration is automatic via the ROS
// module-agent; the "Register module" button surfaces that explanation.

import { useState, useCallback } from 'react'
import {
  Button,
  ComposedModal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ToastNotification,
} from '@carbon/react'
import { Add, Chip, Microscope, Rocket, Satellite } from '@carbon/icons-react'
import { ConfigCard, type CardStatus } from '../components/ConfigCard'

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

// ── Page ─────────────────────────────────────────────────────────────────────

export function Modules() {
  const [modalOpen, setModalOpen]   = useState(false)
  const [toast,     setToast]       = useState(false)

  const openModal  = useCallback(() => setModalOpen(true),  [])
  const closeModal = useCallback(() => setModalOpen(false), [])

  // "Got it" — close the modal and fire the informational toast.
  const handleGotIt = useCallback(() => {
    setModalOpen(false)
    setToast(true)
    setTimeout(() => setToast(false), 6000)
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
              Every module that registers with the Core Hub.
            </p>
          </div>
          <Button kind="tertiary" renderIcon={Add} onClick={openModal}>
            Register module
          </Button>
        </div>
      </header>

      {/* ── Modules ─────────────────────────────────────────────────────────── */}
      <section className="cc-section">
        <div className="cc-section__head">
          <h2 className="cc-section__title">Modules</h2>
          <span className="cc-section__meta">4 configured · 1 live</span>
        </div>
        <div className="cc-grid cc-grid--2">

          {/* ── Locomotion Control Unit ───────────────────────────────────── */}
          <ConfigCard status="ok">
            <div className="cc-card__head">
              <div>
                <p className="cc-card__eyebrow">ESP32-WROOM-32 · MARK1-LOCO</p>
                <h3 className="cc-card__title">Locomotion Control Unit</h3>
              </div>
              <Chip size={20} className="cc-card__icon" />
            </div>
            <div className="cc-card__body">
              <div className="cc-kv">
                <span className="cc-kv__k">Status</span>
                <span className="cc-kv__v"><Dot status="ok" />Live · bench</span>
              </div>
              <div className="cc-kv">
                <span className="cc-kv__k">Transport</span>
                <span className="cc-kv__v">micro-ROS · UART @115200</span>
              </div>
              <div className="cc-kv">
                <span className="cc-kv__k">Capabilities</span>
                <span className="cc-kv__v">drive · steer · safe-stop</span>
              </div>
              <div className="cc-kv">
                <span className="cc-kv__k">Heartbeat</span>
                <span className="cc-kv__v">1 Hz</span>
              </div>
              <div className="cc-kv">
                <span className="cc-kv__k">Domain</span>
                <span className="cc-kv__v">ROS 42</span>
              </div>
            </div>
            <div className="cc-card__foot">
              <p className="cc-card__meta">
                board <code>8c:94:df</code> on the Core Hub graph
              </p>
            </div>
          </ConfigCard>

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

          {/* ── Aerial Companion Bay ──────────────────────────────────────── */}
          <ConfigCard status="off">
            <div className="cc-card__head">
              <div>
                <p className="cc-card__eyebrow">ESP32-S3 · planned</p>
                <h3 className="cc-card__title">Aerial Companion Bay</h3>
              </div>
              <Rocket size={20} className="cc-card__icon" />
            </div>
            <div className="cc-card__body">
              <div className="cc-kv">
                <span className="cc-kv__k">Status</span>
                <span className="cc-kv__v"><Dot status="off" />off · spec only</span>
              </div>
            </div>
            <div className="cc-card__foot">
              <p className="cc-card__meta">V-cradle · servo lock · 8 interlocks</p>
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
            the Core Hub via micro-ROS or UART, the ROS module-agent reads its
            capability advertisement and enrolls it in the registry within one
            heartbeat interval.
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
