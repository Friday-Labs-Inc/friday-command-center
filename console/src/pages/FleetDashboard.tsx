// FleetDashboard — live fleet overview.
// KPI row (total · online · active missions · unacked alerts)
// → fleet map (MapPanel, live odom from useLiveStore) + fleets table
// → rovers table (searchable, row click → /rovers/:rover_id)
//
// Polls rovers every 5 s to keep status current.

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Column, Grid, InlineNotification, Layer, Tag } from '@carbon/react'
import { ConnectionSignal, Launch, Van, Warning } from '@carbon/icons-react'

import * as api from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { useLiveStore } from '../lib/store'
import { DataTablePanel } from '../components/DataTablePanel'
import type { DTPRow } from '../components/DataTablePanel'
import { KpiTile } from '../components/KpiTile'
import { MapPanel } from '../components/MapPanel'
import { PageHeader } from '../components/PageHeader'
import { StatusTag } from '../components/StatusTag'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format an ISO / Frappe datetime for compact table display, or "—" if absent. */
function fmtTs(ts: string | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ts
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Rover statuses that count as "available and running". */
const ONLINE_STATUSES = new Set(['online', 'Online', 'active', 'Active'])

/**
 * Mission statuses that represent work in progress or awaiting operator action.
 * Draft and Completed/Aborted are excluded — they are not "active" in the
 * operational sense.
 */
const ACTIVE_MISSION_STATUSES = new Set(['Pending', 'Approved', 'Active'])

// ── Column definitions ────────────────────────────────────────────────────────

const ROVER_HEADERS = [
  { key: 'rover_id',         header: 'Rover ID'  },
  { key: 'rover_name',       header: 'Name'       },
  { key: 'fleet',            header: 'Fleet'      },
  { key: 'status',           header: 'Status'     },
  { key: 'firmware_version', header: 'Firmware'   },
  { key: 'last_seen',        header: 'Last seen'  },
]

const FLEET_HEADERS = [
  { key: 'fleet_name',  header: 'Fleet'       },
  { key: 'status',      header: 'Status'      },
  { key: 'description', header: 'Description' },
]

// ── Page ──────────────────────────────────────────────────────────────────────

export function FleetDashboard() {
  const navigate   = useNavigate()
  const liveState  = useLiveStore()

  // ── Data fetches ─────────────────────────────────────────────────────────

  const roversState   = useAsync(() => api.rovers(),         [])
  const fleetsState   = useAsync(() => api.fleets(),         [])
  const missionsState = useAsync(() => api.missions(),       [])
  const secEvtState   = useAsync(() => api.securityEvents(), [])

  // Poll rovers every 5 s. reload is a stable useCallback reference (deps=[])
  // so this effect runs exactly once and clears up on unmount.
  const reloadRovers = roversState.reload
  useEffect(() => {
    const tid = setInterval(reloadRovers, 5_000)
    return () => clearInterval(tid)
  }, [reloadRovers])

  // ── Derived KPI values ────────────────────────────────────────────────────

  const roversData   = roversState.data   ?? []
  const missionsData = missionsState.data ?? []
  const secEvtData   = secEvtState.data   ?? []

  const totalRovers    = roversData.length
  const onlineRovers   = roversData.filter(r => ONLINE_STATUSES.has(r.status)).length
  const activeMissions = missionsData.filter(m => ACTIVE_MISSION_STATUSES.has(m.status)).length
  const unackedAlerts  = secEvtData.filter(e => e.acknowledged === 0).length

  // ── Table rows ────────────────────────────────────────────────────────────

  // Rover rows — merge live timestamp for the rover currently streaming odom.
  // The live store tracks one rover at a time; when its .rover name matches
  // a row, replace last_seen with the live wall-clock time and add a "Live"
  // tag to the status cell.
  const roverRows: DTPRow[] = roversData.map(r => {
    const isLive = liveState.rover.rover === r.name && liveState.rover.updated !== null
    return {
      id: r.rover_id,              // passed to onRowClick → navigate('/rovers/'+id)
      rover_id: r.rover_id,
      rover_name: r.rover_name,
      fleet: r.fleet || '—',
      status: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--cds-spacing-02)' }}>
          <StatusTag status={r.status} />
          {isLive && <Tag type="green" size="sm">Live</Tag>}
        </span>
      ),
      firmware_version: r.firmware_version || '—',
      last_seen: isLive
        ? (liveState.rover.updated ?? 'now')
        : fmtTs(r.last_seen),
    }
  })

  // Fleet rows
  const fleetRows: DTPRow[] = (fleetsState.data ?? []).map(f => ({
    id: f.name,
    fleet_name: f.fleet_name,
    status: <StatusTag status={f.status} />,
    description: f.description || '—',
  }))

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="cc-page">
      {/*
        Scoped styles: make the map panel fill its fixed-height wrapper.
        fd-map-inner sets height:420px; the Layer div (> *) and the Carbon
        Tile (.cc-panel-map) are each told height:100% so maplibre-gl gets
        a real pixel height for its canvas.
      */}
      <style>{`
        .fd-map-inner {
          margin-top: var(--cds-spacing-06);
          height: 420px;
        }
        .fd-map-inner > * {
          height: 100%;
          display: flex;
          flex-direction: column;
        }
        .fd-map-inner .cc-panel-map {
          height: 100%;
        }
      `}</style>

      <PageHeader
        title="Fleet"
        description="Live rover status, map positions, and fleet overview."
      />

      <Grid>
        {/* ── Row 1: KPI tiles ─────────────────────────────────────────── */}

        <Column sm={4} md={2} lg={4}>
          <KpiTile
            label="Total rovers"
            value={roversState.loading ? '—' : totalRovers}
            icon={Van}
          />
        </Column>

        <Column sm={4} md={2} lg={4}>
          <KpiTile
            label="Online"
            value={roversState.loading ? '—' : `${onlineRovers} / ${totalRovers}`}
            icon={ConnectionSignal}
            trend={liveState.connected ? 'Telemetry live' : 'Connecting…'}
          />
        </Column>

        <Column sm={4} md={2} lg={4}>
          <KpiTile
            label="Active missions"
            value={missionsState.loading ? '—' : activeMissions}
            icon={Launch}
          />
        </Column>

        <Column sm={4} md={2} lg={4}>
          <KpiTile
            label="Unacknowledged alerts"
            value={secEvtState.loading ? '—' : unackedAlerts}
            icon={Warning}
            trend={unackedAlerts > 0 ? 'Review in Security & audit' : undefined}
          />
        </Column>

        {/* ── Rovers fetch error (shown between KPIs and map) ────────────── */}

        {roversState.error && (
          <Column sm={4} md={8} lg={16}>
            <div style={{ marginTop: 'var(--cds-spacing-05)' }}>
              <InlineNotification
                kind="error"
                title="Rovers unavailable — "
                subtitle={roversState.error.message}
                lowContrast
              />
            </div>
          </Column>
        )}

        {/* ── Row 2: Fleet map (dominant) + Fleets table ───────────────── */}

        <Column sm={4} md={5} lg={10}>
          {/*
            fd-map-inner: fixed 420 px container.
            MapPanel owns its own <Layer> (elevates its Tile to --cds-layer-01)
            and reads useLiveStore internally; moves marker on odom events.
          */}
          <div className="fd-map-inner">
            <MapPanel />
          </div>
        </Column>

        <Column sm={4} md={3} lg={6}>
          <div style={{ marginTop: 'var(--cds-spacing-06)' }}>
            <DataTablePanel
              title="Fleets"
              headers={FLEET_HEADERS}
              rows={fleetRows}
              loading={fleetsState.loading}
              pageSize={10}
            />
          </div>
        </Column>

        {/* ── Row 3: Rovers table ───────────────────────────────────────── */}

        <Column sm={4} md={8} lg={16}>
          <div style={{ marginTop: 'var(--cds-spacing-06)' }}>
            <DataTablePanel
              title="Rovers"
              description="Click a row to open rover details and telemetry."
              headers={ROVER_HEADERS}
              rows={roverRows}
              loading={roversState.loading}
              searchable
              onRowClick={id => navigate('/rovers/' + id)}
              pageSize={20}
            />
          </div>
        </Column>
      </Grid>
    </div>
  )
}
