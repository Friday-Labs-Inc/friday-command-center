import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useDeck } from '../data'
import { Panel, ViewHead, SimBadge, Legend } from '../bits'

function terrainH(x: number, z: number): number {
  // ~2x vertical exaggeration so ridges + the gully read as real relief at the
  // deck's 3/4 camera angle. Everything on the surface (rover, detections) reads
  // this same function, so they stay planted.
  return 2.05 * (
    Math.sin(x * 0.28) * 0.45 +
    Math.cos(z * 0.22) * 0.32 +
    Math.sin(x * 0.71 + z * 0.48) * 0.16 +
    Math.cos(x * 0.15 - z * 0.3) * 0.2 +
    Math.sin(x * 1.6 + z * 1.1) * 0.07 -
    0.95 * Math.exp(-((x - 0.8) ** 2 + (z + 0.4) ** 2) / 2.5)
  )
}

export function TerrainView() {
  const mountRef = useRef<HTMLDivElement>(null)
  const { pushEvent } = useDeck()
  const pushRef = useRef(pushEvent)
  useEffect(() => { pushRef.current = pushEvent }, [pushEvent])

  const roverLbl = useRef<HTMLDivElement>(null)
  const det1Lbl  = useRef<HTMLDivElement>(null)
  const det2Lbl  = useRef<HTMLDivElement>(null)
  const det3Lbl  = useRef<HTMLDivElement>(null)

  const [seg, setSeg] = useState(0)
  const [pts, setPts] = useState(0)
  const [cov, setCov] = useState(0)
  const gated = useRef(false)

  useEffect(() => {
    const iv = setInterval(() => {
      setSeg(s => Math.min(s + Math.floor(Math.random() * 14 + 8), 1284))
      setPts(p => Math.min(p + Math.floor(Math.random() * 7200 + 3800), 8_300_000))
      setCov(c => Math.min(c + Math.random() * 0.9 + 0.3, 87))
    }, 280)
    return () => clearInterval(iv)
  }, [])

  // Gate-crossing event fires from an effect (never from inside a setState
  // updater — that runs during render and would setState another component).
  useEffect(() => {
    if (cov >= 50 && !gated.current) {
      gated.current = true
      pushRef.current('research', 'MapSegment stream · gate passed', 'ai')
    }
  }, [cov])

  useEffect(() => {
    // `!` keeps the non-null type inside the hoisted prj() closure below
    const mount = mountRef.current!
    if (!mount) return

    const W = mount.clientWidth || 800
    const H = mount.clientHeight || 600

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.setSize(W, H)
    renderer.setClearColor(0x000000, 0)
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const pivot = new THREE.Group()
    scene.add(pivot)

    const camera = new THREE.PerspectiveCamera(52, W / H, 0.01, 500)
    camera.position.set(0, 7.5, 13)
    camera.lookAt(0, 0, 0)

    // ── Terrain ──────────────────────────────────────────────────────────────
    const SX = 96, SZ = 56, FW = 18, FD = 10.5
    const geo = new THREE.PlaneGeometry(FW, FD, SX, SZ)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position as THREE.BufferAttribute
    const VC = pos.count
    const hs = new Float32Array(VC)
    let hMin = Infinity, hMax = -Infinity
    for (let i = 0; i < VC; i++) {
      const h = terrainH(pos.getX(i) / FW * 5, pos.getZ(i) / FD * 5)
      hs[i] = h
      if (h < hMin) hMin = h
      if (h > hMax) hMax = h
    }
    for (let i = 0; i < VC; i++) pos.setY(i, hs[i])
    pos.needsUpdate = true
    geo.computeVertexNormals()

    // Reveal times — distance from entry corner (-FW/2, -FD/2) + jitter
    const maxD = Math.sqrt(FW * FW + FD * FD)
    const revT = new Float32Array(VC)
    for (let i = 0; i < VC; i++) {
      const dx = pos.getX(i) + FW / 2
      const dz = pos.getZ(i) + FD / 2
      revT[i] = (Math.sqrt(dx * dx + dz * dz) / maxD) * 12 + (Math.random() - 0.5) * 0.9
    }

    // Target colors by elevation — deep dark teal in the valleys → bright
    // cyan/white on the ridges, for strong relief contrast on the wireframe.
    const hRange = hMax - hMin
    const tgt = new Float32Array(VC * 3)
    for (let i = 0; i < VC; i++) {
      const t = (hs[i] - hMin) / hRange
      const e = t * t * (3 - 2 * t) // smoothstep for punchier midtones
      tgt[i * 3]     = 0.03 + e * 0.52
      tgt[i * 3 + 1] = 0.16 + e * 0.78
      tgt[i * 3 + 2] = 0.26 + e * 0.66
    }
    const colBuf = new Float32Array(VC * 3)
    const colAttr = new THREE.BufferAttribute(colBuf, 3)
    geo.setAttribute('color', colAttr)

    const mat = new THREE.MeshBasicMaterial({ wireframe: true, vertexColors: true })
    pivot.add(new THREE.Mesh(geo, mat))

    // ── Scanning cone ─────────────────────────────────────────────────────────
    const FANS = 30, SANG = Math.PI / 2.6
    const cV = new Float32Array((FANS + 2) * 3)
    // cV[0..2] = center (stays 0,0,0); arc verts start at index 1
    for (let i = 0; i <= FANS; i++) {
      const a = -SANG / 2 + (i / FANS) * SANG
      cV[(i + 1) * 3]     = Math.sin(a) * 3.8
      cV[(i + 1) * 3 + 1] = 0.04
      cV[(i + 1) * 3 + 2] = -Math.cos(a) * 3.8
    }
    const cIdx = new Uint16Array(FANS * 3)
    for (let i = 0; i < FANS; i++) {
      cIdx[i * 3] = 0; cIdx[i * 3 + 1] = i + 1; cIdx[i * 3 + 2] = i + 2
    }
    const coneG = new THREE.BufferGeometry()
    coneG.setAttribute('position', new THREE.BufferAttribute(cV, 3))
    coneG.setIndex(new THREE.BufferAttribute(cIdx, 1))
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0x48e5f2, transparent: true, opacity: 0.13, side: THREE.DoubleSide,
    })
    const coneMesh = new THREE.Mesh(coneG, coneMat)
    pivot.add(coneMesh)

    // ── Rover sphere ──────────────────────────────────────────────────────────
    const roverG = new THREE.SphereGeometry(0.19, 10, 7)
    const roverM = new THREE.MeshBasicMaterial({ color: 0x3be896 })
    const rover  = new THREE.Mesh(roverG, roverM)
    pivot.add(rover)
    const pathX0 = -FW / 2 + 1.4, pathX1 = FW / 2 - 1.4, pathZ = 1.2

    // ── Detection markers ─────────────────────────────────────────────────────
    type DM = { wp: THREE.Vector3; ref: { current: HTMLDivElement | null } }
    const defs: DM[] = [
      { wp: new THREE.Vector3(-3.1, 0,  0.7), ref: det1Lbl },
      { wp: new THREE.Vector3( 2.2, 0, -1.4), ref: det2Lbl },
      { wp: new THREE.Vector3( 5.4, 0,  2.0), ref: det3Lbl },
    ]
    defs.forEach(d => { d.wp.y = terrainH(d.wp.x / FW * 5, d.wp.z / FD * 5) + 0.25 })
    const dGeo  = new THREE.OctahedronGeometry(0.23, 0)
    const dMats = [
      new THREE.MeshBasicMaterial({ color: 0xffb454 }),
      new THREE.MeshBasicMaterial({ color: 0xff4d6a }),
      new THREE.MeshBasicMaterial({ color: 0xffb454 }),
    ]
    const dMeshes = defs.map((d, i) => {
      const m = new THREE.Mesh(dGeo, dMats[i])
      m.position.copy(d.wp); m.scale.setScalar(0); pivot.add(m); return m
    })
    const dRevT = defs.map(d => {
      const dx = d.wp.x + FW / 2, dz = d.wp.z + FD / 2
      return (Math.sqrt(dx * dx + dz * dz) / maxD) * 12 + 1.2
    })

    // ── Mouse parallax ────────────────────────────────────────────────────────
    let mx = 0, my = 0
    const onPtr = (e: MouseEvent) => {
      mx = (e.clientX / window.innerWidth  - 0.5) * 2
      my = (e.clientY / window.innerHeight - 0.5) * 2
    }
    mount.addEventListener('pointermove', onPtr)
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

    // ── Resize observer ───────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      const nW = mount.clientWidth, nH = mount.clientHeight
      camera.aspect = nW / nH; camera.updateProjectionMatrix()
      renderer.setSize(nW, nH)
    })
    ro.observe(mount)

    // Project world→screen (returns coords in mount's client rect)
    function prj(v: THREE.Vector3): { x: number; y: number; vis: boolean } {
      const p = v.clone().project(camera)
      return {
        x:   (p.x + 1) / 2 * mount.clientWidth,
        y:   (1 - (p.y + 1) / 2) * mount.clientHeight,
        vis: p.z < 1,
      }
    }

    // ── Animation loop ────────────────────────────────────────────────────────
    const clock = new THREE.Clock()
    let raf = 0

    const loop = () => {
      raf = requestAnimationFrame(loop)
      const t = clock.getElapsedTime()

      if (!reduced) pivot.rotation.y = t * 0.04 + mx * 0.06
      pivot.rotation.x = -0.05 + my * 0.025

      // Terrain reveal — fade each vertex from dark to target color
      for (let i = 0; i < VC; i++) {
        const p = Math.max(0, Math.min(1, (t - revT[i]) / 0.55))
        colBuf[i * 3]     = tgt[i * 3]     * p
        colBuf[i * 3 + 1] = tgt[i * 3 + 1] * p
        colBuf[i * 3 + 2] = tgt[i * 3 + 2] * p
      }
      colAttr.needsUpdate = true

      // Rover crawl — back-and-forth survey line, 26 s half-period
      const rc = (t % 52) / 52
      const rx = rc < 0.5
        ? pathX0 + (pathX1 - pathX0) * (rc * 2)
        : pathX1 - (pathX1 - pathX0) * ((rc - 0.5) * 2)
      rover.position.set(rx, terrainH(rx / FW * 5, pathZ / FD * 5) + 0.22, pathZ)

      // Cone tracks rover and sweeps
      coneMesh.position.copy(rover.position)
      coneMesh.rotation.y = t * 0.7

      // Detection markers pop in after their zone is revealed
      dMeshes.forEach((m, i) => {
        m.scale.setScalar(Math.max(0, Math.min(1, (t - dRevT[i]) / 0.4)))
        m.rotation.y = t * 0.5
      })

      // Project HTML labels
      const rw = pivot.localToWorld(rover.position.clone())
      rw.y += 0.5
      const rs = prj(rw)
      if (roverLbl.current) {
        roverLbl.current.style.transform =
          `translate(calc(${rs.x}px - 50%), calc(${rs.y}px - 140%))`
        roverLbl.current.style.opacity = rs.vis ? '1' : '0'
      }

      defs.forEach((d, i) => {
        const lw = pivot.localToWorld(d.wp.clone())
        lw.y += 0.55
        const ls = prj(lw)
        const el = d.ref.current
        if (el) {
          el.style.transform =
            `translate(calc(${ls.x}px - 50%), calc(${ls.y}px - 130%))`
          el.style.opacity = dMeshes[i].scale.x > 0.1 ? '1' : '0'
        }
      })

      renderer.render(scene, camera)
    }
    loop()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      mount.removeEventListener('pointermove', onPtr)
      geo.dispose(); mat.dispose()
      coneG.dispose(); coneMat.dispose()
      roverG.dispose(); roverM.dispose()
      dGeo.dispose(); dMats.forEach(m => m.dispose())
      renderer.dispose()
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
    }
  }, [])

  const lbl = (c: string): { [k: string]: string | number } => ({
    position:       'absolute',
    top:            0,
    left:           0,
    pointerEvents:  'none',
    fontSize:       '9px',
    fontFamily:     'var(--mono)',
    color:          c,
    letterSpacing:  '0.06em',
    background:     'rgba(4,7,12,0.82)',
    padding:        '1px 5px',
    borderRadius:   '2px',
    border:         `1px solid ${c}55`,
    whiteSpace:     'nowrap',
    transition:     'opacity 0.3s',
    opacity:        '0',
  })

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: 'var(--void)' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />

      <ViewHead
        eyebrow="ENVIRONMENT RECONSTRUCTION · RESEARCH DECK"
        title="Terrain · Live"
        sub={<>SLAM MapSegments streaming over the data gate — raw sensor data never leaves the rover</>}
      />

      <div style={{ position: 'absolute', top: 16, right: 16, width: 224 }}>
        <Panel title="Segment Stream" meta={<>10.0.1.3 → core</>}>
          <div className="dk-kv">
            <span className="k">segments</span>
            <span className="v">{seg.toLocaleString()}</span>
          </div>
          <div className="dk-kv">
            <span className="k">points</span>
            <span className="v">{(pts / 1e6).toFixed(2)} M</span>
          </div>
          <div className="dk-kv">
            <span className="k">coverage</span>
            <span className="v">{cov.toFixed(1)} %</span>
          </div>
          <div className="dk-kv">
            <span className="k">slam drift</span>
            <span className="v">0.03 m</span>
          </div>
          <div className="dk-kv">
            <span className="k">detections</span>
            <span className="v" style={{ color: 'var(--amber)' }}>3 tagged · amber</span>
          </div>
          <div style={{ marginTop: 8 }}>
            <SimBadge label="SIMULATED FEED · RESEARCH DECK PENDING" />
          </div>
        </Panel>
      </div>

      <Legend items={[
        ['#48e5f2', 'RECONSTRUCTED MESH'],
        ['#3be896', 'ROVER · WP-17'],
        ['#ffb454', 'DETECTION'],
        ['#5a7396', 'UNMAPPED'],
      ]} />

      {/* Projected HTML labels — positions set each frame by rAF */}
      <div ref={roverLbl} style={lbl('#3be896') as React.CSSProperties}>MARK1-001</div>
      <div ref={det1Lbl}  style={lbl('#ffb454') as React.CSSProperties}>MOISTURE ANOMALY</div>
      <div ref={det2Lbl}  style={lbl('#ff4d6a') as React.CSSProperties}>ROW OBSTRUCTION</div>
      <div ref={det3Lbl}  style={lbl('#ffb454') as React.CSSProperties}>ROCK DEPOSIT</div>
    </div>
  )
}
