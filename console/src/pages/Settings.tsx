// Settings — read-only view of Command Center protocol and broker configuration.
// Redesigned to the cc-* design-system DNA (Overview pattern):
//   cc-pagehead header · cc-section + cc-grid + ConfigCard · cc-kv rows.

import { Tag, InlineNotification, SkeletonText } from '@carbon/react'
import { Settings as SettingsIcon, GatewayApi, Wifi } from '@carbon/icons-react'
import { useAsync } from '../lib/useAsync'
import { useLiveStore } from '../lib/store'
import { ConfigCard, type CardStatus } from '../components/ConfigCard'
import * as api from '../lib/api'

function Dot({ status }: { status: CardStatus }) {
  const cls = {
    ok: 'cc-dot--ok',
    warn: 'cc-dot--warn',
    err: 'cc-dot--err',
    off: 'cc-dot--off',
  }[status]
  return <span className={`cc-dot ${cls}`} aria-hidden="true" />
}

export function Settings() {
  const { data, loading, error } = useAsync(() => api.settings(), [])
  const { connected } = useLiveStore()

  const gatewayOrigin = typeof window !== 'undefined' ? window.location.origin : '—'

  // Derive a single card status for the two data cards.
  // loading → off (not yet known); error → err; data present → ok.
  const dataStatus: CardStatus = loading ? 'off' : error ? 'err' : 'ok'

  return (
    <div className="cc-page">

      {/* ── Page header ───────────────────────────────────────────────────── */}
      <header className="cc-pagehead">
        <p className="cc-pagehead__eyebrow">System</p>
        <div className="cc-pagehead__row">
          <div>
            <h1 className="cc-pagehead__title">Command Center settings</h1>
            <p className="cc-pagehead__sub">
              Protocol, broker, and timing for the signed command boundary.
            </p>
          </div>
          <Tag type={connected ? 'green' : 'gray'} size="md">
            <Dot status={connected ? 'ok' : 'off'} />
            {connected ? 'Command link live' : 'Command link offline'}
          </Tag>
        </div>
      </header>

      {/* ── Read-only banner ──────────────────────────────────────────────── */}
      <div style={{ marginBottom: 'var(--cds-spacing-06)' }}>
        <InlineNotification
          lowContrast
          hideCloseButton
          kind="info"
          title="Read-only"
          subtitle="Managed in the control plane (Frappe). Edit there."
        />
      </div>

      {/* ── Fetch error ───────────────────────────────────────────────────── */}
      {error && (
        <div style={{ marginBottom: 'var(--cds-spacing-06)' }}>
          <InlineNotification
            kind="error"
            title="Could not load settings — "
            subtitle={error.message}
            lowContrast
          />
        </div>
      )}

      {/* ── Protocol & broker ─────────────────────────────────────────────── */}
      <section className="cc-section">
        <div className="cc-section__head">
          <h2 className="cc-section__title">Protocol &amp; broker</h2>
          <span className="cc-section__meta">read-only · managed in Frappe</span>
        </div>
        <div className="cc-grid cc-grid--2">

          {/* Card 1 — Wire protocol */}
          <ConfigCard status={dataStatus}>
            <div className="cc-card__head">
              <div>
                <p className="cc-card__eyebrow">Command envelope</p>
                <h3 className="cc-card__title">Wire protocol</h3>
              </div>
              <SettingsIcon size={20} className="cc-card__icon" />
            </div>
            <div className="cc-card__body">
              {loading ? (
                <SkeletonText paragraph lineCount={4} />
              ) : (
                <>
                  <div className="cc-kv">
                    <span className="cc-kv__k">Protocol version</span>
                    <span className="cc-kv__v">{data?.protocol_major}</span>
                  </div>
                  <div className="cc-kv">
                    <span className="cc-kv__k">Command expiry</span>
                    <span className="cc-kv__v">{data?.command_expiry_s} s</span>
                  </div>
                  <div className="cc-kv">
                    <span className="cc-kv__k">Clock skew tolerance</span>
                    <span className="cc-kv__v">{data?.clock_skew_tolerance_s} s</span>
                  </div>
                  <div className="cc-kv">
                    <span className="cc-kv__k">Authority lease</span>
                    <span className="cc-kv__v">{data?.default_authority_lease_s} s</span>
                  </div>
                </>
              )}
            </div>
          </ConfigCard>

          {/* Card 2 — Broker */}
          <ConfigCard status={dataStatus}>
            <div className="cc-card__head">
              <div>
                <p className="cc-card__eyebrow">Message broker</p>
                <h3 className="cc-card__title">Broker</h3>
              </div>
              <GatewayApi size={20} className="cc-card__icon" />
            </div>
            <div className="cc-card__body">
              {loading ? (
                <SkeletonText paragraph lineCount={3} />
              ) : (
                <>
                  <div className="cc-kv">
                    <span className="cc-kv__k">Host</span>
                    <span className="cc-kv__v"><code>{data?.broker_host}</code></span>
                  </div>
                  <div className="cc-kv">
                    <span className="cc-kv__k">Port</span>
                    <span className="cc-kv__v">{data?.broker_port}</span>
                  </div>
                  <div className="cc-kv">
                    <span className="cc-kv__k">Transport</span>
                    <span className="cc-kv__v">mTLS · EMQX</span>
                  </div>
                </>
              )}
            </div>
          </ConfigCard>

        </div>
      </section>

      {/* ── Connection ────────────────────────────────────────────────────── */}
      <section className="cc-section">
        <div className="cc-section__head">
          <h2 className="cc-section__title">Connection</h2>
          <span className="cc-section__meta">live WebSocket channel</span>
        </div>
        <div className="cc-grid cc-grid--2">
          <ConfigCard status={connected ? 'ok' : 'off'}>
            <div className="cc-card__head">
              <div>
                <p className="cc-card__eyebrow">Live channel</p>
                <h3 className="cc-card__title">Command link</h3>
              </div>
              <Wifi size={20} className="cc-card__icon" />
            </div>
            <div className="cc-card__body">
              <div className="cc-kv">
                <span className="cc-kv__k">Command link</span>
                <span className="cc-kv__v">{connected ? 'Live' : 'Off'}</span>
              </div>
              <div className="cc-kv">
                <span className="cc-kv__k">Gateway origin</span>
                <span className="cc-kv__v"><code>{gatewayOrigin}</code></span>
              </div>
              <div className="cc-kv">
                <span className="cc-kv__k">Wire format</span>
                <span className="cc-kv__v">CBOR · Ed25519-signed</span>
              </div>
            </div>
          </ConfigCard>
        </div>
      </section>

    </div>
  )
}
