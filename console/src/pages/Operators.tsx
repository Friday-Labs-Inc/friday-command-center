// Operators — Access page (routed at /access).
// Three cc-section DataTablePanel panels: operator registry, certificates, revocations.
// Mutations: operator revoke, certificate issue, certificate revoke, lift revocation.
// All mutations fire a ToastNotification on success/failure and reload affected tables.

import { useState, useCallback } from 'react'
import {
  ActionableNotification,
  Button,
  ComposedModal,
  DatePicker,
  DatePickerInput,
  InlineLoading,
  InlineNotification,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  OverflowMenu,
  OverflowMenuItem,
  RadioButton,
  RadioButtonGroup,
  Select,
  SelectItem,
  Tag,
  TextArea,
  TextInput,
  ToastNotification,
} from '@carbon/react'
import { Add } from '@carbon/icons-react'
import { DataTablePanel } from '../components/DataTablePanel'
import { StatusTag } from '../components/StatusTag'
import { useAsync } from '../lib/useAsync'
import * as api from '../lib/api'
import type { Certificate, Operator, Revocation } from '../lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Toast {
  id:       string
  kind:     'success' | 'error'
  title:    string
  subtitle: string
}

// ── Local helpers ─────────────────────────────────────────────────────────────

type DotStatus = 'ok' | 'warn' | 'err' | 'off'
const DOT_CLS: Record<DotStatus, string> = {
  ok:   'cc-dot--ok',
  warn: 'cc-dot--warn',
  err:  'cc-dot--err',
  off:  'cc-dot--off',
}
function Dot({ status }: { status: DotStatus }) {
  return <span className={`cc-dot ${DOT_CLS[status]}`} aria-hidden="true" />
}

function FingerprintCell({ value }: { value: string }) {
  return (
    <code
      title={value}
      style={{
        fontVariantNumeric: 'tabular-nums',
        fontSize:           '0.75rem',
        color:              'var(--cds-text-secondary)',
        display:            'inline-block',
        maxWidth:           '14rem',
        overflow:           'hidden',
        textOverflow:       'ellipsis',
        whiteSpace:         'nowrap',
        verticalAlign:      'bottom',
      }}
    >
      {value || '—'}
    </code>
  )
}

// ── Table headers ─────────────────────────────────────────────────────────────

const OPERATOR_HEADERS = [
  { key: 'operator_id',     header: 'Operator ID'     },
  { key: 'operator_name',   header: 'Name'            },
  { key: 'status',          header: 'Status'          },
  { key: 'key_fingerprint', header: 'Key fingerprint' },
  { key: 'actions',         header: ''                },
]

const CERT_HEADERS = [
  { key: 'rover',       header: 'Rover'       },
  { key: 'common_name', header: 'Common name' },
  { key: 'serial',      header: 'Serial'      },
  { key: 'fingerprint', header: 'Fingerprint' },
  { key: 'status',      header: 'Status'      },
  { key: 'expires_on',  header: 'Expires'     },
  { key: 'actions',     header: ''            },
]

const REVOCATION_HEADERS = [
  { key: 'operator',   header: 'Operator'  },
  { key: 'scope',      header: 'Scope'     },
  { key: 'rover',      header: 'Rover'     },
  { key: 'status',     header: 'Status'    },
  { key: 'epoch',      header: 'Epoch'     },
  { key: 'revoked_on', header: 'Revoked'   },
  { key: 'reason',     header: 'Reason'    },
  { key: 'actions',    header: ''          },
]

// ── Page ──────────────────────────────────────────────────────────────────────

export function Operators() {

  // ── Data fetching ────────────────────────────────────────────────────────
  const operatorsAsync    = useAsync(() => api.operators(),              [])
  const certificatesAsync = useAsync(() => api.certificates(),           [])
  const revocationsAsync  = useAsync(() => api.revocations(),            [])
  const roversAsync       = useAsync(() => api.rovers(),                 [])
  const certAuthsAsync    = useAsync(() => api.certificateAuthorities(), [])

  // ── Toast management ─────────────────────────────────────────────────────
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback(
    (kind: 'success' | 'error', title: string, subtitle: string) => {
      const id = `${Date.now()}-${Math.random()}`
      setToasts(prev => [...prev, { id, kind, title, subtitle }])
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 6000)
    },
    [],
  )

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  // ── Operator revoke modal ─────────────────────────────────────────────────
  const [revokeOpOpen,   setRevokeOpOpen]   = useState(false)
  const [revokeOpTarget, setRevokeOpTarget] = useState<Operator | null>(null)
  const [revokeOpScope,  setRevokeOpScope]  = useState<'All Rovers' | 'Specific Rover'>('All Rovers')
  const [revokeOpRover,  setRevokeOpRover]  = useState('')
  const [revokeOpReason, setRevokeOpReason] = useState('')
  const [revokeOpBusy,   setRevokeOpBusy]   = useState(false)
  const [revokeOpError,  setRevokeOpError]  = useState<string | null>(null)

  function openRevokeOp(op: Operator) {
    setRevokeOpTarget(op)
    setRevokeOpScope('All Rovers')
    setRevokeOpRover('')
    setRevokeOpReason('')
    setRevokeOpError(null)
    setRevokeOpOpen(true)
  }

  function closeRevokeOp() {
    if (revokeOpBusy) return
    setRevokeOpOpen(false)
    setRevokeOpTarget(null)
  }

  async function submitRevokeOp() {
    if (!revokeOpTarget || revokeOpBusy) return
    if (!revokeOpReason.trim()) { setRevokeOpError('A reason is required.'); return }
    if (revokeOpScope === 'Specific Rover' && !revokeOpRover) {
      setRevokeOpError('Select a rover when using Specific Rover scope.')
      return
    }
    setRevokeOpBusy(true)
    setRevokeOpError(null)
    try {
      await api.revokeOperator({
        operator: revokeOpTarget.name,
        scope:    revokeOpScope,
        reason:   revokeOpReason.trim(),
        ...(revokeOpScope === 'Specific Rover' ? { rover: revokeOpRover } : {}),
      })
      setRevokeOpOpen(false)
      addToast(
        'success',
        'Access revoked',
        `${revokeOpTarget.operator_name} revoked across ${revokeOpScope === 'All Rovers' ? 'all rovers' : revokeOpRover}.`,
      )
      operatorsAsync.reload()
      revocationsAsync.reload()
    } catch (e) {
      setRevokeOpError(e instanceof Error ? e.message : String(e))
    } finally {
      setRevokeOpBusy(false)
    }
  }

  // ── Certificate issue modal ───────────────────────────────────────────────
  const [issueCertOpen,   setIssueCertOpen]   = useState(false)
  const [certRover,       setCertRover]       = useState('')
  const [certCa,          setCertCa]          = useState('')
  const [certSerial,      setCertSerial]      = useState('')
  const [certFingerprint, setCertFingerprint] = useState('')
  const [certExpiresOn,   setCertExpiresOn]   = useState('')
  const [certPem,         setCertPem]         = useState('')
  const [issueCertBusy,   setIssueCertBusy]   = useState(false)
  const [issueCertError,  setIssueCertError]  = useState<string | null>(null)

  function openIssueCert() {
    setCertRover('')
    setCertCa('')
    setCertSerial('')
    setCertFingerprint('')
    setCertExpiresOn('')
    setCertPem('')
    setIssueCertError(null)
    setIssueCertOpen(true)
  }

  function closeIssueCert() {
    if (issueCertBusy) return
    setIssueCertOpen(false)
  }

  async function submitIssueCert() {
    if (issueCertBusy) return
    setIssueCertError(null)
    if (!certRover)              { setIssueCertError('Select a rover.'); return }
    if (!certCa)                 { setIssueCertError('Select an issuing CA.'); return }
    if (!certSerial.trim())      { setIssueCertError('Serial is required.'); return }
    if (!certFingerprint.trim()) { setIssueCertError('Fingerprint is required.'); return }
    if (!certExpiresOn)          { setIssueCertError('Expiry date is required.'); return }
    if (!certPem.trim())         { setIssueCertError('Certificate PEM is required.'); return }
    setIssueCertBusy(true)
    try {
      const created = await api.issueCertificate({
        rover:        certRover,
        cert_pem:     certPem.trim(),
        serial:       certSerial.trim(),
        fingerprint:  certFingerprint.trim(),
        expires_on:   certExpiresOn,
        issuing_ca:   certCa,
      })
      setIssueCertOpen(false)
      addToast('success', 'Certificate issued', `${created.common_name} recorded for ${created.rover}.`)
      certificatesAsync.reload()
    } catch (e) {
      setIssueCertError(e instanceof Error ? e.message : String(e))
    } finally {
      setIssueCertBusy(false)
    }
  }

  // ── Certificate revoke modal ──────────────────────────────────────────────
  const [revokeCertOpen,   setRevokeCertOpen]   = useState(false)
  const [revokeCertTarget, setRevokeCertTarget] = useState<Certificate | null>(null)
  const [revokeCertReason, setRevokeCertReason] = useState('')
  const [revokeCertBusy,   setRevokeCertBusy]   = useState(false)
  const [revokeCertError,  setRevokeCertError]  = useState<string | null>(null)

  function openRevokeCert(cert: Certificate) {
    setRevokeCertTarget(cert)
    setRevokeCertReason('')
    setRevokeCertError(null)
    setRevokeCertOpen(true)
  }

  function closeRevokeCert() {
    if (revokeCertBusy) return
    setRevokeCertOpen(false)
    setRevokeCertTarget(null)
  }

  async function submitRevokeCert() {
    if (!revokeCertTarget || revokeCertBusy) return
    if (!revokeCertReason.trim()) { setRevokeCertError('A reason is required.'); return }
    setRevokeCertBusy(true)
    setRevokeCertError(null)
    try {
      await api.revokeCertificate(revokeCertTarget.name, revokeCertReason.trim())
      setRevokeCertOpen(false)
      addToast('success', 'Certificate revoked', `${revokeCertTarget.common_name} has been revoked.`)
      certificatesAsync.reload()
    } catch (e) {
      setRevokeCertError(e instanceof Error ? e.message : String(e))
    } finally {
      setRevokeCertBusy(false)
    }
  }

  // ── Lift revocation modal ─────────────────────────────────────────────────
  const [liftOpen,   setLiftOpen]   = useState(false)
  const [liftTarget, setLiftTarget] = useState<Revocation | null>(null)
  const [liftBusy,   setLiftBusy]   = useState(false)
  const [liftError,  setLiftError]  = useState<string | null>(null)

  function openLift(rev: Revocation) {
    setLiftTarget(rev)
    setLiftError(null)
    setLiftOpen(true)
  }

  function closeLift() {
    if (liftBusy) return
    setLiftOpen(false)
    setLiftTarget(null)
  }

  async function submitLift() {
    if (!liftTarget || liftBusy) return
    setLiftBusy(true)
    setLiftError(null)
    try {
      await api.liftRevocation(liftTarget.name)
      setLiftOpen(false)
      addToast('success', 'Revocation lifted', `Access restored for ${liftTarget.operator}.`)
      revocationsAsync.reload()
      operatorsAsync.reload()
    } catch (e) {
      setLiftError(e instanceof Error ? e.message : String(e))
    } finally {
      setLiftBusy(false)
    }
  }

  // ── Derived display values ────────────────────────────────────────────────
  const activeOpCount  = (operatorsAsync.data  ?? []).filter(o => o.status === 'Active').length
  const activeRevCount = (revocationsAsync.data ?? []).filter(r => r.status === 'Active').length

  // ── Row data ──────────────────────────────────────────────────────────────
  const operatorRows = (operatorsAsync.data ?? []).map(op => ({
    id:               op.name,
    operator_id:      op.operator_id,
    operator_name:    op.operator_name,
    status:           <StatusTag status={op.status} />,
    key_fingerprint:  <FingerprintCell value={op.key_fingerprint} />,
    actions: (
      <OverflowMenu flipped size="sm" iconDescription="Operator actions">
        <OverflowMenuItem itemText="Revoke access" isDelete onClick={() => openRevokeOp(op)} />
      </OverflowMenu>
    ),
  }))

  const certRows = (certificatesAsync.data ?? []).map(cert => ({
    id:          cert.name,
    rover:       cert.rover,
    common_name: cert.common_name,
    serial:      cert.serial,
    fingerprint: <FingerprintCell value={cert.fingerprint} />,
    status:      <StatusTag status={cert.status} />,
    expires_on:  cert.expires_on,
    actions:     cert.status === 'Active' ? (
      <OverflowMenu flipped size="sm" iconDescription="Certificate actions">
        <OverflowMenuItem itemText="Revoke" isDelete onClick={() => openRevokeCert(cert)} />
      </OverflowMenu>
    ) : null,
  }))

  const revocationRows = (revocationsAsync.data ?? []).map(rev => ({
    id:         rev.name,
    operator:   rev.operator,
    scope:      rev.scope,
    rover:      rev.rover ?? '—',
    status:     <StatusTag status={rev.status} />,
    epoch:      rev.epoch,
    revoked_on: rev.revoked_on,
    reason:     rev.reason,
    actions:    rev.status === 'Active' ? (
      <Button kind="ghost" size="sm" onClick={() => openLift(rev)}>Lift</Button>
    ) : null,
  }))

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="cc-page">

      {/* ── Toast container ──────────────────────────────────────────────── */}
      <div
        role="region"
        aria-label="Action notifications"
        aria-live="polite"
        style={{
          position:      'fixed',
          top:           'calc(3rem + var(--cds-spacing-05))',
          right:         'var(--cds-spacing-05)',
          zIndex:        9000,
          display:       'flex',
          flexDirection: 'column',
          gap:           'var(--cds-spacing-03)',
          width:         '22rem',
          maxWidth:      'calc(100vw - 2 * var(--cds-spacing-05))',
        }}
      >
        {toasts.map(t => (
          <ToastNotification
            key={t.id}
            kind={t.kind}
            title={t.title}
            subtitle={t.subtitle}
            onCloseButtonClick={() => dismissToast(t.id)}
          />
        ))}
      </div>

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <header className="cc-pagehead">
        <p className="cc-pagehead__eyebrow">Access</p>
        <div className="cc-pagehead__row">
          <div>
            <h1 className="cc-pagehead__title">Operators &amp; keys</h1>
            <p className="cc-pagehead__sub">
              Who may command the rover, and the certificates that secure the link.
            </p>
          </div>
          <Tag type={activeOpCount > 0 ? 'green' : 'gray'} size="md">
            <Dot status={activeOpCount > 0 ? 'ok' : 'off'} />
            {operatorsAsync.loading
              ? '…'
              : `${activeOpCount} active operator${activeOpCount !== 1 ? 's' : ''}`}
          </Tag>
        </div>
      </header>

      {/* ── Section 1: Operators ─────────────────────────────────────────── */}
      <section className="cc-section">
        <div className="cc-section__head">
          <h2 className="cc-section__title">Operators</h2>
          <span className="cc-section__meta">
            {!operatorsAsync.loading && `${operatorsAsync.data?.length ?? 0} registered`}
          </span>
        </div>

        {operatorsAsync.error && (
          <div style={{ marginBottom: 'var(--cds-spacing-05)' }}>
            <ActionableNotification
              kind="error"
              title="Failed to load operators"
              subtitle={operatorsAsync.error.message}
              actionButtonLabel="Retry"
              onActionButtonClick={operatorsAsync.reload}
              hideCloseButton
            />
          </div>
        )}

        <DataTablePanel
          title="Operators"
          description="Registered operators with active signing keys. Use the row menu to revoke access."
          headers={OPERATOR_HEADERS}
          rows={operatorRows}
          loading={operatorsAsync.loading}
          searchable
        />
      </section>

      {/* ── Section 2: Certificates ──────────────────────────────────────── */}
      <section className="cc-section">
        <div className="cc-section__head">
          <h2 className="cc-section__title">Certificates</h2>
          <span className="cc-section__meta">
            {!certificatesAsync.loading && `${certificatesAsync.data?.length ?? 0} total`}
          </span>
        </div>

        {certificatesAsync.error && (
          <div style={{ marginBottom: 'var(--cds-spacing-05)' }}>
            <ActionableNotification
              kind="error"
              title="Failed to load certificates"
              subtitle={certificatesAsync.error.message}
              actionButtonLabel="Retry"
              onActionButtonClick={certificatesAsync.reload}
              hideCloseButton
            />
          </div>
        )}

        <DataTablePanel
          title="Certificates"
          description="Rover TLS certificates. Issue new certificates or revoke compromised ones."
          headers={CERT_HEADERS}
          rows={certRows}
          loading={certificatesAsync.loading}
          searchable
          toolbarActions={
            <Button renderIcon={Add} onClick={openIssueCert} size="sm">
              Issue certificate
            </Button>
          }
        />
      </section>

      {/* ── Section 3: Revocations ───────────────────────────────────────── */}
      <section className="cc-section">
        <div className="cc-section__head">
          <h2 className="cc-section__title">Revocations</h2>
          <span className="cc-section__meta">
            {!revocationsAsync.loading && `${activeRevCount} active`}
          </span>
        </div>

        {revocationsAsync.error && (
          <div style={{ marginBottom: 'var(--cds-spacing-05)' }}>
            <ActionableNotification
              kind="error"
              title="Failed to load revocations"
              subtitle={revocationsAsync.error.message}
              actionButtonLabel="Retry"
              onActionButtonClick={revocationsAsync.reload}
              hideCloseButton
            />
          </div>
        )}

        <DataTablePanel
          title="Revocations"
          description="Active and lifted operator access revocations. Active revocations can be lifted."
          headers={REVOCATION_HEADERS}
          rows={revocationRows}
          loading={revocationsAsync.loading}
          searchable
        />
      </section>

      {/* ── Modal: Revoke operator access (danger) ────────────────────────── */}
      <ComposedModal open={revokeOpOpen} onClose={closeRevokeOp} danger>
        <ModalHeader
          label="Destructive action"
          title={revokeOpTarget
            ? `Revoke access: ${revokeOpTarget.operator_name}`
            : 'Revoke access'}
        />

        <ModalBody hasForm>
          <p style={{ fontSize: '0.875rem', color: 'var(--cds-text-secondary)', marginBottom: 'var(--cds-spacing-06)', lineHeight: '1.5' }}>
            This creates an active revocation that blocks the operator from issuing commands.
            You can lift the revocation later from the Revocations table.
          </p>

          <div style={{ marginBottom: 'var(--cds-spacing-06)' }}>
            <RadioButtonGroup
              name="revoke-op-scope"
              legendText="Scope"
              valueSelected={revokeOpScope}
              onChange={(value) => {
                const v = String(value) as 'All Rovers' | 'Specific Rover'
                setRevokeOpScope(v)
                if (v === 'All Rovers') setRevokeOpRover('')
              }}
            >
              <RadioButton labelText="All Rovers"     value="All Rovers"     id="rop-scope-all"      />
              <RadioButton labelText="Specific Rover" value="Specific Rover" id="rop-scope-specific" />
            </RadioButtonGroup>
          </div>

          <div style={{ marginBottom: 'var(--cds-spacing-06)' }}>
            <Select
              id="rop-rover"
              labelText="Rover"
              disabled={revokeOpScope !== 'Specific Rover'}
              value={revokeOpRover}
              onChange={(e) => setRevokeOpRover(e.target.value)}
            >
              <SelectItem value="" text="— select a rover —" />
              {(roversAsync.data ?? []).map(r => (
                <SelectItem key={r.name} value={r.name} text={r.rover_name || r.rover_id} />
              ))}
            </Select>
          </div>

          <div style={{ marginBottom: revokeOpError ? 'var(--cds-spacing-05)' : 0 }}>
            <TextArea
              id="rop-reason"
              labelText="Reason"
              placeholder="Describe why access is being revoked…"
              value={revokeOpReason}
              onChange={(e) => setRevokeOpReason(e.target.value)}
              rows={3}
            />
          </div>

          {revokeOpError && (
            <InlineNotification
              kind="error"
              title="Cannot revoke — "
              subtitle={revokeOpError}
              hideCloseButton
            />
          )}
        </ModalBody>

        <ModalFooter>
          <Button kind="secondary" onClick={closeRevokeOp} disabled={revokeOpBusy}>
            Cancel
          </Button>
          <Button
            kind="danger"
            onClick={submitRevokeOp}
            disabled={
              revokeOpBusy ||
              !revokeOpReason.trim() ||
              (revokeOpScope === 'Specific Rover' && !revokeOpRover)
            }
          >
            {revokeOpBusy ? <InlineLoading description="Revoking…" /> : 'Revoke access'}
          </Button>
        </ModalFooter>
      </ComposedModal>

      {/* ── Modal: Issue certificate ──────────────────────────────────────── */}
      <ComposedModal open={issueCertOpen} onClose={closeIssueCert} size="md">
        <ModalHeader label="Certificate management" title="Issue certificate" />

        <ModalBody hasForm>
          <p style={{ fontSize: '0.875rem', color: 'var(--cds-text-secondary)', marginBottom: 'var(--cds-spacing-06)', lineHeight: '1.5' }}>
            Register a certificate issued by your certificate authority. Paste the full PEM block below.
          </p>

          <div style={{ marginBottom: 'var(--cds-spacing-05)' }}>
            <Select
              id="ic-rover"
              labelText="Rover"
              value={certRover}
              onChange={(e) => setCertRover(e.target.value)}
            >
              <SelectItem value="" text="Select a rover…" />
              {(roversAsync.data ?? []).map(r => (
                <SelectItem key={r.name} value={r.name} text={r.rover_name || r.rover_id} />
              ))}
            </Select>
          </div>

          <div style={{ marginBottom: 'var(--cds-spacing-05)' }}>
            <Select
              id="ic-ca"
              labelText="Issuing CA"
              value={certCa}
              onChange={(e) => setCertCa(e.target.value)}
            >
              <SelectItem value="" text="Select a certificate authority…" />
              {(certAuthsAsync.data ?? []).map(ca => (
                <SelectItem key={ca.name} value={ca.name} text={ca.common_name || ca.name} />
              ))}
            </Select>
          </div>

          <div style={{ marginBottom: 'var(--cds-spacing-05)' }}>
            <TextInput
              id="ic-serial"
              labelText="Serial"
              placeholder="e.g. 01:AB:CD:EF:…"
              value={certSerial}
              onChange={(e) => setCertSerial(e.target.value)}
            />
          </div>

          <div style={{ marginBottom: 'var(--cds-spacing-05)' }}>
            <TextInput
              id="ic-fingerprint"
              labelText="Fingerprint (SHA-256)"
              placeholder="SHA256:…"
              value={certFingerprint}
              onChange={(e) => setCertFingerprint(e.target.value)}
            />
          </div>

          {/* key forces Flatpickr to remount on each modal open, resetting the picker */}
          <div style={{ marginBottom: 'var(--cds-spacing-05)' }}>
            <DatePicker
              key={issueCertOpen ? 'open' : 'closed'}
              datePickerType="single"
              dateFormat="Y-m-d"
              onChange={(dates: Date[]) => {
                const d = dates[0]
                if (d) {
                  const y   = d.getFullYear()
                  const mon = String(d.getMonth() + 1).padStart(2, '0')
                  const day = String(d.getDate()).padStart(2, '0')
                  setCertExpiresOn(`${y}-${mon}-${day}`)
                } else {
                  setCertExpiresOn('')
                }
              }}
            >
              <DatePickerInput
                id="ic-expires-on"
                labelText="Expires on"
                placeholder="YYYY-MM-DD"
              />
            </DatePicker>
          </div>

          <div style={{ marginBottom: issueCertError ? 'var(--cds-spacing-05)' : 0 }}>
            <TextArea
              id="ic-cert-pem"
              labelText="Certificate PEM"
              placeholder={'-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----'}
              rows={6}
              value={certPem}
              onChange={(e) => setCertPem(e.target.value)}
            />
          </div>

          {issueCertError && (
            <InlineNotification
              kind="error"
              title="Cannot issue — "
              subtitle={issueCertError}
              hideCloseButton
            />
          )}
        </ModalBody>

        <ModalFooter>
          <Button kind="secondary" onClick={closeIssueCert} disabled={issueCertBusy}>
            Cancel
          </Button>
          <Button kind="primary" onClick={submitIssueCert} disabled={issueCertBusy}>
            {issueCertBusy ? <InlineLoading description="Issuing…" /> : 'Issue certificate'}
          </Button>
        </ModalFooter>
      </ComposedModal>

      {/* ── Modal: Revoke certificate (danger) ───────────────────────────── */}
      <ComposedModal open={revokeCertOpen} onClose={closeRevokeCert} danger>
        <ModalHeader
          label="Destructive action"
          title={revokeCertTarget
            ? `Revoke certificate: ${revokeCertTarget.common_name}`
            : 'Revoke certificate'}
        />

        <ModalBody hasForm>
          <p style={{ fontSize: '0.875rem', color: 'var(--cds-text-secondary)', marginBottom: 'var(--cds-spacing-05)', lineHeight: '1.5' }}>
            Revoking a certificate permanently blocks the rover from authenticating with it.
            This action cannot be undone.
          </p>

          {revokeCertTarget && (
            <div style={{ marginBottom: 'var(--cds-spacing-06)' }}>
              <div className="cc-kv">
                <span className="cc-kv__k">Rover</span>
                <span className="cc-kv__v">{revokeCertTarget.rover}</span>
              </div>
              <div className="cc-kv">
                <span className="cc-kv__k">Serial</span>
                <span className="cc-kv__v"><code>{revokeCertTarget.serial}</code></span>
              </div>
              <div className="cc-kv">
                <span className="cc-kv__k">Expires</span>
                <span className="cc-kv__v">{revokeCertTarget.expires_on}</span>
              </div>
            </div>
          )}

          <div style={{ marginBottom: revokeCertError ? 'var(--cds-spacing-05)' : 0 }}>
            <TextArea
              id="rc-reason"
              labelText="Reason"
              placeholder="Describe why this certificate is being revoked…"
              value={revokeCertReason}
              onChange={(e) => setRevokeCertReason(e.target.value)}
              rows={3}
            />
          </div>

          {revokeCertError && (
            <InlineNotification
              kind="error"
              title="Cannot revoke — "
              subtitle={revokeCertError}
              hideCloseButton
            />
          )}
        </ModalBody>

        <ModalFooter>
          <Button kind="secondary" onClick={closeRevokeCert} disabled={revokeCertBusy}>
            Cancel
          </Button>
          <Button
            kind="danger"
            onClick={submitRevokeCert}
            disabled={revokeCertBusy || !revokeCertReason.trim()}
          >
            {revokeCertBusy ? <InlineLoading description="Revoking…" /> : 'Revoke certificate'}
          </Button>
        </ModalFooter>
      </ComposedModal>

      {/* ── Modal: Lift revocation ────────────────────────────────────────── */}
      <Modal
        open={liftOpen}
        modalHeading="Lift revocation"
        primaryButtonText={liftBusy ? 'Lifting…' : 'Lift revocation'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={liftBusy}
        onRequestClose={closeLift}
        onRequestSubmit={submitLift}
      >
        <p style={{ fontSize: '0.875rem', marginBottom: 'var(--cds-spacing-05)', lineHeight: '1.5' }}>
          Lift the active revocation for operator{' '}
          <strong>{liftTarget?.operator}</strong>? Their access will be governed by
          the existing allowlist entries again.
        </p>

        {liftTarget && (
          <div style={{ marginBottom: 'var(--cds-spacing-05)' }}>
            <div className="cc-kv">
              <span className="cc-kv__k">Scope</span>
              <span className="cc-kv__v">{liftTarget.scope}</span>
            </div>
            {liftTarget.rover && (
              <div className="cc-kv">
                <span className="cc-kv__k">Rover</span>
                <span className="cc-kv__v">{liftTarget.rover}</span>
              </div>
            )}
            <div className="cc-kv">
              <span className="cc-kv__k">Revoked by</span>
              <span className="cc-kv__v">{liftTarget.revoked_by}</span>
            </div>
            <div className="cc-kv">
              <span className="cc-kv__k">Reason</span>
              <span className="cc-kv__v">{liftTarget.reason}</span>
            </div>
          </div>
        )}

        {liftError && (
          <InlineNotification
            kind="error"
            title="Cannot lift revocation — "
            subtitle={liftError}
            hideCloseButton
          />
        )}
      </Modal>

    </div>
  )
}
