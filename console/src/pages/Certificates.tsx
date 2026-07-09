// Certificates — rover TLS certificates and certificate authority management.
// Layout:
//   1. CA tile row (Layer Tile per CA: name, common_name, status)
//   2. DataTablePanel "Rover Certificates" with status Dropdown filter +
//      "Issue certificate" primary button in toolbar
//   3. ComposedModal: Issue certificate (rover, issuing_ca, serial, fingerprint,
//      expires_on DatePicker, cert_pem TextArea)
//   4. ComposedModal (danger): Revoke certificate (reason TextArea)
// Patterns: useAsync + reload, multi-toast stack, immutable state.

import { useState, useCallback } from 'react'
import {
  ActionableNotification,
  Button,
  Column,
  ComposedModal,
  DatePicker,
  DatePickerInput,
  Dropdown,
  Grid,
  InlineLoading,
  InlineNotification,
  Layer,
  ModalBody,
  ModalFooter,
  ModalHeader,
  OverflowMenu,
  OverflowMenuItem,
  Select,
  SelectItem,
  SkeletonText,
  TextArea,
  TextInput,
  Tile,
  ToastNotification,
} from '@carbon/react'
import { Certificate as CertificateIcon } from '@carbon/icons-react'
import { PageHeader }     from '../components/PageHeader'
import { DataTablePanel } from '../components/DataTablePanel'
import { StatusTag }      from '../components/StatusTag'
import { useAsync }       from '../lib/useAsync'
import * as api           from '../lib/api'
import type { Certificate, CertAuthority, IssueCertBody } from '../lib/api'

// ── Toast ──────────────────────────────────────────────────────────────────────

interface Toast {
  id:       string
  kind:     'success' | 'error'
  title:    string
  subtitle: string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString() } catch { return iso }
}

// ── Status filter ──────────────────────────────────────────────────────────────

const STATUS_ITEMS = ['All', 'Active', 'Revoked'] as const
type StatusFilter = (typeof STATUS_ITEMS)[number]

// ── Table column definitions ───────────────────────────────────────────────────

const CERT_HEADERS = [
  { key: 'rover',       header: 'Rover'       },
  { key: 'common_name', header: 'Common name' },
  { key: 'serial',      header: 'Serial'      },
  { key: 'fingerprint', header: 'Fingerprint' },
  { key: 'status',      header: 'Status'      },
  { key: 'issued_on',   header: 'Issued'      },
  { key: 'expires_on',  header: 'Expires'     },
  { key: 'actions',     header: ''            },
]

// ── Fingerprint cell ───────────────────────────────────────────────────────────

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
      {value}
    </code>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function Certificates() {

  // ── Status filter state ────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All')

  // ── Data fetching ──────────────────────────────────────────────────────────
  const casAsync   = useAsync(() => api.certificateAuthorities(), [])
  const certsAsync = useAsync(
    () => api.certificates(
      statusFilter === 'All' ? undefined : (statusFilter as 'Active' | 'Revoked'),
    ),
    [statusFilter],
  )
  const roversAsync = useAsync(() => api.rovers(), [])

  // ── Toast management ───────────────────────────────────────────────────────
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback(
    (kind: 'success' | 'error', title: string, subtitle: string) => {
      const id = `${Date.now()}-${Math.random()}`
      setToasts(prev => [...prev, { id, kind, title, subtitle }])
      setTimeout(
        () => setToasts(prev => prev.filter(t => t.id !== id)),
        6000,
      )
    },
    [],
  )

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  // ── Issue certificate modal state ──────────────────────────────────────────
  const [issueOpen,        setIssueOpen]        = useState(false)
  const [formRover,        setFormRover]        = useState('')
  const [formIssuingCa,    setFormIssuingCa]    = useState('')
  const [formSerial,       setFormSerial]       = useState('')
  const [formFingerprint,  setFormFingerprint]  = useState('')
  const [formExpiresOn,    setFormExpiresOn]    = useState('')
  const [formCertPem,      setFormCertPem]      = useState('')
  const [issueBusy,        setIssueBusy]        = useState(false)
  const [issueError,       setIssueError]       = useState<string | null>(null)

  function openIssue() {
    setFormRover('')
    setFormIssuingCa('')
    setFormSerial('')
    setFormFingerprint('')
    setFormExpiresOn('')
    setFormCertPem('')
    setIssueError(null)
    setIssueOpen(true)
  }

  function closeIssue() {
    if (issueBusy) return
    setIssueOpen(false)
  }

  async function submitIssue() {
    if (issueBusy) return
    setIssueError(null)

    if (!formRover)              { setIssueError('Select a rover.'); return }
    if (!formIssuingCa)          { setIssueError('Select an issuing CA.'); return }
    if (!formSerial.trim())      { setIssueError('Serial is required.'); return }
    if (!formFingerprint.trim()) { setIssueError('Fingerprint is required.'); return }
    if (!formExpiresOn)          { setIssueError('Expiry date is required.'); return }
    if (!formCertPem.trim())     { setIssueError('Certificate PEM is required.'); return }

    setIssueBusy(true)
    try {
      const body: IssueCertBody = {
        rover:       formRover,
        cert_pem:    formCertPem.trim(),
        serial:      formSerial.trim(),
        fingerprint: formFingerprint.trim(),
        expires_on:  formExpiresOn,
        issuing_ca:  formIssuingCa,
      }
      const created = await api.issueCertificate(body)
      setIssueOpen(false)
      addToast('success', 'Certificate issued', `${created.common_name} recorded for ${created.rover}.`)
      certsAsync.reload()
    } catch (e) {
      setIssueError(e instanceof Error ? e.message : String(e))
    } finally {
      setIssueBusy(false)
    }
  }

  // ── Revoke certificate modal state ─────────────────────────────────────────
  const [revokeOpen,   setRevokeOpen]   = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<Certificate | null>(null)
  const [revokeReason, setRevokeReason] = useState('')
  const [revokeBusy,   setRevokeBusy]   = useState(false)
  const [revokeError,  setRevokeError]  = useState<string | null>(null)

  function openRevoke(cert: Certificate) {
    setRevokeTarget(cert)
    setRevokeReason('')
    setRevokeError(null)
    setRevokeOpen(true)
  }

  function closeRevoke() {
    if (revokeBusy) return
    setRevokeOpen(false)
    setRevokeTarget(null)
  }

  async function submitRevoke() {
    if (!revokeTarget || revokeBusy) return
    if (!revokeReason.trim()) {
      setRevokeError('A reason is required.')
      return
    }
    setRevokeBusy(true)
    setRevokeError(null)
    try {
      await api.revokeCertificate(revokeTarget.name, revokeReason.trim())
      setRevokeOpen(false)
      addToast(
        'success',
        'Certificate revoked',
        `${revokeTarget.common_name} has been revoked.`,
      )
      certsAsync.reload()
    } catch (e) {
      setRevokeError(e instanceof Error ? e.message : String(e))
    } finally {
      setRevokeBusy(false)
    }
  }

  // ── Row data ───────────────────────────────────────────────────────────────
  const certRows = (certsAsync.data ?? []).map(cert => ({
    id:          cert.name,
    rover:       cert.rover,
    common_name: cert.common_name,
    serial:      cert.serial,
    fingerprint: <FingerprintCell value={cert.fingerprint} />,
    status:      <StatusTag status={cert.status} />,
    issued_on:   formatDate(cert.issued_on),
    expires_on:  formatDate(cert.expires_on),
    actions:
      cert.status === 'Active' ? (
        <OverflowMenu flipped size="sm" iconDescription="Certificate actions">
          <OverflowMenuItem
            itemText="Revoke"
            isDelete
            onClick={() => openRevoke(cert)}
          />
        </OverflowMenu>
      ) : null,
  }))

  const caList: CertAuthority[] = casAsync.data ?? []

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="cc-page">

      {/* ── Toast container (fixed top-right, above shell) ─────────────────── */}
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

      <PageHeader
        title="Certificates"
        description="Manage rover TLS certificates and certificate authorities."
        breadcrumbs={[
          { label: 'Friday Command Center', href: '/' },
          { label: 'Certificates' },
        ]}
      />

      {/* ══════════════════════════════════════════════════════════════════════
          Certificate Authorities — tile row
      ═══════════════════════════════════════════════════════════════════════════ */}
      <Grid>
        <Column sm={4} md={8} lg={16}>
          <p
            className="cc-panel-heading"
            style={{ marginBottom: 'var(--cds-spacing-04)' }}
          >
            Certificate Authorities
          </p>

          {casAsync.error && !casAsync.loading && (
            <div style={{ marginBottom: 'var(--cds-spacing-05)' }}>
              <ActionableNotification
                kind="error"
                title="Failed to load certificate authorities"
                subtitle={casAsync.error.message}
                actionButtonLabel="Retry"
                onActionButtonClick={casAsync.reload}
                hideCloseButton
              />
            </div>
          )}

          {/* CA tiles — skeleton while loading */}
          <div
            style={{
              display:      'flex',
              gap:          'var(--cds-spacing-05)',
              flexWrap:     'wrap',
              marginBottom: 'var(--cds-spacing-07)',
            }}
          >
            {casAsync.loading ? (
              [1, 2, 3].map(n => (
                <Layer key={n}>
                  <Tile
                    style={{
                      minWidth:      '14rem',
                      flex:          '1 1 14rem',
                      display:       'flex',
                      flexDirection: 'column',
                      gap:           'var(--cds-spacing-03)',
                    }}
                  >
                    <SkeletonText heading />
                    <SkeletonText width="60%" />
                    <SkeletonText width="30%" />
                  </Tile>
                </Layer>
              ))
            ) : caList.length === 0 ? (
              <p
                style={{
                  color:    'var(--cds-text-secondary)',
                  fontSize: '0.875rem',
                  margin:   0,
                }}
              >
                No certificate authorities configured.
              </p>
            ) : (
              caList.map(ca => (
                <Layer key={ca.name}>
                  <Tile
                    style={{
                      minWidth:      '14rem',
                      flex:          '1 1 14rem',
                      display:       'flex',
                      flexDirection: 'column',
                      gap:           'var(--cds-spacing-03)',
                    }}
                  >
                    <p
                      style={{
                        fontSize:   '0.875rem',
                        fontWeight: 600,
                        color:      'var(--cds-text-primary)',
                        margin:     0,
                      }}
                    >
                      {ca.common_name}
                    </p>
                    <p
                      style={{
                        fontSize: '0.75rem',
                        color:    'var(--cds-text-secondary)',
                        margin:   0,
                      }}
                    >
                      {ca.name}
                    </p>
                    <StatusTag status={ca.status} />
                  </Tile>
                </Layer>
              ))
            )}
          </div>
        </Column>
      </Grid>

      {/* ══════════════════════════════════════════════════════════════════════
          Rover certificates table
      ═══════════════════════════════════════════════════════════════════════════ */}
      <Grid>
        <Column sm={4} md={8} lg={16}>

          {certsAsync.error && !certsAsync.loading && (
            <div style={{ marginBottom: 'var(--cds-spacing-05)' }}>
              <ActionableNotification
                kind="error"
                title="Failed to load certificates"
                subtitle={certsAsync.error.message}
                actionButtonLabel="Retry"
                onActionButtonClick={certsAsync.reload}
                hideCloseButton
              />
            </div>
          )}

          <DataTablePanel
            title="Rover Certificates"
            description="All rover TLS certificates. Filter by status or use the row menu to revoke an active certificate."
            headers={CERT_HEADERS}
            rows={certRows}
            loading={certsAsync.loading}
            searchable
            toolbarActions={
              <div
                style={{
                  display:    'flex',
                  alignItems: 'center',
                  gap:        'var(--cds-spacing-04)',
                  flexShrink: 0,
                }}
              >
                <div style={{ width: '11rem' }}>
                  <Dropdown
                    id="cert-status-filter"
                    titleText="Status"
                    label="All"
                    items={[...STATUS_ITEMS]}
                    selectedItem={statusFilter}
                    onChange={({ selectedItem }) =>
                      setStatusFilter((selectedItem as StatusFilter) ?? 'All')
                    }
                    size="sm"
                  />
                </div>
                <Button
                  kind="primary"
                  renderIcon={CertificateIcon}
                  onClick={openIssue}
                >
                  Issue certificate
                </Button>
              </div>
            }
          />

        </Column>
      </Grid>

      {/* ══════════════════════════════════════════════════════════════════════
          Issue certificate modal
      ═══════════════════════════════════════════════════════════════════════════ */}
      <ComposedModal open={issueOpen} onClose={closeIssue} size="md">
        <ModalHeader label="Certificates" title="Issue certificate" />

        <ModalBody hasForm>

          {/* Rover */}
          <div style={{ marginBottom: 'var(--cds-spacing-05)' }}>
            <Select
              id="issue-rover"
              labelText="Rover"
              value={formRover}
              onChange={e => setFormRover(e.target.value)}
            >
              <SelectItem value="" text="Select a rover…" />
              {(roversAsync.data ?? []).map(r => (
                <SelectItem
                  key={r.name}
                  value={r.name}
                  text={r.rover_name || r.rover_id}
                />
              ))}
            </Select>
          </div>

          {/* Issuing CA */}
          <div style={{ marginBottom: 'var(--cds-spacing-05)' }}>
            <Select
              id="issue-ca"
              labelText="Issuing CA"
              value={formIssuingCa}
              onChange={e => setFormIssuingCa(e.target.value)}
            >
              <SelectItem value="" text="Select a certificate authority…" />
              {(casAsync.data ?? []).map(ca => (
                <SelectItem
                  key={ca.name}
                  value={ca.name}
                  text={ca.common_name || ca.name}
                />
              ))}
            </Select>
          </div>

          {/* Serial */}
          <div style={{ marginBottom: 'var(--cds-spacing-05)' }}>
            <TextInput
              id="issue-serial"
              labelText="Serial"
              placeholder="e.g. 01:AB:CD:EF:…"
              value={formSerial}
              onChange={e => setFormSerial(e.target.value)}
            />
          </div>

          {/* Fingerprint */}
          <div style={{ marginBottom: 'var(--cds-spacing-05)' }}>
            <TextInput
              id="issue-fingerprint"
              labelText="Fingerprint (SHA-256)"
              placeholder="SHA256:…"
              value={formFingerprint}
              onChange={e => setFormFingerprint(e.target.value)}
            />
          </div>

          {/* Expires on — key forces remount on each modal open, resetting Flatpickr */}
          <div style={{ marginBottom: 'var(--cds-spacing-05)' }}>
            <DatePicker
              key={issueOpen ? 'open' : 'closed'}
              datePickerType="single"
              dateFormat="Y-m-d"
              onChange={(dates: Date[]) => {
                const d = dates[0]
                if (d) {
                  const y   = d.getFullYear()
                  const mon = String(d.getMonth() + 1).padStart(2, '0')
                  const day = String(d.getDate()).padStart(2, '0')
                  setFormExpiresOn(`${y}-${mon}-${day}`)
                } else {
                  setFormExpiresOn('')
                }
              }}
            >
              <DatePickerInput
                id="issue-expires-on"
                labelText="Expires on"
                placeholder="YYYY-MM-DD"
              />
            </DatePicker>
          </div>

          {/* Certificate PEM */}
          <div style={{ marginBottom: issueError ? 'var(--cds-spacing-05)' : 0 }}>
            <TextArea
              id="issue-cert-pem"
              labelText="Certificate PEM"
              placeholder={'-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----'}
              rows={6}
              value={formCertPem}
              onChange={e => setFormCertPem(e.target.value)}
            />
          </div>

          {issueError && (
            <InlineNotification
              kind="error"
              title="Cannot issue — "
              subtitle={issueError}
              hideCloseButton
            />
          )}

        </ModalBody>

        <ModalFooter>
          <Button kind="secondary" onClick={closeIssue} disabled={issueBusy}>
            Cancel
          </Button>
          <Button kind="primary" onClick={submitIssue} disabled={issueBusy}>
            {issueBusy
              ? <InlineLoading description="Issuing…" />
              : 'Issue certificate'}
          </Button>
        </ModalFooter>
      </ComposedModal>

      {/* ══════════════════════════════════════════════════════════════════════
          Revoke certificate modal (danger)
      ═══════════════════════════════════════════════════════════════════════════ */}
      <ComposedModal
        open={revokeOpen}
        onClose={closeRevoke}
        danger
      >
        <ModalHeader
          label="Destructive action"
          title={
            revokeTarget
              ? `Revoke certificate: ${revokeTarget.common_name}`
              : 'Revoke certificate'
          }
        />

        <ModalBody>
          <p
            style={{
              fontSize:     '0.875rem',
              color:        'var(--cds-text-secondary)',
              marginBottom: 'var(--cds-spacing-06)',
              lineHeight:   '1.5',
            }}
          >
            Revoking a certificate is permanent. The rover will lose TLS
            authentication capability until a replacement certificate is issued.
          </p>

          {revokeTarget && (
            <dl
              style={{
                fontSize:            '0.75rem',
                color:               'var(--cds-text-secondary)',
                display:             'grid',
                gridTemplateColumns: 'auto 1fr',
                columnGap:           'var(--cds-spacing-05)',
                rowGap:              'var(--cds-spacing-02)',
                margin:              `0 0 var(--cds-spacing-06)`,
              }}
            >
              <dt style={{ fontWeight: 600 }}>Rover</dt>
              <dd style={{ margin: 0 }}>{revokeTarget.rover}</dd>

              <dt style={{ fontWeight: 600 }}>Serial</dt>
              <dd style={{ margin: 0 }}>
                <code style={{ fontSize: '0.75rem' }}>{revokeTarget.serial}</code>
              </dd>

              <dt style={{ fontWeight: 600 }}>Fingerprint</dt>
              <dd style={{ margin: 0 }}>
                <code
                  style={{
                    fontSize:    '0.75rem',
                    overflowWrap:'break-word',
                    wordBreak:   'break-all',
                  }}
                >
                  {revokeTarget.fingerprint}
                </code>
              </dd>

              <dt style={{ fontWeight: 600 }}>Expires</dt>
              <dd style={{ margin: 0 }}>{formatDate(revokeTarget.expires_on)}</dd>
            </dl>
          )}

          <div style={{ marginBottom: revokeError ? 'var(--cds-spacing-05)' : 0 }}>
            <TextArea
              id="revoke-reason"
              labelText="Reason"
              placeholder="Describe why this certificate is being revoked…"
              value={revokeReason}
              onChange={e => setRevokeReason(e.target.value)}
              rows={3}
            />
          </div>

          {revokeError && (
            <InlineNotification
              kind="error"
              title="Cannot revoke — "
              subtitle={revokeError}
              hideCloseButton
            />
          )}
        </ModalBody>

        <ModalFooter>
          <Button kind="secondary" onClick={closeRevoke} disabled={revokeBusy}>
            Cancel
          </Button>
          <Button
            kind="danger"
            onClick={submitRevoke}
            disabled={revokeBusy || !revokeReason.trim()}
          >
            {revokeBusy ? 'Revoking…' : 'Revoke certificate'}
          </Button>
        </ModalFooter>
      </ComposedModal>

    </div>
  )
}
