// Operators — operator registry, access control, and revocation management.
// Two stacked DataTablePanels:
//   1. Operators (operator_id, operator_name, status, key_fingerprint) with
//      a per-row overflow-menu "Revoke access" → danger ComposedModal.
//   2. Revocations (operator, scope, rover, status, epoch, revoked_on, reason)
//      with a "Lift" ghost button on Active rows → confirm Modal.
// Success outcomes: ToastNotification + reload of affected tables.

import { useState, useCallback } from 'react'
import {
  ActionableNotification,
  Button,
  Column,
  ComposedModal,
  Grid,
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
  TextArea,
  ToastNotification,
} from '@carbon/react'
import { PageHeader }      from '../components/PageHeader'
import { DataTablePanel }  from '../components/DataTablePanel'
import { StatusTag }       from '../components/StatusTag'
import { useAsync }        from '../lib/useAsync'
import * as api            from '../lib/api'
import type { Operator, Revocation } from '../lib/api'

// ── Toast ─────────────────────────────────────────────────────────────────────

interface Toast {
  id: string
  kind: 'success' | 'error'
  title: string
  subtitle: string
}

// ── Table column definitions ──────────────────────────────────────────────────

const OPERATOR_HEADERS = [
  { key: 'operator_id',     header: 'Operator ID'     },
  { key: 'operator_name',   header: 'Name'            },
  { key: 'status',          header: 'Status'          },
  { key: 'key_fingerprint', header: 'Key fingerprint' },
  { key: 'actions',         header: ''                },
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
  // ── Data fetching ─────────────────────────────────────────────────────────
  const operatorsAsync   = useAsync(() => api.operators(),   [])
  const revocationsAsync = useAsync(() => api.revocations(), [])
  const roversAsync      = useAsync(() => api.rovers(),      [])

  // ── Toast management ──────────────────────────────────────────────────────
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

  // ── Revoke modal state ────────────────────────────────────────────────────
  const [revokeOpen,   setRevokeOpen]   = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<Operator | null>(null)
  const [scope,        setScope]        = useState<'All Rovers' | 'Specific Rover'>('All Rovers')
  const [roverChoice,  setRoverChoice]  = useState('')
  const [reason,       setReason]       = useState('')
  const [revokeBusy,   setRevokeBusy]   = useState(false)
  const [revokeError,  setRevokeError]  = useState<string | null>(null)

  function openRevoke(op: Operator) {
    setRevokeTarget(op)
    setScope('All Rovers')
    setRoverChoice('')
    setReason('')
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
    if (!reason.trim()) {
      setRevokeError('A reason is required.')
      return
    }
    if (scope === 'Specific Rover' && !roverChoice) {
      setRevokeError('Select a rover when using Specific Rover scope.')
      return
    }

    setRevokeBusy(true)
    setRevokeError(null)

    const body = {
      operator: revokeTarget.name,
      scope,
      reason: reason.trim(),
      ...(scope === 'Specific Rover' ? { rover: roverChoice } : {}),
    }

    try {
      await api.revokeOperator(body)
      const scopeLabel =
        scope === 'All Rovers' ? 'all rovers' : roverChoice
      setRevokeOpen(false)
      addToast(
        'success',
        'Access revoked',
        `${revokeTarget.operator_name} revoked across ${scopeLabel}.`,
      )
      operatorsAsync.reload()
      revocationsAsync.reload()
    } catch (e) {
      setRevokeError(e instanceof Error ? e.message : String(e))
    } finally {
      setRevokeBusy(false)
    }
  }

  // ── Lift modal state ──────────────────────────────────────────────────────
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
      addToast(
        'success',
        'Revocation lifted',
        `Access restored for ${liftTarget.operator}.`,
      )
      revocationsAsync.reload()
      operatorsAsync.reload()
    } catch (e) {
      setLiftError(e instanceof Error ? e.message : String(e))
    } finally {
      setLiftBusy(false)
    }
  }

  // ── Row data ───────────────────────────────────────────────────────────────
  const operatorRows = (operatorsAsync.data ?? []).map(op => ({
    id: op.name,
    operator_id:   op.operator_id,
    operator_name: op.operator_name,
    status:        <StatusTag status={op.status} />,
    key_fingerprint: (
      <code
        style={{
          fontVariantNumeric: 'tabular-nums',
          fontSize:           '0.75rem',
          color:              'var(--cds-text-secondary)',
          display:            'inline-block',
          maxWidth:           '18rem',
          overflow:           'hidden',
          textOverflow:       'ellipsis',
          whiteSpace:         'nowrap',
          verticalAlign:      'bottom',
        }}
        title={op.key_fingerprint}
      >
        {op.key_fingerprint}
      </code>
    ),
    actions: (
      <OverflowMenu flipped size="sm" iconDescription="Operator actions">
        <OverflowMenuItem
          itemText="Revoke access"
          isDelete
          onClick={() => openRevoke(op)}
        />
      </OverflowMenu>
    ),
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
    actions:
      rev.status === 'Active' ? (
        <Button kind="ghost" size="sm" onClick={() => openLift(rev)}>
          Lift
        </Button>
      ) : null,
  }))

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="cc-page">

      {/* ── Toast container (fixed, top-right, above shell) ──────────────── */}
      <div
        role="region"
        aria-label="Action notifications"
        aria-live="polite"
        style={{
          position:  'fixed',
          top:       'calc(3rem + var(--cds-spacing-05))',
          right:     'var(--cds-spacing-05)',
          zIndex:    9000,
          display:   'flex',
          flexDirection: 'column',
          gap:       'var(--cds-spacing-03)',
          width:     '22rem',
          maxWidth:  'calc(100vw - 2 * var(--cds-spacing-05))',
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
        title="Operators"
        description="Manage operator signing keys, rover access allowlists, and revocations."
        breadcrumbs={[
          { label: 'Friday Command Center' },
          { label: 'Operators' },
        ]}
      />

      <Grid>
        <Column sm={4} md={8} lg={16}>

          {/* Operators load error */}
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

          {/* Operators table */}
          <div style={{ marginBottom: 'var(--cds-spacing-08)' }}>
            <DataTablePanel
              title="Operators"
              description="Registered operators with active signing keys. Use the row menu to revoke access."
              headers={OPERATOR_HEADERS}
              rows={operatorRows}
              loading={operatorsAsync.loading}
              searchable
            />
          </div>

          {/* Revocations load error */}
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

          {/* Revocations table */}
          <DataTablePanel
            title="Revocations"
            description="Active and lifted operator access revocations. Active revocations can be lifted."
            headers={REVOCATION_HEADERS}
            rows={revocationRows}
            loading={revocationsAsync.loading}
            searchable
          />

        </Column>
      </Grid>

      {/* ── Revoke access modal (danger) ────────────────────────────────── */}
      <ComposedModal
        open={revokeOpen}
        onClose={closeRevoke}
        danger
      >
        <ModalHeader
          label="Destructive action"
          title={
            revokeTarget
              ? `Revoke access: ${revokeTarget.operator_name}`
              : 'Revoke access'
          }
        />

        <ModalBody>
          <p
            style={{
              fontSize:         '0.875rem',
              color:            'var(--cds-text-secondary)',
              marginBottom:     'var(--cds-spacing-06)',
              lineHeight:       '1.5',
            }}
          >
            This creates an active revocation that blocks the operator from
            issuing commands. You can lift the revocation later from the
            Revocations table.
          </p>

          <div style={{ marginBottom: 'var(--cds-spacing-06)' }}>
            <RadioButtonGroup
              name="revoke-scope"
              legendText="Scope"
              valueSelected={scope}
              onChange={(value) => {
                const v = String(value) as 'All Rovers' | 'Specific Rover'
                setScope(v)
                if (v === 'All Rovers') setRoverChoice('')
              }}
            >
              <RadioButton
                labelText="All Rovers"
                value="All Rovers"
                id="revoke-scope-all"
              />
              <RadioButton
                labelText="Specific Rover"
                value="Specific Rover"
                id="revoke-scope-specific"
              />
            </RadioButtonGroup>
          </div>

          <div style={{ marginBottom: 'var(--cds-spacing-06)' }}>
            <Select
              id="revoke-rover-select"
              labelText="Rover"
              disabled={scope !== 'Specific Rover'}
              value={roverChoice}
              onChange={(e) => setRoverChoice(e.target.value)}
            >
              <SelectItem value="" text="— select a rover —" />
              {(roversAsync.data ?? []).map(r => (
                <SelectItem
                  key={r.name}
                  value={r.name}
                  text={r.rover_name || r.rover_id}
                />
              ))}
            </Select>
          </div>

          <div style={{ marginBottom: revokeError ? 'var(--cds-spacing-05)' : 0 }}>
            <TextArea
              id="revoke-reason"
              labelText="Reason"
              placeholder="Describe why access is being revoked…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
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
            disabled={
              revokeBusy ||
              !reason.trim() ||
              (scope === 'Specific Rover' && !roverChoice)
            }
          >
            {revokeBusy ? 'Revoking…' : 'Revoke access'}
          </Button>
        </ModalFooter>
      </ComposedModal>

      {/* ── Lift revocation modal ────────────────────────────────────────── */}
      <Modal
        open={liftOpen}
        modalHeading="Lift revocation"
        primaryButtonText={liftBusy ? 'Lifting…' : 'Lift revocation'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={liftBusy}
        onRequestClose={closeLift}
        onRequestSubmit={submitLift}
      >
        <p
          style={{
            fontSize:     '0.875rem',
            marginBottom: 'var(--cds-spacing-05)',
            lineHeight:   '1.5',
          }}
        >
          Lift the active revocation for operator{' '}
          <strong>{liftTarget?.operator}</strong>? Their access will be governed
          by the existing allowlist entries again.
        </p>

        {liftTarget && (
          <dl
            style={{
              fontSize:              '0.75rem',
              color:                 'var(--cds-text-secondary)',
              display:               'grid',
              gridTemplateColumns:   'auto 1fr',
              columnGap:             'var(--cds-spacing-05)',
              rowGap:                'var(--cds-spacing-02)',
              margin:                `0 0 var(--cds-spacing-05)`,
            }}
          >
            <dt style={{ fontWeight: 600 }}>Scope</dt>
            <dd style={{ margin: 0 }}>{liftTarget.scope}</dd>

            {liftTarget.rover && (
              <>
                <dt style={{ fontWeight: 600 }}>Rover</dt>
                <dd style={{ margin: 0 }}>{liftTarget.rover}</dd>
              </>
            )}

            <dt style={{ fontWeight: 600 }}>Revoked by</dt>
            <dd style={{ margin: 0 }}>{liftTarget.revoked_by}</dd>

            <dt style={{ fontWeight: 600 }}>Reason</dt>
            <dd style={{ margin: 0 }}>{liftTarget.reason}</dd>
          </dl>
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
