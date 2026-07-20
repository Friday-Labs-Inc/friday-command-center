// TerrainView — the Command Center's REAL spatial awareness.
//
// The rover's SLAM occupancy grid crosses the radio as signed tlm/map
// snapshots (zlib+base64 over raw cells); this view inflates them in the
// browser and raises the known world in three.js: walls as extruded cells,
// free space as floor, unknown as darkness. The rover rides its own signed
// odometry. No fabricated feed remains — when there is no map telemetry the
// view says so instead of inventing terrain.

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { ROVERS, useDeck } from '../data'
import { Panel, ViewHead, Legend } from '../bits'
import { telemetryLatest } from '../../lib/api'
import type { TelemetrySample } from '../../lib/api'

const POLL_MS = 5000
const MAP_STALE_S = 60         // map only re-sends on change; be generous
const ODOM_STALE_S = 15
const WALL_MIN = 65            // occupancy >= this renders as wall
const WALL_H = 0.35            // extruded wall height, metres

interface MapMeta {
  w: number; h: number; res: number
  ox: number; oy: number
  stamp: number
  known: number; walls: number
  cells: Uint8Array
}

async function inflateMap(sample: TelemetrySample): Promise<MapMeta | null> {
  const d = sample.data as Record<string, unknown> | null
  if (!d || d['enc'] !== 'zlib-b64' || typeof d['data'] !== 'string') return null
  const bin = Uint8Array.from(atob(d['data'] as string), c => c.charCodeAt(0))
  const ds = new DecompressionStream('deflate')       // zlib-wrapped deflate
  const stream = new Blob([bin]).stream().pipeThrough(ds)
  const cells = new Uint8Array(await new Response(stream).arrayBuffer())
  let known = 0, walls = 0
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== 0xFF) known++
    if (cells[i] >= WALL_MIN && cells[i] <= 100) walls++
  }
  return {
    w: Number(d['w']), h: Number(d['h']), res: Number(d['res']),
    ox: Number(d['ox']), oy: Number(d['oy']),
    stamp: Number(d['stamp']), known, walls, cells,
  }
}

interface VoxelData {
  vs: number; ox: number; oy: number; oz: number
  coords: Int16Array          // flat [di,dj,dk, ...]
  cols: Uint8Array | null     // RGB332 per voxel (0 = unknown -> height tint)
  n: number; stamp: number
}

async function inflateVoxels(sample: TelemetrySample): Promise<VoxelData | null> {
  const d = sample.data as Record<string, unknown> | null
  const enc = d?.['enc']
  if (!d || (enc !== 'i16rgb332-zlib-b64' && enc !== 'i16-zlib-b64') || typeof d['data'] !== 'string') return null
  const bin = Uint8Array.from(atob(d['data'] as string), c => c.charCodeAt(0))
  const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('deflate'))
  const raw = new Uint8Array(await new Response(stream).arrayBuffer())
  const n = Number(d['n'])
  const coords = new Int16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + n * 6))
  const cols = enc === 'i16rgb332-zlib-b64'
    ? new Uint8Array(raw.buffer.slice(raw.byteOffset + n * 6, raw.byteOffset + n * 7))
    : null
  return {
    vs: Number(d['vs']), ox: Number(d['ox']), oy: Number(d['oy']), oz: Number(d['oz']),
    coords, cols, n, stamp: Number(d['stamp']),
  }
}

function rgb332Color(c: number): THREE.Color {
  return new THREE.Color(((c >> 5) & 7) / 7, ((c >> 2) & 7) / 7, (c & 3) / 3)
}

// height -> colour: explored-floor teal low, warm high (reads as real relief)
function heightColor(t: number): THREE.Color {
  // bright cyan floor -> warm amber peaks, so relief reads at a glance
  const lo = new THREE.Color(0x39d0e6), hi = new THREE.Color(0xffc04d)
  return lo.clone().lerp(hi, Math.max(0, Math.min(1, t)))
}

type Link = 'live' | 'stale' | 'none' | 'unreachable'
const linkOf = (s: TelemetrySample | undefined, staleS: number, err: boolean): Link =>
  err ? 'unreachable' : !s ? 'none' : (s.age_s ?? 0) > staleS ? 'stale' : 'live'

const CHIP: Record<Link, [string, string]> = {
  live:        ['dk-chip ok',      'LIVE'],
  stale:       ['dk-chip standby', 'STALE'],
  none:        ['dk-chip prov',    'NO FEED'],
  unreachable: ['dk-chip crit',    'GATEWAY UNREACHABLE'],
}

export function TerrainView() {
  const { pushEvent } = useDeck()
  const pushRef = useRef(pushEvent)
  useEffect(() => { pushRef.current = pushEvent }, [pushEvent])

  const [roverIdx, setRoverIdx] = useState(1)          // SIM is the mapper today
  const rover = ROVERS[roverIdx]
  const [mapS, setMapS] = useState<TelemetrySample | undefined>(undefined)
  const [odomS, setOdomS] = useState<TelemetrySample | undefined>(undefined)
  const [meta, setMeta] = useState<MapMeta | null>(null)
  const [voxN, setVoxN] = useState(0)
  const [voxS, setVoxS] = useState<TelemetrySample | undefined>(undefined)
  const [missionS, setMissionS] = useState<TelemetrySample | undefined>(undefined)
  const [terrainS, setTerrainS] = useState<TelemetrySample | undefined>(undefined)
  // ROVER POV is the honest default: the ground rover has no aerial vantage —
  // the orbit is the analyst's WORLD MODEL view of accumulated survey data
  // (a live aerial view arrives with the Spark aerial companion).
  const [camMode, setCamMode] = useState<'rover' | 'model'>('rover')
  const camModeRef = useRef<'rover' | 'model'>('rover')
  const camDirtyRef = useRef(false)
  useEffect(() => { camModeRef.current = camMode; camDirtyRef.current = true }, [camMode])
  const surveyLiveRef = useRef(false)
  const [error, setError] = useState(false)
  const [updates, setUpdates] = useState(0)

  const hostRef = useRef<HTMLDivElement | null>(null)
  const metaRef = useRef<MapMeta | null>(null)
  const odomRef = useRef<{ x: number; y: number; yaw: number } | null>(null)
  const builtStampRef = useRef(0)
  const knownRef = useRef(0)
  const voxelRef = useRef<VoxelData | null>(null)
  const voxStampRef = useRef(0)

  // ── data loop ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const latest = await telemetryLatest(rover.id)
        if (!alive) return
        setError(false)
        setMapS(latest.kinds['map'])
        setOdomS(latest.kinds['odom'])
        const od = latest.kinds['odom']?.data as Record<string, unknown> | undefined
        if (od && typeof od['x'] === 'number') {
          const qz = Number(od['qz'] ?? 0), qw = Number(od['qw'] ?? 1)
          odomRef.current = { x: Number(od['x']), y: Number(od['y']), yaw: 2 * Math.atan2(qz, qw) }
        }
        const m = latest.kinds['map']
        const stamp = Number((m?.data as Record<string, unknown> | undefined)?.['stamp'] ?? 0)
        if (m && stamp !== builtStampRef.current) {
          const inflated = await inflateMap(m)
          if (!alive || !inflated) return
          builtStampRef.current = stamp
          metaRef.current = inflated
          setMeta(inflated)
          setUpdates(u => u + 1)
          const pct = Math.round((100 * inflated.known) / (inflated.w * inflated.h))
          if (pct > knownRef.current) {
            pushRef.current('MAP', `world grew: ${pct}% known (${inflated.w}×${inflated.h} @ ${(inflated.res * 100).toFixed(0)} cm)`, 'ok')
            knownRef.current = pct
          }
        }
        const vx = latest.kinds['voxel']
        setVoxS(vx)
        setMissionS(latest.kinds['mission'])
        setTerrainS(latest.kinds['terrain'])
        const vstamp = Number((vx?.data as Record<string, unknown> | undefined)?.['stamp'] ?? 0)
        if (vx && vstamp !== voxStampRef.current) {
          const vd = await inflateVoxels(vx)
          if (alive && vd) {
            voxStampRef.current = vstamp
            voxelRef.current = vd
            setVoxN(vd.n)
          }
        }
      } catch {
        if (alive) setError(true)
      }
    }
    metaRef.current = null; setMeta(null); builtStampRef.current = 0; knownRef.current = 0
    odomRef.current = null; setUpdates(0)
    voxelRef.current = null; voxStampRef.current = 0; setVoxN(0)
    load()
    const iv = setInterval(load, POLL_MS)
    // the gateway broadcasts every verified telemetry event — ride it for
    // smooth 2 Hz odom instead of the 5 s poll cadence (poll = fallback)
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
    ws.onmessage = async ev => {
      try {
        const m = JSON.parse(ev.data)
        if (m.rover !== rover.id || !m.verified) return
        if (m.kind === 'odom' && m.data && typeof m.data.x === 'number') {
          const qz = Number(m.data.qz ?? 0), qw = Number(m.data.qw ?? 1)
          odomRef.current = { x: Number(m.data.x), y: Number(m.data.y), yaw: 2 * Math.atan2(qz, qw) }
        } else if (m.kind === 'map' && m.data) {
          const inflated = await inflateMap({ ts: 0, verified: true, data: m.data })
          if (alive && inflated && inflated.stamp !== builtStampRef.current) {
            builtStampRef.current = inflated.stamp
            metaRef.current = inflated
            setMeta(inflated)
            setUpdates(u => u + 1)
          }
        } else if (m.kind === 'voxel' && m.data) {
          const vd = await inflateVoxels({ ts: 0, verified: true, data: m.data })
          if (alive && vd && vd.stamp !== voxStampRef.current) {
            voxStampRef.current = vd.stamp
            voxelRef.current = vd
            setVoxN(vd.n)
          }
        }
      } catch { /* malformed frame: the poll loop still covers us */ }
    }
    return () => { alive = false; clearInterval(iv); ws.close() }
  }, [rover.id])

  // ── scene ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const W = host.clientWidth || 800, H = host.clientHeight || 520
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(W, H)
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.add(new THREE.AmbientLight(0xffffff, 1.15))
    const key = new THREE.DirectionalLight(0xffffff, 1.5)
    key.position.set(4, 8, 5)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0x8fd0ff, 0.5)
    rim.position.set(-5, 3, -4)
    scene.add(rim)
    const pivot = new THREE.Group()
    scene.add(pivot)
    const camera = new THREE.PerspectiveCamera(52, W / H, 0.01, 500)

    // rover marker: body dot + heading cone
    const rBody = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x3be896 }))
    const rNose = new THREE.Mesh(
      new THREE.ConeGeometry(0.09, 0.3, 8),
      new THREE.MeshBasicMaterial({ color: 0x3be896 }))
    rNose.rotation.z = -Math.PI / 2
    rNose.position.x = 0.26
    const roverGrp = new THREE.Group()
    const marker = new THREE.Group()
    marker.add(rBody); marker.add(rNose)
    marker.position.y = 0.12
    roverGrp.add(marker)
    // locator halo so the rover reads on the dark floor at any zoom
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.3, 24),
      new THREE.MeshBasicMaterial({ color: 0x3be896, transparent: true, opacity: 0.35, side: THREE.DoubleSide }))
    halo.rotation.x = -Math.PI / 2
    halo.position.y = 0.01
    roverGrp.add(halo)
    // the REAL body: decimated Mark 1 CAD (chassis + 6 wheels), wheel axles
    // at y=0 in the asset -> lift by wheel radius so it stands on the floor
    new GLTFLoader().load('/assets/mark1.glb', g => {
      g.scene.position.y = 0.0668
      g.scene.traverse(o => {
        const mesh = o as THREE.Mesh
        if (mesh.isMesh) mesh.material = new THREE.MeshBasicMaterial({
          color: (mesh.material as THREE.MeshStandardMaterial)?.color ?? 0xd9d4c6,
          wireframe: false, transparent: true, opacity: 0.95 })
      })
      roverGrp.add(g.scene)
      marker.visible = false
    }, undefined, () => { /* keep the marker if the asset fails */ })
    pivot.add(roverGrp)

    let wallsMesh: THREE.InstancedMesh | null = null
    let voxelMesh: THREE.InstancedMesh | null = null
    let floor: THREE.Mesh | null = null
    let grid: THREE.GridHelper | null = null
    let builtStamp = 0
    let voxBuilt = 0

    // the TRUE 3D reconstruction: one box per occupied voxel, coloured by
    // height. When present these replace the flat extruded walls (real relief
    // vs a floor-plan stood on edge).
    // outdoor worlds can run voxels-first (SLAM map empty/late): frame the
    // camera from the voxel bounds so the view never collapses to the origin
    const voxFrame = { ext: 0, cx: 0, cy: 0 }
    function rebuildVoxels(v: VoxelData) {
      if (voxelMesh) { pivot.remove(voxelMesh); voxelMesh.geometry.dispose() }
      const count = v.coords.length / 3
      const g = new THREE.BoxGeometry(v.vs, v.vs, v.vs)
      // NOTE: no vertexColors here — the box geometry has no per-vertex color
      // attribute, and vertexColors:true made the shader multiply every voxel
      // by an unbound (black) attribute: the whole 3D layer rendered invisible.
      // InstancedMesh.setColorAt() colours are applied automatically.
      const mat = new THREE.MeshLambertMaterial({ emissive: 0x0a1a24, emissiveIntensity: 0.4 })
      voxelMesh = new THREE.InstancedMesh(g, mat, count)
      const tmp = new THREE.Object3D()
      let zmax = 0.1
      let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity
      for (let k = 0; k < count; k++) {
        zmax = Math.max(zmax, v.oz + v.coords[k * 3 + 2] * v.vs)
        const wx = v.ox + v.coords[k * 3] * v.vs
        const wy = v.oy + v.coords[k * 3 + 1] * v.vs
        if (wx < xmin) xmin = wx; if (wx > xmax) xmax = wx
        if (wy < ymin) ymin = wy; if (wy > ymax) ymax = wy
      }
      if (count > 0) {
        voxFrame.ext = Math.max(xmax - xmin, ymax - ymin)
        voxFrame.cx = (xmin + xmax) / 2
        voxFrame.cy = (ymin + ymax) / 2
      }
      for (let k = 0; k < count; k++) {
        const wx = v.ox + v.coords[k * 3] * v.vs
        const wy = v.oy + v.coords[k * 3 + 1] * v.vs
        const wz = v.oz + v.coords[k * 3 + 2] * v.vs
        tmp.position.set(wx, wz + v.vs / 2, -wy)     // map(x,y,z-up) -> three(x,y-up,-z)
        tmp.updateMatrix()
        voxelMesh.setMatrixAt(k, tmp.matrix)
        const cb = v.cols ? v.cols[k] : 0
        voxelMesh.setColorAt(k, cb ? rgb332Color(cb) : heightColor(wz / zmax))
      }
      voxelMesh.instanceMatrix.needsUpdate = true
      if (voxelMesh.instanceColor) voxelMesh.instanceColor.needsUpdate = true
      pivot.add(voxelMesh)
      if (wallsMesh) wallsMesh.visible = false     // voxels supersede the flat walls
      const mm = metaRef.current
      if (!mm || mm.w * mm.h === 0) pivot.position.set(-voxFrame.cx, 0, voxFrame.cy)
    }

    function rebuild(m: MapMeta) {
      if (wallsMesh) { pivot.remove(wallsMesh); wallsMesh.geometry.dispose() }
      if (floor) { pivot.remove(floor); floor.geometry.dispose() }
      if (grid) { pivot.remove(grid) }
      const mw = m.w * m.res, mh = m.h * m.res
      // free-space floor, centred on the map extent
      floor = new THREE.Mesh(
        new THREE.PlaneGeometry(mw, mh),
        new THREE.MeshBasicMaterial({ color: 0x0e2634, transparent: true, opacity: 0.9 }))
      floor.rotation.x = -Math.PI / 2
      floor.position.set(m.ox + mw / 2, -0.01, -(m.oy + mh / 2))
      pivot.add(floor)
      grid = new THREE.GridHelper(Math.max(mw, mh), Math.max(m.w, m.h) / 8, 0x123244, 0x0d2230)
      grid.position.copy(floor.position)
      grid.position.y = 0.0
      pivot.add(grid)
      // walls: one instanced box per occupied cell
      const boxes: Array<[number, number]> = []
      for (let j = 0; j < m.h; j++) {
        for (let i = 0; i < m.w; i++) {
          const v = m.cells[j * m.w + i]
          if (v >= WALL_MIN && v <= 100) boxes.push([i, j])
        }
      }
      const g = new THREE.BoxGeometry(m.res, WALL_H, m.res)
      const mat = new THREE.MeshBasicMaterial({ color: 0x48e5f2, transparent: true, opacity: 0.55 })
      wallsMesh = new THREE.InstancedMesh(g, mat, boxes.length)
      const tmp = new THREE.Object3D()
      boxes.forEach(([i, j], k) => {
        tmp.position.set(m.ox + (i + 0.5) * m.res, WALL_H / 2, -(m.oy + (j + 0.5) * m.res))
        tmp.updateMatrix()
        wallsMesh!.setMatrixAt(k, tmp.matrix)
      })
      wallsMesh.instanceMatrix.needsUpdate = true
      pivot.add(wallsMesh)
      // aim the orbit at the map centre
      pivot.position.set(-floor.position.x, 0, -floor.position.z)
    }

    const clock = new THREE.Clock()
    const camTarget = new THREE.Vector3()
    let raf = 0
    const frame = () => {
      const t = clock.getElapsedTime()
      const m = metaRef.current
      if (m && m.stamp !== builtStamp) { rebuild(m); builtStamp = m.stamp }
      const v = voxelRef.current
      // gate: only paint the world during / after a survey mission
      if (v && v.stamp !== voxBuilt && surveyLiveRef.current) {
        rebuildVoxels(v); voxBuilt = v.stamp
      }
      const od = odomRef.current
      if (od) {
        roverGrp.position.x += (od.x - roverGrp.position.x) * 0.12
        roverGrp.position.z += (-od.y - roverGrp.position.z) * 0.12
        roverGrp.rotation.y = od.yaw
      }
      const mapExt = m && m.w * m.h > 0 ? Math.max(m.w, m.h) * m.res : 0
      const ext = Math.min(300, Math.max(8, mapExt, voxFrame.ext))
      if (camModeRef.current === 'rover') {
        // Chase-cam on the rover's own signed pose. Snap the rover proxy on
        // mode change so the camera does not linger on the (0,0) origin
        // during the 0.12-per-frame interpolation catch-up.
        if (camDirtyRef.current && odomRef.current) {
          roverGrp.position.set(odomRef.current.x, roverGrp.position.y, -odomRef.current.y)
          roverGrp.rotation.y = odomRef.current.yaw
          camDirtyRef.current = false
        }
        roverGrp.getWorldPosition(camTarget)
        const yaw = roverGrp.rotation.y
        // 4.5 m back, 2.2 m up, looking 3 m ahead: reads clearly at Mark 1 scale
        camera.position.set(
          camTarget.x - Math.cos(yaw) * 4.5,
          camTarget.y + 2.2,
          camTarget.z + Math.sin(yaw) * 4.5)
        camera.lookAt(camTarget.x + Math.cos(yaw) * 3.0, camTarget.y + 0.3,
                      camTarget.z - Math.sin(yaw) * 3.0)
      } else {
        const r = ext * 0.85
        camera.position.set(Math.sin(t * 0.07) * r, ext * 0.55, Math.cos(t * 0.07) * r)
        camera.lookAt(0, 0, 0)
      }
      renderer.render(scene, camera)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    const onResize = () => {
      const w = host.clientWidth, h = host.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      renderer.dispose()
      host.removeChild(renderer.domElement)
    }
  }, [])

  const mapLink = linkOf(mapS, MAP_STALE_S, error)
  const odomLink = linkOf(odomS, ODOM_STALE_S, error)
  // Mission-scoped world model per user directive 2026-07-19: the 3D
  // reconstruction is dispatched as a survey mission, not an ambient feed.
  // 'active' means a survey is running; 'complete' keeps the finished model
  // visible; anything else (or no mission) shows the honest empty state.
  const surveyState = missionS?.data && typeof missionS.data === 'object'
    ? String(((missionS.data as Record<string, unknown>)['state'] ?? '')).toLowerCase()
    : ''
  const surveyLive = surveyState === 'active' || surveyState === 'complete'
  useEffect(() => { surveyLiveRef.current = surveyLive }, [surveyLive])
  // the map only re-sends on CHANGE: an old map beside live odom means the
  // world stopped changing — that is completion, not staleness
  const mapChip: [string, string] =
    mapLink === 'stale' && odomLink === 'live' ? ['dk-chip ok', 'SETTLED'] : CHIP[mapLink]
  const chip = ([cls, label]: [string, string]) => <span className={cls}>{label}</span>
  const sig = mapS?.verified ? <span className="dk-chip ok">SIGNED</span> : null
  const knownPct = meta && meta.w * meta.h > 0
    ? Math.round((100 * meta.known) / (meta.w * meta.h)) : 0

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
      <ViewHead
        eyebrow="SPATIAL AWARENESS · 3D RECONSTRUCTION OVER THE RADIO"
        title="Terrain"
        sub={<>
          {ROVERS.map((r, i) => (
            <button key={r.id} onClick={() => setRoverIdx(i)}
              className={i === roverIdx ? 'dk-chip ok' : 'dk-chip prov'}
              style={{ cursor: 'pointer', marginRight: 6, background: 'transparent' }}>
              {r.label}
            </button>
          ))}
          {rover.sim
            ? <span className="dk-chip standby">GAZEBO SIM — real SLAM, virtual world</span>
            : <span className="dk-chip prov">FIELD — SLAM not deployed on hardware yet</span>}
          <span style={{ display: 'inline-block', width: 12 }} />
          <button onClick={() => setCamMode('rover')}
            className={camMode === 'rover' ? 'dk-chip ok' : 'dk-chip prov'}
            style={{ cursor: 'pointer', marginRight: 6, background: 'transparent' }}>
            ROVER POV
          </button>
          <button onClick={() => setCamMode('model')}
            className={camMode === 'model' ? 'dk-chip ok' : 'dk-chip prov'}
            style={{ cursor: 'pointer', background: 'transparent' }}>
            WORLD MODEL · accumulated
          </button>
        </>}
      />
      <div style={{ position: 'absolute', top: 16, right: 20, width: 250, zIndex: 5 }}>
        <Panel title="World model" meta={<>{chip(mapChip)} {sig}</>}>
          {meta ? (
            <div style={{ fontSize: 12, lineHeight: 1.55, display: 'grid', gap: 6 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '78px 1fr', rowGap: 4, columnGap: 8 }}>
                <span style={{ opacity: 0.55 }}>map</span>
                <b>{(meta.w * meta.res).toFixed(1)} × {(meta.h * meta.res).toFixed(1)} m &middot; {(meta.res * 100).toFixed(0)} cm</b>
                <span style={{ opacity: 0.55 }}>known</span>
                <b>{knownPct}%</b>
                <span style={{ opacity: 0.55 }}>age</span>
                <b>{mapS?.age_s != null ? `${Math.round(mapS.age_s)} s` : '—'} &middot; {updates} update{updates === 1 ? '' : 's'}</b>
                <span style={{ opacity: 0.55 }}>voxels</span>
                <b>{voxN.toLocaleString()}</b>
                <span style={{ opacity: 0.55 }}>odom</span>
                <span>{chip(CHIP[odomLink])}</span>
              </div>
              {missionS?.data ? (() => {
                const md = missionS.data as Record<string, unknown>
                const state = String(md['state'] ?? '?')
                const wi = md['waypoint_i']; const wn = md['waypoint_n']
                const cov = md['coverage_pct']
                const cls = state === 'active' ? 'dk-chip ok' : state === 'complete' ? 'dk-chip ok' : state === 'failed' || state === 'aborted' ? 'dk-chip crit' : 'dk-chip prov'
                return (
                  <div style={{ borderTop: '1px dotted rgba(90,115,150,0.25)', paddingTop: 6, display: 'grid', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ opacity: 0.55 }}>survey</span>
                      <span className={cls}>{state.toUpperCase()}</span>
                    </div>
                    {wi != null && wn != null ? (
                      <div style={{ display: 'grid', gridTemplateColumns: '78px 1fr', columnGap: 8 }}>
                        <span style={{ opacity: 0.55 }}>waypoint</span><b>{String(wi)} / {String(wn)}</b>
                        <span style={{ opacity: 0.55 }}>coverage</span><b>{cov != null ? `${cov}%` : '—'}</b>
                      </div>
                    ) : null}
                  </div>
                )
              })() : null}
            </div>
          ) : (
            <div style={{ fontSize: 12, opacity: 0.65, lineHeight: 1.6 }}>
              {mapLink === 'unreachable' ? 'telemetry gateway unreachable'
                : rover.sim ? 'no map telemetry yet — sim starting or SLAM warming up'
                : 'no map telemetry — SLAM does not run on the field rover yet'}
            </div>
          )}
          {!surveyLive && meta ? (
            <div style={{ marginTop: 10, padding: '8px 10px', border: '1px dashed rgba(255,180,84,0.4)', borderRadius: 6, fontSize: 11.5, lineHeight: 1.45, color: 'rgba(255,180,84,0.9)' }}>
              <b style={{ letterSpacing: '.08em', fontSize: 10 }}>NO ACTIVE SURVEY</b>
              <div style={{ marginTop: 3, color: 'rgba(210,225,240,0.75)' }}>
                The 3D world model is captured during a SURVEY mission. Dispatch one from the Missions view to have the rover explore and reconstruct a zone.
              </div>
            </div>
          ) : null}
        </Panel>
        {terrainS?.data ? (() => {
          const td = terrainS.data as Record<string, unknown>
          const flat = Number(td['flat'] ?? 0)
          const gentle = Number(td['gentle'] ?? 0)
          const steep = Number(td['steep'] ?? 0)
          const rough = Number(td['rough'] ?? 0)
          const lethal = Number(td['lethal_step'] ?? 0) + Number(td['lethal_slope'] ?? 0) + Number(td['lethal_cliff'] ?? 0)
          const seen = Number(td['cells_seen'] ?? 0)
          const bar = (n: number, color: string) => {
            const pct = seen > 0 ? (n / seen) * 100 : 0
            return <div style={{ display: 'inline-block', width: `${pct}%`, height: 6, background: color, borderRadius: 2 }} />
          }
          return (
            <div style={{ marginTop: 10 }}>
              <Panel title="Terrain intelligence" meta={<span className="dk-chip ok">READING</span>}>
                <div style={{ fontSize: 11.5, lineHeight: 1.45, display: 'grid', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 8, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                    {bar(flat, '#15803d')}{bar(gentle, '#84cc16')}{bar(rough, '#eab308')}{bar(steep, '#f97316')}{bar(lethal, '#dc2626')}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 8, marginTop: 4 }}>
                    <span style={{ color: '#4ade80' }}>flat <b>{flat}</b></span>
                    <span style={{ color: '#a3e635' }}>gentle <b>{gentle}</b></span>
                    <span style={{ color: '#facc15' }}>rough <b>{rough}</b></span>
                    <span style={{ color: '#fb923c' }}>steep <b>{steep}</b></span>
                    <span style={{ color: '#f87171' }}>lethal <b>{lethal}</b></span>
                    <span style={{ opacity: 0.6 }}>seen <b>{seen}</b></span>
                  </div>
                  <div style={{ opacity: 0.55, fontSize: 10.5, marginTop: 2 }}>
                    Nav2 routes around lethal cells, prefers flat
                  </div>
                </div>
              </Panel>
            </div>
          )
        })() : null}
      </div>
      <div style={{ position: 'absolute', bottom: 14, left: 20, zIndex: 5 }}>
        <Legend items={[['#3be896', 'rover · signed odom'], ['#48b6e5', 'reconstructed surface'], ['#f0a545', 'above rover · obstacle'], ['#000000', 'unmapped']]} />
      </div>
    </div>
  )
}
