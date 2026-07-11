// MissionsView.tsx — mission control, wired to the REAL Frappe control plane.
// Reads live missions from /api/missions (+ /api/mission?name= for waypoints).
// The control plane runs on the gateway host, independent of rover hardware,
// so this is real whether or not the Pi is powered. Live rover POSITION needs
// telemetry (MQTT from the rover) — shown honestly as offline when absent.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { missions as fetchMissions, mission as fetchMission, type Mission, type Waypoint } from '../../lib/api'
import { useDeck } from '../data'
import { Panel } from '../bits'

// ─── Sector canvas — plots a mission's real waypoints (auto-fit) ───────────────

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
        ctx.fillText('no waypoints defined for this mission', 12, h / 2)
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

      {/* body */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 14, minHeight: 0 }}>
        {/* left: sector map from real waypoints */}
        <Panel title="Sector Map" meta={<>waypoints · fit</>} style={{ display: 'flex', flexDirection: 'column' }}>
          <SectorCanvas waypoints={waypoints} />
        </Panel>

        {/* right: mission selector + real lifecycle */}
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
      </div>
    </div>
  )
}
