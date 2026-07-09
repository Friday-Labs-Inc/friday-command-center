// Missions — plan, approve, and assign rover missions.
// Redesigned to the cc-* design-system DNA (matches Overview.tsx structure).
// All business logic preserved from the previous version; only the layout
// shell has changed: cc-pagehead → cc-section → cc-grid / DataTablePanel.

import { useState } from 'react'
import {
  Button,
  ComposedModal,
  InlineLoading,
  InlineNotification,
  Layer,
  ModalBody,
  ModalFooter,
  ModalHeader,
  NumberInput,
  Select,
  SelectItem,
  SkeletonText,
  StructuredListBody,
  StructuredListCell,
  StructuredListHead,
  StructuredListRow,
  StructuredListWrapper,
  TextArea,
  TextInput,
  ToastNotification,
} from '@carbon/react'
import { Add, TrashCan } from '@carbon/icons-react'
import { ConfigCard } from '../components/ConfigCard'
import { DataTablePanel } from '../components/DataTablePanel'
import { StatusTag } from '../components/StatusTag'
import { useAsync } from '../lib/useAsync'
import * as api from '../lib/api'
import type { CreateMissionBody, Mission } from '../lib/api'

// ── Local types ───────────────────────────────────────────────────────────────

/** Mutable form row for a single waypoint while editing */
interface WpRow {
  x: number
  y: number
  action: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString() } catch { return iso }
}

function formatPayload(raw: string): string {
  if (!raw) return ''
  try { return JSON.stringify(JSON.parse(raw), null, 2) } catch { return raw }
}

// ── Table columns ─────────────────────────────────────────────────────────────

const HEADERS = [
  { key: 'title',       header: 'Title'       },
  { key: 'rover',       header: 'Rover'       },
  { key: 'status',      header: 'Status'      },
  { key: 'approved_by', header: 'Approved by' },
  { key: 'approved_on', header: 'Approved on' },
]

// ── Component ─────────────────────────────────────────────────────────────────

export function Missions() {
  // ── Data fetches ──────────────────────────────────────────────────────────────
  const missionsState = useAsync(() => api.missions(), [])
  const roversState   = useAsync(() => api.rovers(),   [])

  // ── Derived summary counts ────────────────────────────────────────────────────
  const allMissions  = missionsState.data ?? []
  const activeMissions    = allMissions.filter(m => m.status === 'Active')
  const pendingMissions   = allMissions.filter(m => m.status === 'Pending' || m.status === 'Draft')
  const completedMissions = allMissions.filter(m => m.status === 'Completed')

  // ── Create form state ─────────────────────────────────────────────────────────
  const [createOpen,   setCreateOpen]   = useState(false)
  const [formTitle,    setFormTitle]    = useState('')
  const [formRover,    setFormRover]    = useState('')
  const [formPayload,  setFormPayload]  = useState('')
  const [formWps,      setFormWps]      = useState<WpRow[]>([{ x: 0, y: 0, action: '' }])
  const [submitBusy,   setSubmitBusy]   = useState(false)
  const [submitError,  setSubmitError]  = useState<string | null>(null)

  // ── Detail modal state ────────────────────────────────────────────────────────
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailName, setDetailName] = useState<string | null>(null)
  const detailState = useAsync<Mission | null>(
    () => detailName ? api.mission(detailName) : Promise.resolve(null),
    [detailName],
  )

  // ── Toast state ───────────────────────────────────────────────────────────────
  const [toastVisible,  setToastVisible]  = useState(false)
  const [toastSubtitle, setToastSubtitle] = useState('')

  // ── Create modal handlers ─────────────────────────────────────────────────────

  function openCreate() {
    setFormTitle('')
    setFormRover('')
    setFormPayload('')
    setFormWps([{ x: 0, y: 0, action: '' }])
    setSubmitError(null)
    setCreateOpen(true)
  }

  function closeCreate() {
    if (submitBusy) return
    setCreateOpen(false)
  }

  function addWaypoint() {
    setFormWps(prev => [...prev, { x: 0, y: 0, action: '' }])
  }

  function removeWaypoint(idx: number) {
    setFormWps(prev => prev.filter((_, i) => i !== idx))
  }

  function updateWp(idx: number, field: keyof WpRow, val: number | string) {
    setFormWps(prev =>
      prev.map((wp, i) => (i === idx ? { ...wp, [field]: val } : wp)),
    )
  }

  async function handleCreate() {
    if (submitBusy) return
    setSubmitError(null)

    if (!formTitle.trim())  { setSubmitError('Title is required.'); return }
    if (!formRover)          { setSubmitError('Select a rover.'); return }
    if (formPayload.trim()) {
      try { JSON.parse(formPayload.trim()) } catch {
        setSubmitError('Payload is not valid JSON — fix it or leave it blank.')
        return
      }
    }

    setSubmitBusy(true)
    try {
      const body: CreateMissionBody = {
        title: formTitle.trim(),
        rover: formRover,
        waypoints: formWps.map((wp, i) => ({
          seq: i + 1,
          x:   wp.x,
          y:   wp.y,
          action: wp.action,
        })),
        ...(formPayload.trim() ? { payload: formPayload.trim() } : {}),
      }
      const created = await api.createMission(body)
      setCreateOpen(false)
      setToastSubtitle(`"${created.title}" queued on ${created.rover}.`)
      setToastVisible(true)
      missionsState.reload()
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitBusy(false)
    }
  }

  // ── Detail modal handlers ─────────────────────────────────────────────────────

  function openDetail(rowId: string) {
    setDetailName(rowId)
    setDetailOpen(true)
  }

  function closeDetail() {
    setDetailOpen(false)
  }

  // ── Table row mapping ─────────────────────────────────────────────────────────

  const tableRows = allMissions.map(m => ({
    id:          m.name,
    title:       m.title,
    rover:       m.rover,
    status:      <StatusTag status={m.status} />,
    approved_by: m.approved_by ?? '—',
    approved_on: formatDate(m.approved_on),
  }))

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="cc-page">

      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <header className="cc-pagehead">
        <p className="cc-pagehead__eyebrow">Autonomy</p>
        <div className="cc-pagehead__row">
          <div>
            <h1 className="cc-pagehead__title">Missions</h1>
            <p className="cc-pagehead__sub">Plan, approve, and assign rover missions.</p>
          </div>
          <Button kind="primary" renderIcon={Add} onClick={openCreate}>
            New mission
          </Button>
        </div>
      </header>

      {/* ── Fetch error ───────────────────────────────────────────────────────── */}
      {missionsState.error && !missionsState.loading && (
        <div style={{ marginBottom: 'var(--cds-spacing-06)' }}>
          <InlineNotification
            kind="error"
            title="Could not load missions"
            subtitle={missionsState.error.message}
            hideCloseButton
          />
        </div>
      )}

      {/* ── At a glance ───────────────────────────────────────────────────────── */}
      <section className="cc-section">
        <div className="cc-section__head">
          <h2 className="cc-section__title">At a glance</h2>
          <span className="cc-section__meta">
            {missionsState.loading ? '—' : `${allMissions.length} total`}
          </span>
        </div>
        <div className="cc-grid cc-grid--4">
          <ConfigCard status={allMissions.length > 0 ? 'ok' : 'off'}>
            <p className="cc-card__eyebrow">Total</p>
            {missionsState.loading
              ? <SkeletonText heading width="40%" />
              : <p className="cc-card__metric">{allMissions.length}</p>}
            <p className="cc-card__meta">missions across the fleet</p>
          </ConfigCard>

          <ConfigCard status={activeMissions.length > 0 ? 'ok' : 'off'}>
            <p className="cc-card__eyebrow">Active</p>
            {missionsState.loading
              ? <SkeletonText heading width="40%" />
              : <p className="cc-card__metric">{activeMissions.length}</p>}
            <p className="cc-card__meta">currently executing</p>
          </ConfigCard>

          <ConfigCard status={pendingMissions.length > 0 ? 'warn' : 'off'}>
            <p className="cc-card__eyebrow">Awaiting approval</p>
            {missionsState.loading
              ? <SkeletonText heading width="40%" />
              : <p className="cc-card__metric">{pendingMissions.length}</p>}
            <p className="cc-card__meta">pending or draft</p>
          </ConfigCard>

          <ConfigCard status={completedMissions.length > 0 ? 'ok' : 'off'}>
            <p className="cc-card__eyebrow">Completed</p>
            {missionsState.loading
              ? <SkeletonText heading width="40%" />
              : <p className="cc-card__metric">{completedMissions.length}</p>}
            <p className="cc-card__meta">finished runs</p>
          </ConfigCard>
        </div>
      </section>

      {/* ── All missions table ────────────────────────────────────────────────── */}
      <section className="cc-section">
        <div className="cc-section__head">
          <h2 className="cc-section__title">All missions</h2>
          <span className="cc-section__meta">Click a row to view waypoints and payload</span>
        </div>
        <DataTablePanel
          title="Missions"
          description="All missions across the fleet."
          headers={HEADERS}
          rows={tableRows}
          loading={missionsState.loading}
          searchable
          onRowClick={openDetail}
        />
      </section>

      {/* ════════════════════════════════════════════════════════════════════════
          Create mission modal
      ═══════════════════════════════════════════════════════════════════════════ */}
      <ComposedModal open={createOpen} onClose={closeCreate} size="md">
        <ModalHeader label="Missions" title="New mission" />

        <ModalBody hasForm>
          {/* Title */}
          <div style={{ marginBottom: 'var(--cds-spacing-05)' }}>
            <TextInput
              id="mission-title"
              labelText="Title"
              placeholder="e.g. North-field soil survey"
              value={formTitle}
              onChange={e => setFormTitle(e.target.value)}
            />
          </div>

          {/* Rover */}
          <div style={{ marginBottom: 'var(--cds-spacing-05)' }}>
            <Select
              id="mission-rover"
              labelText="Rover"
              value={formRover}
              onChange={e => setFormRover(e.target.value)}
            >
              <SelectItem value="" text="Select a rover…" />
              {(roversState.data ?? []).map(r => (
                <SelectItem
                  key={r.name}
                  value={r.name}
                  text={r.rover_name || r.rover_id}
                />
              ))}
            </Select>
          </div>

          {/* Payload */}
          <div style={{ marginBottom: 'var(--cds-spacing-06)' }}>
            <TextArea
              id="mission-payload"
              labelText="Payload (optional JSON)"
              placeholder={'{"speed_limit": 0.3, "mode": "survey"}'}
              rows={3}
              value={formPayload}
              onChange={e => setFormPayload(e.target.value)}
            />
          </div>

          {/* Waypoints editor */}
          <p
            className="cc-panel-heading"
            style={{ marginBottom: 'var(--cds-spacing-04)' }}
          >
            Waypoints
          </p>

          {formWps.map((wp, i) => (
            <div
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 2fr auto',
                gap: 'var(--cds-spacing-04)',
                alignItems: 'flex-end',
                marginBottom: 'var(--cds-spacing-04)',
              }}
            >
              <NumberInput
                id={`wp-x-${i}`}
                label={`X ${i + 1} (m)`}
                value={wp.x}
                step={0.1}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onChange={(_e: any, d: any) => updateWp(i, 'x', Number(d?.value ?? 0))}
              />
              <NumberInput
                id={`wp-y-${i}`}
                label={`Y ${i + 1} (m)`}
                value={wp.y}
                step={0.1}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onChange={(_e: any, d: any) => updateWp(i, 'y', Number(d?.value ?? 0))}
              />
              <TextInput
                id={`wp-action-${i}`}
                labelText={`Action ${i + 1}`}
                placeholder="stop | scan | sample"
                value={wp.action}
                onChange={e => updateWp(i, 'action', e.target.value)}
              />
              <Button
                kind="ghost"
                hasIconOnly
                renderIcon={TrashCan}
                iconDescription="Remove waypoint"
                tooltipPosition="top"
                disabled={formWps.length === 1}
                onClick={() => removeWaypoint(i)}
              />
            </div>
          ))}

          <Button
            kind="ghost"
            renderIcon={Add}
            size="sm"
            onClick={addWaypoint}
            style={{ marginBottom: 'var(--cds-spacing-04)' }}
          >
            Add waypoint
          </Button>

          {/* Submit error */}
          {submitError && (
            <div style={{ marginTop: 'var(--cds-spacing-04)' }}>
              <InlineNotification
                kind="error"
                title=""
                subtitle={submitError}
                hideCloseButton
                lowContrast
              />
            </div>
          )}
        </ModalBody>

        <ModalFooter>
          <Button kind="secondary" onClick={closeCreate} disabled={submitBusy}>
            Cancel
          </Button>
          <Button kind="primary" onClick={handleCreate} disabled={submitBusy}>
            {submitBusy
              ? <InlineLoading description="Creating…" />
              : 'Create mission'}
          </Button>
        </ModalFooter>
      </ComposedModal>

      {/* ════════════════════════════════════════════════════════════════════════
          Mission detail modal
      ═══════════════════════════════════════════════════════════════════════════ */}
      <ComposedModal open={detailOpen} onClose={closeDetail} size="md">
        <ModalHeader
          label={detailState.data?.rover ?? ''}
          title={
            detailState.loading
              ? 'Loading…'
              : (detailState.data?.title ?? 'Mission detail')
          }
        />

        <ModalBody>
          {/* Loading */}
          {detailState.loading && (
            <div style={{ padding: 'var(--cds-spacing-09) 0' }}>
              <InlineLoading description="Fetching mission…" />
            </div>
          )}

          {/* Fetch error */}
          {detailState.error && (
            <InlineNotification
              kind="error"
              title="Failed to load"
              subtitle={detailState.error.message}
              hideCloseButton
            />
          )}

          {/* Mission detail */}
          {detailState.data && (
            <>
              {/* Status + approval row */}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 'var(--cds-spacing-04)',
                  marginBottom: 'var(--cds-spacing-06)',
                }}
              >
                <StatusTag status={detailState.data.status} size="md" />
                {detailState.data.approved_by && (
                  <span style={{ fontSize: '0.875rem', color: 'var(--cds-text-secondary)' }}>
                    Approved by {detailState.data.approved_by}
                    {detailState.data.approved_on && (
                      <> on {formatDate(detailState.data.approved_on)}</>
                    )}
                  </span>
                )}
              </div>

              {/* Waypoints */}
              <p
                className="cc-panel-heading"
                style={{ marginBottom: 'var(--cds-spacing-03)' }}
              >
                Waypoints
              </p>

              {detailState.data.waypoints.length === 0 ? (
                <p
                  style={{
                    color: 'var(--cds-text-secondary)',
                    fontSize: '0.875rem',
                    margin: '0 0 var(--cds-spacing-05)',
                  }}
                >
                  No waypoints defined.
                </p>
              ) : (
                <div style={{ marginBottom: 'var(--cds-spacing-05)' }}>
                  <Layer>
                    <StructuredListWrapper>
                      <StructuredListHead>
                        <StructuredListRow head>
                          <StructuredListCell head>Seq</StructuredListCell>
                          <StructuredListCell head>X (m)</StructuredListCell>
                          <StructuredListCell head>Y (m)</StructuredListCell>
                          <StructuredListCell head>Action</StructuredListCell>
                        </StructuredListRow>
                      </StructuredListHead>
                      <StructuredListBody>
                        {detailState.data.waypoints.map(wp => (
                          <StructuredListRow key={wp.seq}>
                            <StructuredListCell>{wp.seq}</StructuredListCell>
                            <StructuredListCell>
                              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{wp.x}</span>
                            </StructuredListCell>
                            <StructuredListCell>
                              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{wp.y}</span>
                            </StructuredListCell>
                            <StructuredListCell>{wp.action || '—'}</StructuredListCell>
                          </StructuredListRow>
                        ))}
                      </StructuredListBody>
                    </StructuredListWrapper>
                  </Layer>
                </div>
              )}

              {/* Payload */}
              {detailState.data.mission_payload && (
                <div style={{ marginTop: 'var(--cds-spacing-05)' }}>
                  <p
                    className="cc-panel-heading"
                    style={{ marginBottom: 'var(--cds-spacing-03)' }}
                  >
                    Payload
                  </p>
                  <pre
                    style={{
                      background: 'var(--cds-layer-accent-01)',
                      color: 'var(--cds-text-primary)',
                      border: '1px solid var(--cds-border-subtle-01)',
                      padding: 'var(--cds-spacing-04)',
                      fontSize: '0.75rem',
                      fontFamily: 'var(--cds-code-01-font-family, "IBM Plex Mono", monospace)',
                      lineHeight: 1.6,
                      overflowX: 'auto',
                      margin: 0,
                    }}
                  >
                    {formatPayload(detailState.data.mission_payload)}
                  </pre>
                </div>
              )}
            </>
          )}
        </ModalBody>

        <ModalFooter>
          <Button kind="secondary" onClick={closeDetail}>Close</Button>
        </ModalFooter>
      </ComposedModal>

      {/* ── Toast container ──────────────────────────────────────────────────── */}
      {toastVisible && (
        <div
          style={{
            position: 'fixed',
            bottom: 'var(--cds-spacing-07)',
            right:  'var(--cds-spacing-07)',
            zIndex: 9000,
          }}
        >
          <ToastNotification
            kind="success"
            title="Mission created"
            subtitle={toastSubtitle}
            timeout={5000}
            onClose={() => setToastVisible(false)}
          />
        </div>
      )}
    </div>
  )
}
