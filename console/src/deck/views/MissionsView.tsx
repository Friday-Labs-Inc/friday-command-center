// MissionsView.tsx — illustrative mission control (canvas-2D sector map + DOM timeline)
// No live mission backend yet — data is hard-coded and labelled ILLUSTRATIVE.

import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { useDeck } from '../data'
import { Panel, SimBadge } from '../bits'

// ─── Types ────────────────────────────────────────────────────────────────────

type StepStatus = 'done' | 'live' | 'pending'

interface TStep {
  id: string
  status: StepStatus
  title: string
  detail: string
}

// ─── Illustrative mission timeline data ───────────────────────────────────────

const STEPS: TStep[] = [
  {
    id: 'upload',
    status: 'done',
    title: 'MISSION UPLOADED · SIGNED',
    detail: 'Ed25519 vasanth · nonce 8841',
  },
  {
    id: 'approval',
    status: 'done',
    title: 'APPROVAL · K. IYER',
    detail: 'draft → pending → approved',
  },
  {
    id: 'depart',
    status: 'done',
    title: 'DEPART DOCK · WP-01',
    detail: 'safe-stop budget verified 107 ms',
  },
  {
    id: 'survey',
    status: 'live',
    title: 'SURVEY LEG C · WP-17',
    detail: 'moisture 22.4% vwc · 0.41 m/s · heading 042°',
  },
  {
    id: 'drop',
    status: 'pending',
    title: 'SAMPLE CACHE DROP · WP-30',
    detail: 'requires operator approval',
  },
  {
    id: 'return',
    status: 'pending',
    title: 'RETURN & DOCK',
    detail: 'battery floor 32%',
  },
]

const VISITED = 17 // waypoints completed (1-indexed count)

// ─── Boustrophedon waypoint generator ────────────────────────────────────────

function buildWps(w: number, h: number): [number, number][] {
  const ROWS = 5
  const COLS = 9
  const px = w * 0.08
  const py = h * 0.12
  const uw = w - px * 2
  const uh = h - py * 2
  const pts: [number, number][] = []
  for (let r = 0; r < ROWS; r++) {
    const y = py + (r / (ROWS - 1)) * uh
    const ltr = r % 2 === 0
    for (let c = 0; c < COLS; c++) {
      const col = ltr ? c : COLS - 1 - c
      pts.push([px + (col / (COLS - 1)) * uw, y])
    }
  }
  return pts.slice(0, 42)
}

// ─── Sector canvas ────────────────────────────────────────────────────────────

function SectorCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const rafRef       = useRef<number>(0)

  useEffect(() => {
    // `!` keeps the non-null types inside the hoisted resize()/frame() closures
    const el = containerRef.current!
    const cv = canvasRef.current!
    const ctx = cv.getContext('2d')!
    if (!el || !cv || !ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let w = 0
    let h = 0
    let wps: [number, number][] = []
    let tick = 0

    function resize() {
      const dpr = Math.min(devicePixelRatio, 2)
      w = el.clientWidth
      h = el.clientHeight
      cv.width  = Math.round(w * dpr)
      cv.height = Math.round(h * dpr)
      cv.style.width  = `${w}px`
      cv.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      wps = buildWps(w, h)
    }
    resize()

    function frame() {
      if (w === 0 || h === 0) { rafRef.current = requestAnimationFrame(frame); return }
      ctx.clearRect(0, 0, w, h)

      // Faint grid
      ctx.strokeStyle = 'rgba(22,40,62,0.9)'
      ctx.lineWidth   = 0.5
      for (let i = 0; i <= 10; i++) {
        const x = (i / 10) * w
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke()
      }
      for (let i = 0; i <= 8; i++) {
        const y = (i / 8) * h
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
      }

      // Contour lines (dim sine curves)
      for (let li = 0; li < 4; li++) {
        ctx.strokeStyle = `rgba(72,229,242,${0.07 + li * 0.03})`
        ctx.lineWidth   = 1.2
        ctx.beginPath()
        for (let px2 = 0; px2 <= w; px2 += 4) {
          const py2 = h * (0.15 + li * 0.22) + Math.sin((px2 / w) * Math.PI * 3 + li * 1.1) * h * 0.04
          px2 === 0 ? ctx.moveTo(px2, py2) : ctx.lineTo(px2, py2)
        }
        ctx.stroke()
      }

      if (wps.length < 2) { rafRef.current = requestAnimationFrame(frame); return }

      // Dashed survey path
      ctx.strokeStyle = 'rgba(72,229,242,0.28)'
      ctx.lineWidth   = 1.2
      ctx.setLineDash([5, 8])
      ctx.beginPath()
      ctx.moveTo(wps[0][0], wps[0][1])
      for (let i = 1; i < wps.length; i++) ctx.lineTo(wps[i][0], wps[i][1])
      ctx.stroke()
      ctx.setLineDash([])

      // Waypoint dots
      wps.forEach(([x, y], i) => {
        ctx.beginPath()
        ctx.arc(x, y, i < VISITED ? 3 : 2, 0, Math.PI * 2)
        ctx.fillStyle = i < VISITED ? '#3be896' : 'rgba(90,115,150,0.5)'
        ctx.fill()
      })

      // Rover marker at WP-17 (index 16)
      const rover = wps[VISITED - 1]
      if (rover) {
        const [rx, ry] = rover
        const pulse = reduced ? 0.65 : Math.sin(tick * 0.07) * 0.45 + 0.55

        // Glow halo
        const glow = ctx.createRadialGradient(rx, ry, 2, rx, ry, 22)
        glow.addColorStop(0, `rgba(59,232,150,${0.28 + pulse * 0.3})`)
        glow.addColorStop(1, 'rgba(59,232,150,0)')
        ctx.fillStyle = glow
        ctx.beginPath(); ctx.arc(rx, ry, 22, 0, Math.PI * 2); ctx.fill()

        // Core dot
        ctx.beginPath(); ctx.arc(rx, ry, 5, 0, Math.PI * 2)
        ctx.fillStyle = '#3be896'; ctx.fill()

        // Pulsing ring
        ctx.beginPath(); ctx.arc(rx, ry, 10, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(59,232,150,${0.4 + pulse * 0.6})`
        ctx.lineWidth = 1.5; ctx.stroke()

        // Label
        const lbl = 'MARK1-001 · WP-17'
        ctx.font = `10px 'SF Mono',Menlo,monospace`
        const lw = ctx.measureText(lbl).width
        const lx = rx - lw / 2
        const ly = ry - 18
        ctx.fillStyle = 'rgba(4,7,12,0.88)'
        ctx.fillRect(lx - 4, ly - 12, lw + 8, 15)
        ctx.fillStyle = '#48e5f2'
        ctx.fillText(lbl, lx, ly)
      }

      if (!reduced) tick++
      rafRef.current = requestAnimationFrame(frame)
    }

    rafRef.current = requestAnimationFrame(frame)

    const ro = new ResizeObserver(resize)
    ro.observe(el)

    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, [])

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}
    >
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0 }} />
    </div>
  )
}

// ─── Timeline dot ─────────────────────────────────────────────────────────────

function Dot({ status }: { status: StepStatus }) {
  if (status === 'done') {
    return (
      <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--ok)', flexShrink: 0 }} />
    )
  }
  if (status === 'live') {
    return (
      <motion.div
        animate={{ opacity: [0.4, 1, 0.4], scale: [0.8, 1.3, 0.8] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          width: 12, height: 12, borderRadius: '50%',
          border: '2px solid var(--cyan)', flexShrink: 0,
        }}
      />
    )
  }
  return (
    <div style={{
      width: 10, height: 10, borderRadius: '50%',
      border: '1.5px solid var(--dim)', flexShrink: 0,
    }} />
  )
}

// ─── Timeline step row ────────────────────────────────────────────────────────

function StepRow({ step, idx, last }: { step: TStep; idx: number; last: boolean }) {
  const titleColor = step.status === 'live'
    ? 'var(--cyan)'
    : step.status === 'done' ? 'var(--ok)' : 'var(--dim)'
  const railColor = step.status === 'done' ? 'rgba(59,232,150,0.38)' : 'var(--line)'

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: idx * 0.07, duration: 0.28, ease: 'easeOut' }}
      style={{ display: 'flex', gap: 12 }}
    >
      {/* Rail column */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ paddingTop: 1 }}>
          <Dot status={step.status} />
        </div>
        {!last && (
          <div style={{ width: 1, flex: 1, minHeight: 18, marginTop: 5, background: railColor }} />
        )}
      </div>

      {/* Text */}
      <div style={{ paddingBottom: last ? 4 : 16 }}>
        <div style={{
          fontFamily: 'var(--mono)', fontSize: 11,
          color: titleColor, fontWeight: 600, lineHeight: 1.4,
        }}>
          {step.title}
        </div>
        <div style={{
          fontFamily: 'var(--mono)', fontSize: 10,
          color: 'var(--dim)', marginTop: 2, lineHeight: 1.5,
        }}>
          {step.detail}
        </div>
      </div>
    </motion.div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function MissionsView() {
  const { pushEvent } = useDeck()

  return (
    <div style={{
      position: 'absolute', inset: 0,
      padding: '22px 24px',
      display: 'grid',
      gridTemplateRows: 'auto 1fr',
      gap: 16,
      overflow: 'hidden',
    }}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div>
        <div style={{
          fontFamily: 'var(--mono)', fontSize: 10,
          color: 'var(--dim)', letterSpacing: '0.1em', marginBottom: 6,
        }}>
          MISSION CONTROL · M-2030-014
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 5 }}>
          <h1 style={{
            fontFamily: 'var(--sans)', fontSize: 22,
            fontWeight: 700, color: 'var(--white)', margin: 0,
          }}>
            NORTH FIELD SURVEY
          </h1>
          <SimBadge label="ILLUSTRATIVE · MISSION BACKEND PENDING" />
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--dim)' }}>
          soil-moisture grid · 42 waypoints · window 05:40–09:20 IST
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 14, minHeight: 0 }}>

        {/* Left: sector grid canvas */}
        <Panel
          title="Sector Grid"
          meta={<>N-14 · 3.2 ha</>}
          style={{ display: 'flex', flexDirection: 'column' }}
        >
          <SectorCanvas />
        </Panel>

        {/* Right: mission timeline */}
        <Panel
          title="Mission Timeline"
          meta={<>wp 17 / 42</>}
          style={{ display: 'flex', flexDirection: 'column' }}
        >
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '10px 14px 0' }}>
            <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 4 }}>
              {STEPS.map((s, i) => (
                <StepRow key={s.id} step={s} idx={i} last={i === STEPS.length - 1} />
              ))}
            </div>
            <div style={{
              borderTop: '1px solid var(--line)',
              paddingTop: 12, paddingBottom: 12,
              display: 'flex', gap: 8, flexWrap: 'wrap',
            }}>
              <button
                className="dk-btn primary"
                onClick={() => pushEvent('mission', 'WP-30 drop approved (illustrative)', 'ok')}
              >
                Approve WP-30 Drop
              </button>
              <button className="dk-btn">Hold Mission</button>
            </div>
          </div>
        </Panel>

      </div>
    </div>
  )
}
