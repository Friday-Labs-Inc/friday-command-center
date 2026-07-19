// EnvironmentView — the world senses, finally visible.
// Env-pod readings (temp / humidity / pressure / light / presence) + phone-pod
// GPS, served by the gateway's telemetry recorder. DOM + per-metric animated
// canvas sparklines (same pattern as ModulesView; no three.js).
//
// Honest states, in order of precedence:
//   gateway fetch fails            → GATEWAY UNREACHABLE
//   no recorded samples for a pod  → LINK PENDING (rover publisher not deployed)
//   sample older than STALE_S      → STALE badge with age
//   sample unsigned                → UNSIGNED chip (signed shows SIGNED)

import { useEffect, useRef, useState } from 'react'
import { useDeck } from '../data'
import { Panel, ViewHead } from '../bits'
import { telemetryLatest, telemetryHistory } from '../../lib/api'
import type { TelemetrySample } from '../../lib/api'

// field rover + the Gazebo sim — distinct identities, distinct signing keys
const ROVERS = [
  { id: 'MARK1-001',     label: 'FIELD', sim: false },
  { id: 'MARK1-SIM-001', label: 'SIM',   sim: true },
] as const
const POLL_MS = 5000
const STALE_S = 30

interface Metric {
  key: string
  label: string
  unit: string
  color: string
  fmt: (v: number) => string
}

const METRICS: Metric[] = [
  { key: 'temperature_c', label: 'TEMPERATURE', unit: '°C',  color: '#ffb454', fmt: v => v.toFixed(1) },
  { key: 'humidity_pct',  label: 'HUMIDITY',    unit: '%',   color: '#48e5f2', fmt: v => v.toFixed(0) },
  { key: 'pressure_hpa',  label: 'PRESSURE',    unit: 'hPa', color: '#b18cff', fmt: v => v.toFixed(1) },
  { key: 'light_lux',     label: 'LIGHT',       unit: 'lux', color: '#3be896', fmt: v => v.toFixed(0) },
]

type LinkState = 'ok' | 'stale' | 'pending' | 'unreachable'

function linkOf(sample: TelemetrySample | undefined, error: boolean): LinkState {
  if (error) return 'unreachable'
  if (!sample) return 'pending'
  if ((sample.age_s ?? 0) > STALE_S) return 'stale'
  return 'ok'
}

const LINK_CHIP: Record<LinkState, [string, string]> = {
  ok:          ['dk-chip ok',      'LIVE'],
  stale:       ['dk-chip standby', 'STALE'],
  pending:     ['dk-chip prov',    'LINK PENDING'],
  unreachable: ['dk-chip crit',    'GATEWAY UNREACHABLE'],
}

// ── sparkline painter ─────────────────────────────────────────────────────────

function paintSpark(cv: HTMLCanvasElement, values: number[], color: string, t: number) {
  const dpr = window.devicePixelRatio || 1
  const w = cv.clientWidth, h = cv.clientHeight
  if (w === 0 || h === 0) return
  if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr }
  const g = cv.getContext('2d')!
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, w, h)
  if (values.length < 2) return
  const lo = Math.min(...values), hi = Math.max(...values)
  const span = hi - lo || 1
  const px = (i: number) => (i / (values.length - 1)) * (w - 4) + 2
  const py = (v: number) => h - 4 - ((v - lo) / span) * (h - 10)
  g.beginPath()
  values.forEach((v, i) => (i === 0 ? g.moveTo(px(i), py(v)) : g.lineTo(px(i), py(v))))
  g.strokeStyle = color
  g.globalAlpha = 0.9
  g.lineWidth = 1.4
  g.stroke()
  // breathing endpoint dot — live motion lives in content, not view swaps
  const last = values[values.length - 1]
  g.globalAlpha = 0.55 + 0.45 * Math.sin(t / 420)
  g.beginPath()
  g.arc(px(values.length - 1), py(last), 2.4, 0, Math.PI * 2)
  g.fillStyle = color
  g.fill()
  g.globalAlpha = 1
}

function fmtOrDash(v: unknown, fmt: (n: number) => string) {
  return typeof v === 'number' && Number.isFinite(v)
    ? fmt(v)
    : <span style={{ opacity: 0.4 }}>——</span>
}

// Tilt is the one number an operator reads as a warning: green level, amber
// leaning, red near roll-over. Thresholds are advisory, not a safety gate.
function tiltColor(v: unknown) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 'var(--dim, #5a7396)'
  if (v > 35) return '#ff4d6a'
  if (v > 15) return '#ffb454'
  return '#3be896'
}

// ── view ──────────────────────────────────────────────────────────────────────

export function EnvironmentView() {
  const { pushEvent } = useDeck()
  const [roverIdx, setRoverIdx] = useState(0)
  const ROVER = ROVERS[roverIdx].id
  const [env, setEnv] = useState<TelemetrySample | undefined>(undefined)
  const [gps, setGps] = useState<TelemetrySample | undefined>(undefined)
  const [imu, setImu] = useState<TelemetrySample | undefined>(undefined)
  const [odom, setOdom] = useState<TelemetrySample | undefined>(undefined)
  const [error, setError] = useState(false)
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const histRef = useRef<Map<string, number[]>>(new Map())
  const linkRef = useRef<{ env: LinkState | null; presence: boolean | null }>({ env: null, presence: null })

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const latest = await telemetryLatest(ROVER)
        if (!alive) return
        setError(false)
        const e = latest.kinds['env']
        const g = latest.kinds['gps']
        setEnv(e)
        setGps(g)
        setImu(latest.kinds['imu'])
        setOdom(latest.kinds['odom'])

        // stream events on real transitions only
        const link = linkOf(e, false)
        if (linkRef.current.env !== null && linkRef.current.env !== link) {
          pushEvent('ENV', `env link ${linkRef.current.env} → ${link}`, link === 'ok' ? 'ok' : 'warn')
        }
        linkRef.current.env = link
        const presence = e?.data ? Boolean((e.data as Record<string, unknown>)['presence']) : null
        if (presence !== null && linkRef.current.presence !== null && presence !== linkRef.current.presence) {
          pushEvent('ENV', presence ? 'presence detected' : 'presence clear', presence ? 'warn' : 'ok')
        }
        linkRef.current.presence = presence

        if (e) {
          const hist = await telemetryHistory(ROVER, 'env', 120)
          if (!alive) return
          for (const m of METRICS) {
            histRef.current.set(m.key, hist.samples
              .map(s => (s.data ? Number((s.data as Record<string, unknown>)[m.key]) : NaN))
              .filter(v => Number.isFinite(v)))
          }
        }
      } catch {
        if (!alive) return
        setError(true)
        if (linkRef.current.env !== 'unreachable') {
          pushEvent('ENV', 'telemetry gateway unreachable', 'warn')
          linkRef.current.env = 'unreachable'
        }
      }
    }
    histRef.current.clear()
    linkRef.current = { env: null, presence: null }
    load()
    const iv = setInterval(load, POLL_MS)
    return () => { alive = false; clearInterval(iv) }
  }, [pushEvent, ROVER])

  useEffect(() => {
    let raf = 0
    const frame = (t: number) => {
      METRICS.forEach((m, i) => {
        const cv = canvasRefs.current[i]
        if (cv) paintSpark(cv, histRef.current.get(m.key) ?? [], m.color, t)
      })
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  const envLink = linkOf(env, error)
  const gpsLink = linkOf(gps, error)
  const imuLink = linkOf(imu, error)
  const odomLink = linkOf(odom, error)
  const envData = (env?.data ?? {}) as Record<string, unknown>
  const gpsData = (gps?.data ?? {}) as Record<string, unknown>
  const imuData = (imu?.data ?? {}) as Record<string, unknown>
  const odomData = (odom?.data ?? {}) as Record<string, unknown>
  const yawDeg = (() => {
    const qz = odomData['qz'], qw = odomData['qw']
    if (typeof qz !== 'number' || typeof qw !== 'number') return undefined
    return ((2 * Math.atan2(qz, qw)) * 180 / Math.PI + 360) % 360
  })()
  const presence = envLink === 'ok' || envLink === 'stale' ? Boolean(envData['presence']) : null

  const chip = ([cls, label]: [string, string], age?: number) => (
    <span className={cls}>{label}{label === 'STALE' && age != null ? ` · ${Math.round(age)}s` : ''}</span>
  )
  const sigChip = (s: TelemetrySample | undefined) =>
    s == null ? null : s.verified
      ? <span className="dk-chip ok">SIGNED</span>
      : <span className="dk-chip standby">UNSIGNED</span>

  return (
    <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: '22px 24px' }}>
      <ViewHead
        eyebrow="WORLD SENSES"
        title="Environment"
        sub={<>
          {ROVERS.map((r, i) => (
            <button key={r.id} onClick={() => setRoverIdx(i)}
              className={i === roverIdx ? 'dk-chip ok' : 'dk-chip prov'}
              style={{ cursor: 'pointer', marginRight: 6, background: 'transparent' }}>
              {r.label} · {r.id}
            </button>
          ))}
          {ROVERS[roverIdx].sim && <span className="dk-chip standby">SIMULATION — Gazebo, not hardware</span>}
        </>}
      />

      <div style={{ marginTop: 84, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
        {METRICS.map((m, i) => {
          const v = envData[m.key]
          const has = (envLink === 'ok' || envLink === 'stale') && typeof v === 'number'
          return (
            <Panel key={m.key} title={m.label} meta={chip(LINK_CHIP[envLink], env?.age_s)}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '6px 2px 4px' }}>
                <span style={{ fontSize: 30, fontWeight: 600, color: has ? m.color : 'var(--dim, #5a7396)' }}>
                  {has ? m.fmt(v as number) : '——'}
                </span>
                <span style={{ opacity: 0.6, fontSize: 12 }}>{m.unit}</span>
              </div>
              <canvas ref={el => { canvasRefs.current[i] = el }} style={{ display: 'block', width: '100%', height: '34px' }} />
            </Panel>
          )
        })}
      </div>

      <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
        <Panel title="PRESENCE" meta={chip(LINK_CHIP[envLink], env?.age_s)}>
          <div style={{ padding: '10px 2px', fontSize: 22, fontWeight: 600 }}>
            {presence === null ? <span style={{ opacity: 0.5 }}>——</span>
              : presence ? <span style={{ color: '#ffb454' }}>HUMAN DETECTED</span>
              : <span style={{ color: '#3be896' }}>CLEAR</span>}
          </div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>mmWave presence, advisory only — outside the safety path</div>
        </Panel>

        <Panel title="GPS · PHONE POD" meta={<>{chip(LINK_CHIP[gpsLink], gps?.age_s)} {sigChip(gps)}</>}>
          {gpsLink === 'ok' || gpsLink === 'stale' ? (
            <div style={{ padding: '6px 2px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 13 }}>
              <div>LAT <b>{Number(gpsData['lat'] ?? NaN).toFixed(5)}°</b></div>
              <div>LON <b>{Number(gpsData['lon'] ?? NaN).toFixed(5)}°</b></div>
              <div>ALT <b>{Number(gpsData['alt_m'] ?? NaN).toFixed(0)} m</b></div>
              <div>FIX <b>{String(gpsData['fix'] ?? '?')}</b> · SATS <b>{String(gpsData['sats'] ?? '?')}</b></div>
            </div>
          ) : (
            <div style={{ padding: '10px 2px', fontSize: 12, opacity: 0.6 }}>
              {gpsLink === 'unreachable' ? 'telemetry gateway unreachable'
                : 'no GPS telemetry recorded — rover publisher not deployed yet'}
            </div>
          )}
        </Panel>

        <Panel title="MOTION · PHONE POD" meta={<>{chip(LINK_CHIP[imuLink], imu?.age_s)} {sigChip(imu)}</>}>
          {imuLink === 'ok' || imuLink === 'stale' ? (
            <div style={{ padding: '6px 2px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 10, opacity: 0.55, letterSpacing: '.08em' }}>TILT</div>
                  <div style={{ fontSize: 22, fontWeight: 600, color: tiltColor(imuData['tilt_deg']) }}>
                    {fmtOrDash(imuData['tilt_deg'], v => `${v.toFixed(1)}°`)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, opacity: 0.55, letterSpacing: '.08em' }}>HEADING</div>
                  <div style={{ fontSize: 22, fontWeight: 600, color: '#48e5f2' }}>
                    {fmtOrDash(imuData['heading_deg'], v => `${v.toFixed(0)}°M`)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, opacity: 0.55, letterSpacing: '.08em' }}>VIBRATION</div>
                  <div style={{ fontSize: 22, fontWeight: 600, color: '#b18cff' }}>
                    {fmtOrDash(imuData['vibration_rms'], v => v.toFixed(2))}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 11, opacity: 0.55, marginTop: 8, lineHeight: 1.5 }}>
                backup attitude reference — advisory. 10 Hz over WiFi, magnetic heading,
                uncalibrated: <b>NOT localization-grade</b>. The wired IMU owns the filter;
                this answers “what state did it stop in”.
              </div>
            </div>
          ) : (
            <div style={{ padding: '10px 2px', fontSize: 12, opacity: 0.6 }}>
              {imuLink === 'unreachable' ? 'telemetry gateway unreachable'
                : 'no attitude telemetry recorded — phone pod away or HyperIMU stopped'}
            </div>
          )}
        </Panel>

        <Panel title="ODOMETRY" meta={<>{chip(LINK_CHIP[odomLink], odom?.age_s)} {sigChip(odom)}</>}>
          {odomLink === 'ok' || odomLink === 'stale' ? (
            <div style={{ padding: '6px 2px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 13 }}>
              <div>X <b>{fmtOrDash(odomData['x'], v => `${v.toFixed(2)} m`)}</b></div>
              <div>Y <b>{fmtOrDash(odomData['y'], v => `${v.toFixed(2)} m`)}</b></div>
              <div>YAW <b>{fmtOrDash(yawDeg, v => `${v.toFixed(0)}°`)}</b></div>
              <div>SPEED <b>{fmtOrDash(odomData['vx'], v => `${Math.abs(v).toFixed(2)} m/s`)}</b></div>
            </div>
          ) : (
            <div style={{ padding: '10px 2px', fontSize: 12, opacity: 0.6 }}>
              {odomLink === 'unreachable' ? 'telemetry gateway unreachable'
                : 'no odometry recorded — rover parked or link pending'}
            </div>
          )}
        </Panel>

        <Panel title="LINK" meta={sigChip(env)}>
          <div style={{ padding: '10px 2px', fontSize: 12, lineHeight: 1.8, opacity: 0.75 }}>
            rover → signed CBOR envelope → EMQX (mTLS) → gateway recorder → this panel.<br />
            {envLink === 'pending'
              ? 'The pods are live on the rover bus; the rover-side telemetry publisher is the next deploy.'
              : `last env sample ${env?.age_s != null ? `${Math.round(env.age_s)}s ago` : '—'} · history ${histRef.current.get('temperature_c')?.length ?? 0} samples`}
          </div>
        </Panel>
      </div>
    </div>
  )
}
