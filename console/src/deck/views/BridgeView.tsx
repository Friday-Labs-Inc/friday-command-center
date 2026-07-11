// BridgeView — live 3D ROS 2 module-graph topology, THREE.js

import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useDeck, fleetSeats } from '../data'
import type { Seat } from '../data'
import { activeMode, type ActiveMode } from '../../lib/api'
import { ViewHead, SimBadge, Legend } from '../bits'

// Operating-mode ladder — index === autonomy_level (0..3), matches the Core Hub.
const MODE_LABELS = ['MANUAL', 'ASSISTED', 'WAYPOINT', 'AUTONOMOUS']

/* ── static extras (non-ESP32 architectural nodes) ─────────────────────────── */
const EXTRAS: Array<{ short: string; color: number }> = [
  { short: 'RESEARCH DECK', color: 0x9d7bff },
  { short: 'TELEMETRY',     color: 0xa8c6e8 },
]

/** Deterministic ring layout — alternates Y height for visual dome feel. */
function nodePolar(i: number, n: number): THREE.Vector3 {
  const θ = (i / n) * Math.PI * 2 - Math.PI / 2
  return new THREE.Vector3(Math.cos(θ) * 3.1, 0.3 + (i % 2) * 0.55, Math.sin(θ) * 3.1)
}

function stateHex(s: Seat['state']): number {
  if (s === 'live')     return 0x3be896
  if (s === 'degraded') return 0xffb454
  if (s === 'dead')     return 0xff4d6a
  return 0x5a7396
}

function mkSphere(r: number, c: number, op = 1): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(r, 16, 12),
    new THREE.MeshBasicMaterial({
      color: c, transparent: op < 1, opacity: op,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  )
}

function mkLine(a: THREE.Vector3, b: THREE.Vector3, c: number, op: number): THREE.Line {
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([a, b]),
    new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: op }),
  )
}

/* ── view ─────────────────────────────────────────────────────────────────── */
export function BridgeView() {
  const { modules, error } = useDeck()
  const seats = useMemo(() => fleetSeats(modules), [modules])

  const mountRef = useRef<HTMLDivElement>(null)
  const labsRef  = useRef<HTMLDivElement>(null)
  const seatsRef = useRef(seats)
  useEffect(() => { seatsRef.current = seats }, [seats])

  // Active operating mode — real, from /api/modes/active (the mode.json store on
  // the Core Hub). `null` + modeErr when the Core Hub is offline (honest state).
  const [mode, setMode] = useState<ActiveMode | null>(null)
  const [modeErr, setModeErr] = useState(false)
  useEffect(() => {
    let alive = true
    const load = () =>
      activeMode()
        .then((m) => { if (alive) { setMode(m); setModeErr(false) } })
        .catch(() => { if (alive) { setMode(null); setModeErr(true) } })
    load()
    const t = setInterval(load, 10000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const liveCount = modules?.filter(m => m.liveness === 'OK').length ?? 0
  const regCount  = modules?.length ?? 0

  /* ── three.js — runs once on mount ─────────────────────────────────────── */
  useEffect(() => {
    // `!` keeps the non-null type inside the hoisted rAF/label closures below
    // (TS drops control-flow narrowing across hoisted function declarations);
    // the runtime guard stays as defense.
    const el = mountRef.current!
    const ld = labsRef.current!
    if (!el || !ld) return

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.setSize(el.clientWidth, el.clientHeight)
    el.appendChild(renderer.domElement)

    const scene  = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(55, el.clientWidth / el.clientHeight, 0.1, 200)
    camera.position.set(0, 5.5, 11)
    camera.lookAt(0, 0.5, 0)

    // Ground grid
    const grid = new THREE.GridHelper(24, 24, 0x162840, 0x0d1e2e)
    grid.position.y = -0.8
    scene.add(grid)

    // All animated scene objects live in this group (slow auto-rotate)
    const group = new THREE.Group()
    scene.add(group)

    // ── Core hub: cyan sphere + outer glow + pulsing torus ring ─────────────
    const CORE  = new THREE.Vector3(0, 0.5, 0)
    const coreS = mkSphere(0.46, 0x48e5f2)
    const coreG = mkSphere(0.82, 0x48e5f2, 0.10)
    coreS.position.copy(CORE)
    coreG.position.copy(CORE)

    const ringM = new THREE.MeshBasicMaterial({
      color: 0x48e5f2, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
    const coreRing = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.022, 8, 64), ringM)
    coreRing.position.copy(CORE)
    coreRing.rotation.x = Math.PI / 2
    group.add(coreS, coreG, coreRing)

    // ── HTML label helper ────────────────────────────────────────────────────
    function mkLabel(txt: string, col = '#a8c6e8'): HTMLDivElement {
      const d = document.createElement('div')
      d.textContent = txt
      d.style.cssText = `position:absolute;pointer-events:none;font-family:var(--mono);` +
        `font-size:10px;color:${col};letter-spacing:.08em;text-shadow:0 0 7px ${col}99;` +
        `white-space:nowrap;transform:translateX(-50%)`
      ld.appendChild(d)
      return d
    }

    const coreLabel = mkLabel('CORE HUB', '#48e5f2')
    coreLabel.style.fontSize = '11px'
    coreLabel.style.fontWeight = '600'

    // ── Module + extra nodes ─────────────────────────────────────────────────
    const knownSeats = fleetSeats(null)
    const total = knownSeats.length + EXTRAS.length

    type NR = {
      mesh: THREE.Mesh; link: THREE.Line; pkt: THREE.Mesh
      pos: THREE.Vector3; seatIdx: number | null; label: HTMLDivElement
    }
    const nrs: NR[] = []

    for (let i = 0; i < total; i++) {
      const isX   = i >= knownSeats.length
      const seat  = isX ? null : knownSeats[i]
      const extra = isX ? EXTRAS[i - knownSeats.length] : null
      const col   = seat ? stateHex(seat.state) : (extra?.color ?? 0x5a7396)
      const lbl   = seat ? seat.short            : (extra?.short ?? 'NODE')
      const pos   = nodePolar(i, total)

      const mesh  = mkSphere(0.28, col)
      mesh.position.copy(pos)

      // Solid cyan for live links, very faint dim for non-live
      const link  = mkLine(pos, CORE, 0x48e5f2, seat?.state === 'live' ? 0.65 : 0.11)
      const pkt   = mkSphere(0.075, 0x3be896, 0.9)
      pkt.visible = false  // toggled by animation loop from live data

      group.add(mesh, link, pkt)
      nrs.push({ mesh, link, pkt, pos, seatIdx: isX ? null : i, label: mkLabel(lbl) })
    }

    // ── Resize observer ──────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    })
    ro.observe(el)

    // ── Mouse parallax ───────────────────────────────────────────────────────
    const mouse = { x: 0, y: 0 }
    const onPtr = (e: PointerEvent) => {
      mouse.x = (e.clientX / el.clientWidth  - 0.5) * 2
      mouse.y = (e.clientY / el.clientHeight - 0.5) * 2
    }
    el.addEventListener('pointermove', onPtr)

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const clock   = new THREE.Clock()
    const wp      = new THREE.Vector3()
    let   rafId   = 0

    // ── Animation loop ───────────────────────────────────────────────────────
    function tick() {
      rafId = requestAnimationFrame(tick)
      const t = clock.getElapsedTime()
      const W = el.clientWidth
      const H = el.clientHeight

      // Slow scene rotation
      if (!reduced) group.rotation.y = t * 0.08

      // Camera parallax (hover to peek around the graph)
      camera.position.x = mouse.x * 0.8
      camera.position.y = 5.5 - mouse.y * 0.5
      camera.lookAt(0, 0.5, 0)

      // Core ring pulse
      const pulse = 1 + 0.13 * Math.sin(t * 2.4)
      coreRing.scale.setScalar(pulse)
      ringM.opacity = 0.35 + 0.22 * Math.abs(Math.sin(t * 2.4))

      // Sync node colors + link opacity from live data each frame
      const cur = seatsRef.current
      nrs.forEach((nr, i) => {
        if (nr.seatIdx !== null) {
          const s = cur[nr.seatIdx]
          if (s) {
            const live = s.state === 'live';
            (nr.mesh.material as THREE.MeshBasicMaterial).color.setHex(stateHex(s.state));
            (nr.link.material as THREE.LineBasicMaterial).opacity = live ? 0.65 : 0.11
            nr.pkt.visible = live
          }
        }
        // Heartbeat packet travels from module → Core Hub in ~1.5 s, staggered per node
        if (nr.pkt.visible) {
          const tPkt = ((t / 1.5) + i / total) % 1
          nr.pkt.position.lerpVectors(nr.pos, CORE, tPkt)
        }
        // Project label to screen
        nr.mesh.getWorldPosition(wp)
        wp.project(camera)
        if (wp.z < 1) {
          nr.label.style.left    = `${(wp.x + 1) * 0.5 * W}px`
          nr.label.style.top     = `${(-wp.y + 1) * 0.5 * H - 22}px`
          nr.label.style.display = ''
        } else {
          nr.label.style.display = 'none'
        }
      })

      // Core hub label
      coreS.getWorldPosition(wp)
      wp.project(camera)
      coreLabel.style.left = `${(wp.x + 1) * 0.5 * W}px`
      coreLabel.style.top  = `${(-wp.y + 1) * 0.5 * H - 36}px`

      renderer.render(scene, camera)
    }
    tick()

    // ── Cleanup ──────────────────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(rafId)
      ro.disconnect()
      el.removeEventListener('pointermove', onPtr)
      scene.traverse(obj => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
          obj.geometry.dispose()
          const mat = obj.material
          if (Array.isArray(mat)) mat.forEach(m => m.dispose())
          else if (mat instanceof THREE.Material) mat.dispose()
        }
      })
      renderer.dispose()
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement)
      while (ld.firstChild) ld.removeChild(ld.firstChild)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── HTML chrome ─────────────────────────────────────────────────────────── */
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {/* Three.js canvas */}
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      {/* Projected node labels */}
      <div ref={labsRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />

      <ViewHead
        eyebrow="LIVE TOPOLOGY · ROS 2 DOMAIN 42"
        title="Mark 1 · Bridge"
        sub={<>{liveCount} live · {regCount} registered · authority held</>}
      />

      {/* Operating-mode pills — reflect the REAL active mode (mode.json on the Core Hub) */}
      <div style={{
        position: 'absolute', right: 18, bottom: 36,
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6,
      }}>
        {MODE_LABELS.map((label, i) => {
          const active = mode?.exists !== false && mode?.autonomy_level === i
          const cls = active ? 'dk-pill hot' : i === 3 ? 'dk-pill ai' : 'dk-pill'
          return <span key={label} className={cls}>{label}</span>
        })}
        <div style={{ marginTop: 8, textAlign: 'right' }}>
          {modeErr ? (
            <SimBadge label="CORE HUB OFFLINE · MODE UNKNOWN" />
          ) : mode == null ? (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 8.5, color: 'var(--dim)', letterSpacing: '0.14em' }}>READING MODE…</span>
          ) : mode.exists === false ? (
            <SimBadge label="NO MODE ACTIVATED YET" />
          ) : (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 8.5, color: 'var(--ice)', letterSpacing: '0.1em' }}>
              profile {mode.mission_profile} · brain {mode.brain}
            </span>
          )}
        </div>
      </div>

      <Legend items={[
        ['#48e5f2', 'CORE HUB'],
        ['#3be896', 'MODULE · LIVE'],
        ['#ffb454', 'STANDBY'],
        ['#9d7bff', 'AI DECK'],
        ['#5a7396', 'PROVISIONED'],
      ]} />

      {error && (
        <div style={{
          position: 'absolute', top: 80, left: 18,
          fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--dim)',
        }}>
          <span style={{ color: 'var(--crit)' }}>⚠ registry unreachable</span>
          {' '}— graph shows last-known seats
        </div>
      )}
    </div>
  )
}
