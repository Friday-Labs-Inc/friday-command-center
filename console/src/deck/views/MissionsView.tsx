// MissionsView.tsx — mission control, wired to the REAL Frappe control plane.
// Reads live missions from /api/missions (+ /api/mission?name= for waypoints).
// The control plane runs on the gateway host, independent of rover hardware,
// so this is real whether or not the Pi is powered. Live rover POSITION needs
// telemetry (MQTT from the rover) — shown honestly as offline when absent.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { missions as fetchMissions, mission as fetchMission, type Mission, type Waypoint, dispatchSurvey, abortMission, approveWaypoint, telemetryLatest } from '../../lib/api'
import { useDeck } from '../data'
import { Panel, HelpNote } from '../bits'

// ─── Sector canvas — plots a mission's real waypoints (auto-fit) ───────────────

// Generate the lawnmower (boustrophedon) coverage pattern a survey zone expands into,
// so the Sector Map shows the planned path instead of a blank box.
function surveyPreview(zone: number[], lane: number): Waypoint[] {
  const [x0, y0, x1, y1] = zone
  const xlo = Math.min(x0, x1), xhi = Math.max(x0, x1)
  const ylo = Math.min(y0, y1), yhi = Math.max(y0, y1)
  const step = Math.max(0.5, lane || 3)
  const wps: Waypoint[] = []
  let seq = 0, up = true
  for (let x = xlo; x <= xhi + 1e-6; x += step) {
    wps.push({ seq: seq++, x, y: up ? ylo : yhi, action: 'survey' })
    wps.push({ seq: seq++, x, y: up ? yhi : ylo, action: 'survey' })
    up = !up
  }
  return wps
}

function SectorCanvas({ waypoints }: { waypoints: Waypoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const wpRef = useRef<Waypoint[]>(waypoints)
  useEffect(() => { wpRef.current = waypoints }, [waypoints])

  useEffect(() => {
    const el = containerRef.current!
    const cv = canvasRef.current!
    const ctx = cv.getContext('2d')!
    if (!el || !cv || !ctx) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let w = 0, h = 0, tick = 0

    const resize = () => {
      const dpr = Math.min(devicePixelRatio, 2)
      w = el.clientWidth; h = el.clientHeight
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr)
      cv.style.width = `${w}px`; cv.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    // Map mission (x,y) coordinates → canvas px, fitting the waypoint bounds.
    const project = (wps: Waypoint[]) => {
      const pad = Math.min(w, h) * 0.14
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      wps.forEach((p) => {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
      })
      let rx = maxX - minX, ry = maxY - minY
      if (!isFinite(rx) || rx === 0) { rx = 1; minX -= 0.5 }
      if (!isFinite(ry) || ry === 0) { ry = 1; minY -= 0.5 }
      const s = Math.min((w - pad * 2) / rx, (h - pad * 2) / ry)
      const ox = (w - rx * s) / 2, oy = (h - ry * s) / 2
      return wps.map((p) => [ox + (p.x - minX) * s, h - (oy + (p.y - minY) * s)] as [number, number])
    }

    const frame = () => {
      if (w === 0 || h === 0) { rafRef.current = requestAnimationFrame(frame); return }
      ctx.clearRect(0, 0, w, h)

      // grid
      ctx.strokeStyle = 'rgba(22,40,62,0.9)'; ctx.lineWidth = 0.5
      for (let i = 0; i <= 10; i++) { const x = (i / 10) * w; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke() }
      for (let i = 0; i <= 8; i++) { const y = (i / 8) * h; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
      // faint contour lines for texture
      for (let li = 0; li < 3; li++) {
        ctx.strokeStyle = `rgba(72,229,242,${0.05 + li * 0.02})`; ctx.lineWidth = 1
        ctx.beginPath()
        for (let px = 0; px <= w; px += 5) {
          const py = h * (0.22 + li * 0.28) + Math.sin((px / w) * Math.PI * 3 + li) * h * 0.03
          px === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
        }
        ctx.stroke()
      }

      const wps = wpRef.current
      const pts = wps.length ? project(wps) : []

      if (pts.length >= 2) {
        ctx.strokeStyle = 'rgba(72,229,242,0.32)'; ctx.lineWidth = 1.2
        ctx.setLineDash([5, 8]); ctx.beginPath()
        ctx.moveTo(pts[0][0], pts[0][1])
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
        ctx.stroke(); ctx.setLineDash([])
      }

      const pulse = reduced ? 0.6 : Math.sin(tick * 0.06) * 0.4 + 0.6
      pts.forEach(([x, y], i) => {
        const first = i === 0, lastwp = i === pts.length - 1
        if (first || lastwp) {
          const c = first ? '59,232,150' : '72,229,242'
          const glow = ctx.createRadialGradient(x, y, 1, x, y, 16)
          glow.addColorStop(0, `rgba(${c},${0.2 + pulse * 0.25})`); glow.addColorStop(1, `rgba(${c},0)`)
          ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.fill()
          ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = first ? '#3be896' : '#48e5f2'; ctx.fill()
        } else {
          ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fillStyle = 'rgba(120,169,255,0.65)'; ctx.fill()
        }
      })

      // honest label: waypoints are real; live rover position is not available offline
      if (pts.length) {
        const lbl = `${wps.length} waypoint${wps.length === 1 ? '' : 's'} · live position offline`
        ctx.font = `10px 'SF Mono',Menlo,monospace`
        ctx.fillStyle = 'rgba(90,115,150,0.9)'
        ctx.fillText(lbl, 12, h - 12)
      } else {
        ctx.font = `11px 'SF Mono',Menlo,monospace`; ctx.fillStyle = 'rgba(90,115,150,0.9)'
        ctx.fillText('No waypoints yet — pick a zone and Dispatch Survey (right) to generate them', 12, h / 2)
      }

      if (!reduced) tick++
      rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)
    const ro = new ResizeObserver(resize); ro.observe(el)
    return () => { cancelAnimationFrame(rafRef.current); ro.disconnect() }
  }, [])

  return (
    <div ref={containerRef} style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0 }} />
    </div>
  )
}

// ─── Status → chip ────────────────────────────────────────────────────────────

function statusChipClass(status: string): string {
  const s = status.toLowerCase()
  if (s === 'active') return 'dk-chip ok'
  if (s === 'approved' || s === 'completed') return 'dk-chip ok'
  if (s === 'pending' || s === 'draft') return 'dk-chip standby'
  if (s === 'aborted') return 'dk-chip crit'
  return 'dk-chip prov'
}

// Derive a real, honest timeline from a mission's actual lifecycle fields.
interface DStep { title: string; detail: string; status: 'done' | 'live' | 'pending' }
function deriveSteps(m: Mission): DStep[] {
  const s = m.status.toLowerCase()
  const approved = !!m.approved_by
  const steps: DStep[] = [
    { title: 'MISSION CREATED', detail: `${m.name} · rover ${m.rover}`, status: 'done' },
    {
      title: approved ? `APPROVED · ${m.approved_by}` : 'APPROVAL PENDING',
      detail: approved ? (m.approved_on ?? '').slice(0, 19) : 'awaiting mission approver',
      status: approved ? 'done' : s === 'pending' ? 'live' : 'pending',
    },
    {
      title: `STATUS · ${m.status.toUpperCase()}`,
      detail: `${m.waypoints?.length ?? 0} waypoint${(m.waypoints?.length ?? 0) === 1 ? '' : 's'}`,
      status: s === 'active' ? 'live' : s === 'completed' ? 'done' : 'pending',
    },
  ]
  return steps
}

function Dot({ status }: { status: DStep['status'] }) {
  if (status === 'done') return <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--ok)', flexShrink: 0 }} />
  if (status === 'live') return (
    <motion.div
      animate={{ opacity: [0.4, 1, 0.4], scale: [0.85, 1.25, 0.85] }}
      transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
      style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid var(--cyan)', flexShrink: 0 }}
    />
  )
  return <div style={{ width: 10, height: 10, borderRadius: '50%', border: '1.5px solid var(--dim)', flexShrink: 0 }} />
}

// ─── Survey dispatch panel ────────────────────────────────────────────────────

const DISPATCH_ROVER = 'MARK1-SIM-001'

const ZONE_PRESETS: Array<{ label: string; zone: [number, number, number, number] }> = [
  { label: '30×30 m @ spawn', zone: [-15, -15, 15, 15] },
  { label: '60×60 m', zone: [-30, -30, 30, 30] },
  { label: '20×10 m N-strip', zone: [-10, 0, 10, 10] },
]

interface MissionProgress {
  mission_id: string
  state: string         // active | complete | aborted | failed
  waypoint_i: number
  waypoint_n: number
  coverage_pct: number
  awaiting_approval: boolean
  pending_wp: number
  stamp: number
}

const DISPATCH_POLL_MS = 3000

function DispatchPanel() {
  const { pushEvent } = useDeck()
  const [presetIdx, setPresetIdx] = useState(0)
  const [dispatching, setDispatching] = useState(false)
  const [activeMissionId, setActiveMissionId] = useState<string | null>(null)
  const [progress, setProgress] = useState<MissionProgress | null>(null)
  const [dispatchErr, setDispatchErr] = useState<string | null>(null)

  // Poll tlm/mission whenever we have an active mission
  useEffect(() => {
    if (!activeMissionId) return
    let alive = true
    const poll = async () => {
      try {
        const latest = await telemetryLatest(DISPATCH_ROVER)
        if (!alive) return
        const ms = latest.kinds['mission']
        if (!ms?.data) return
        const d = ms.data as Record<string, unknown>
        if (d['mission_id'] !== activeMissionId) return
        setProgress({
          mission_id: d['mission_id'] as string,
          state: d['state'] as string ?? '?',
          waypoint_i: Number(d['waypoint_i'] ?? 0),
          waypoint_n: Number(d['waypoint_n'] ?? 0),
          coverage_pct: Number(d['coverage_pct'] ?? 0),
          awaiting_approval: Boolean(d['awaiting_approval']),
          pending_wp: Number(d['pending_wp'] ?? -1),
          stamp: Number(d['stamp'] ?? 0),
        })
        const state = d['state'] as string
        if (state === 'complete' || state === 'aborted' || state === 'failed') {
          pushEvent('mission', `${activeMissionId} → ${state.toUpperCase()}`,
            state === 'complete' ? 'ok' : 'warn')
        }
      } catch { /* gateway unreachable — keep retrying */ }
    }
    poll()
    const t = setInterval(poll, DISPATCH_POLL_MS)
    return () => { alive = false; clearInterval(t) }
  }, [activeMissionId, pushEvent])

  const isActive = progress && (progress.state === 'active')

  const [approving, setApproving] = useState(false)
  const handleApproval = async (decision: 'approve' | 'deny') => {
    if (!progress) return
    setApproving(true)
    try {
      await approveWaypoint({ rover_id: DISPATCH_ROVER, mission_id: progress.mission_id, decision, waypoint_i: progress.pending_wp })
      pushEvent('mission', `wp ${progress.pending_wp} ${decision === 'approve' ? 'APPROVED' : 'DENIED'}`, decision === 'approve' ? 'ok' : 'warn')
    } catch { /* keep prompt; operator can retry */ } finally { setApproving(false) }
  }

  const handleDispatch = async () => {
    if (isActive) { pushEvent('mission', 'a survey is already running — abort it first', 'warn'); return }
    if (!window.confirm(`Dispatch a survey over ${ZONE_PRESETS[presetIdx].label}? This commands the rover.`)) return
    setDispatching(true)
    setDispatchErr(null)
    setProgress(null)
    try {
      const preset = ZONE_PRESETS[presetIdx]
      const res = await dispatchSurvey({
        rover_id: DISPATCH_ROVER,
        zone: preset.zone,
        lane_spacing_m: 3.0,
        speed: 0.28,
      })
      setActiveMissionId(res.mission_id)
      pushEvent('mission', `dispatched ${res.mission_id} (${preset.label})`, 'ok')
    } catch (e) {
      setDispatchErr((e as Error).message)
    } finally {
      setDispatching(false)
    }
  }

  const handleAbort = async () => {
    if (!activeMissionId) return
    setDispatchErr(null)
    try {
      await abortMission({ rover_id: DISPATCH_ROVER, mission_id: activeMissionId })
      pushEvent('mission', `abort sent → ${activeMissionId}`, 'warn')
    } catch (e) {
      setDispatchErr((e as Error).message)
    }
  }

  const stateColor = (s: string) => {
    if (s === 'active') return 'var(--cyan)'
    if (s === 'complete') return 'var(--ok)'
    if (s === 'aborted' || s === 'failed') return 'var(--crit)'
    return 'var(--dim)'
  }

  return (
    <Panel title="Dispatch Survey" meta={<>MARK1-SIM-001</>} style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--dim)', lineHeight: 1.5 }}>
          Pick a zone; the rover sweeps it in 3 m lanes and tracks how much of it it covered.
        </div>
        {/* zone selector */}
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)', marginBottom: 5, letterSpacing: '0.08em' }}>
            ZONE PRESET
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {ZONE_PRESETS.map((p, i) => (
              <button
                key={p.label}
                className="dk-btn"
                style={i === presetIdx ? { borderColor: 'var(--cyan)', color: 'var(--cyan)' } : undefined}
                onClick={() => setPresetIdx(i)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)', marginTop: 5 }}>
            zone {ZONE_PRESETS[presetIdx].zone.join(', ')} m · lane 3 m · 0.28 m/s
          </div>
        </div>

        {/* dispatch / abort buttons */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="dk-btn primary"
            disabled={dispatching || !!isActive}
            onClick={handleDispatch}
          >
            {dispatching ? 'DISPATCHING…' : isActive ? 'SURVEY RUNNING' : 'DISPATCH SURVEY'}
          </button>
          {activeMissionId && (
            <button
              className="dk-btn"
              style={{ borderColor: 'var(--crit)', color: 'var(--crit)' }}
              disabled={!isActive}
              onClick={handleAbort}
            >
              ABORT
            </button>
          )}
        </div>
        {isActive && (
          <div style={{ fontSize: 10.5, color: 'var(--dim)', lineHeight: 1.4 }}>
            One survey at a time — abort the running one before dispatching another.
          </div>
        )}

        {dispatchErr && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--crit)' }}>
            {dispatchErr}
          </div>
        )}

        {/* live progress strip */}
        {activeMissionId && (
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)', letterSpacing: '0.08em', marginBottom: 6 }}>
              MISSION PROGRESS
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--white)', marginBottom: 4 }}>
              {activeMissionId}
            </div>
            {progress ? (
              <>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 6 }}>
                  <span>
                    <span style={{ color: 'var(--dim)', fontSize: 10 }}>STATE </span>
                    <span style={{ color: stateColor(progress.state), fontFamily: 'var(--mono)', fontSize: 11 }}>
                      {progress.state.toUpperCase()}
                    </span>
                  </span>
                  <span>
                    <span style={{ color: 'var(--dim)', fontSize: 10 }}>WP </span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                      {progress.waypoint_i}/{progress.waypoint_n}
                    </span>
                  </span>
                  <span>
                    <span style={{ color: 'var(--dim)', fontSize: 10 }}>COV </span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                      {progress.coverage_pct.toFixed(1)}%
                    </span>
                  </span>
                </div>
                {/* coverage bar */}
                <div style={{ height: 4, borderRadius: 2, background: 'var(--line)', overflow: 'hidden' }}>
                  <motion.div
                    animate={{ width: `${Math.min(100, progress.coverage_pct)}%` }}
                    transition={{ duration: 0.4 }}
                    style={{ height: '100%', background: progress.state === 'awaiting_approval' ? 'var(--warn)' : progress.state === 'complete' ? 'var(--ok)' : 'var(--cyan)', borderRadius: 2 }}
                  />
                </div>
                {progress.awaiting_approval && (
                  <div style={{ marginTop: 10, padding: '10px 12px', border: '1px solid rgba(255,180,84,0.5)', borderRadius: 6, background: 'rgba(255,180,84,0.06)' }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--warn)', letterSpacing: '0.06em', fontWeight: 700 }}>
                      ⏸ L2 SUPERVISED — APPROVAL REQUIRED
                    </div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--dim)', marginTop: 4, lineHeight: 1.5 }}>
                      Rover paused before waypoint {progress.pending_wp}. Approve to proceed, or deny to skip it.
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button className="dk-btn primary" disabled={approving} onClick={() => handleApproval('approve')}>
                        {approving ? '…' : 'APPROVE'}
                      </button>
                      <button className="dk-btn" disabled={approving} style={{ borderColor: 'rgba(255,77,106,0.4)' }} onClick={() => handleApproval('deny')}>
                        DENY (skip)
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)' }}>
                waiting for rover telemetry…
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function MissionsView() {
  const { pushEvent } = useDeck()
  const nav = useNavigate()
  const [list, setList] = useState<Mission[] | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [detail, setDetail] = useState<Mission | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // Load the mission list once; default-select the first (Active preferred).
  useEffect(() => {
    let alive = true
    fetchMissions()
      .then((ms) => {
        if (!alive) return
        setList(ms); setErr(null)
        const active = ms.find((m) => m.status.toLowerCase() === 'active')
        setSel((active ?? ms[0])?.name ?? null)
      })
      .catch((e) => { if (alive) setErr((e as Error).message) })
    return () => { alive = false }
  }, [])

  // Load the selected mission's full record (waypoints).
  useEffect(() => {
    if (!sel) { setDetail(null); return }
    let alive = true
    fetchMission(sel).then((m) => { if (alive) setDetail(m) }).catch(() => { if (alive) setDetail(null) })
    return () => { alive = false }
  }, [sel])

  const steps = useMemo(() => (detail ? deriveSteps(detail) : []), [detail])
  const waypoints = detail?.waypoints ?? []
  const previewWps = useMemo<Waypoint[]>(() => {
    if (waypoints.length) return []
    try {
      const pl = detail?.mission_payload ? JSON.parse(detail.mission_payload) : null
      if (Array.isArray(pl?.zone)) return surveyPreview(pl.zone, Number(pl.lane_spacing_m) || 3)
    } catch { /* payload not a survey */ }
    return []
  }, [detail, waypoints.length])
  const sectorWps = waypoints.length ? waypoints : previewWps

  const head = detail ?? list?.find((m) => m.name === sel) ?? null

  return (
    <div style={{ position: 'absolute', inset: 0, padding: '22px 24px', display: 'grid', gridTemplateRows: 'auto 1fr', gap: 16, overflow: 'hidden' }}>
      {/* header — driven by the selected real mission */}
      <div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)', letterSpacing: '0.1em', marginBottom: 6 }}>
          MISSION CONTROL · {head?.name ?? '—'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 5 }}>
          <h1 style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 700, color: 'var(--white)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {head?.title ?? (err ? 'Missions unavailable' : list === null ? 'Loading…' : 'No missions')}
          </h1>
          {head && <span className={statusChipClass(head.status)}>{head.status.toUpperCase()}</span>}
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--dim)' }}>
          {head ? <>rover {head.rover} · {waypoints.length} waypoint{waypoints.length === 1 ? '' : 's'} · live from the control plane</>
                : err ? <span style={{ color: 'var(--crit)' }}>{err}</span>
                : 'reading /api/missions…'}
        </div>
      </div>

      <HelpNote>
        A <b>mission</b> is a job for the rover. Pick a <b>survey zone</b> (right) → the system lays a
        lawnmower pattern of waypoints → it's <b>approved</b> → signed &amp; sent to the rover → the rover
        drives the pattern and reports <b>% coverage</b> back here. Read-only until your signing agent is
        running (bottom bar).
      </HelpNote>

      {/* body */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr', gap: 14, minHeight: 0 }}>
        {/* left: sector map from real waypoints */}
        <Panel title="Sector Map" meta={<>{waypoints.length ? 'waypoints' : previewWps.length ? 'preview · planned coverage' : 'waypoints'} · fit</>} style={{ display: 'flex', flexDirection: 'column' }}>
          <SectorCanvas waypoints={sectorWps} />
        </Panel>

        {/* centre: mission selector + real lifecycle */}
        <Panel title="Mission" meta={<>{list ? `${list.length} on file` : '—'}</>} style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '10px 14px 0' }}>
            {/* selector */}
            {list && list.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {list.map((m) => (
                  <button
                    key={m.name}
                    onClick={() => setSel(m.name)}
                    className="dk-btn"
                    style={m.name === sel ? { borderColor: 'var(--cyan)', color: 'var(--cyan)' } : undefined}
                  >
                    {m.name.replace(/^MSN-/, '')}
                  </button>
                ))}
              </div>
            )}

            {/* lifecycle timeline */}
            <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 4 }}>
              {steps.map((s, i) => (
                <motion.div
                  key={s.title}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06, duration: 0.26, ease: 'easeOut' }}
                  style={{ display: 'flex', gap: 12 }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                    <div style={{ paddingTop: 1 }}><Dot status={s.status} /></div>
                    {i < steps.length - 1 && <div style={{ width: 1, flex: 1, minHeight: 18, marginTop: 5, background: s.status === 'done' ? 'rgba(59,232,150,0.38)' : 'var(--line)' }} />}
                  </div>
                  <div style={{ paddingBottom: i === steps.length - 1 ? 4 : 16 }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, lineHeight: 1.4, color: s.status === 'live' ? 'var(--cyan)' : s.status === 'done' ? 'var(--ok)' : 'var(--dim)' }}>{s.title}</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)', marginTop: 2, lineHeight: 1.5 }}>{s.detail}</div>
                  </div>
                </motion.div>
              ))}
              {!steps.length && !err && <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--dim)' }}>select a mission…</div>}
            </div>

            {/* actions — writes stay in the audited classic console */}
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, paddingBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="dk-btn primary" onClick={() => { pushEvent('mission', 'opening mission console (classic)'); nav('/missions') }}>
                Manage in Console
              </button>
              <button className="dk-btn" onClick={() => { setList(null); setErr(null); fetchMissions().then((ms) => { setList(ms); const a = ms.find((m) => m.status.toLowerCase() === 'active'); setSel((a ?? ms[0])?.name ?? null) }).catch((e) => setErr((e as Error).message)) }}>
                Refresh
              </button>
            </div>
          </div>
        </Panel>

        {/* right: survey quick-dispatch */}
        <DispatchPanel />
      </div>
    </div>
  )
}
