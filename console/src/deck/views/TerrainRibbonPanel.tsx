// Operator's "terrain sensed along the mission" panel — a top-down drive/caution/block
// ribbon built from the signed tlm/terrain_grid. Self-contained: polls the gateway,
// inflates the grid, paints the canvas. Sits beside the 3D world model in TerrainView.
import { useEffect, useRef, useState } from 'react'
import { Panel } from '../bits'
import { telemetryLatest } from '../../lib/api'
import { inflateRibbon, ribbonStats, drawTerrainRibbon } from '../terrainRibbon'
import type { RibbonMeta } from '../terrainRibbon'

const POLL_MS = 3000
const pct = (n: number, d: number) => (d > 0 ? `${Math.round((100 * n) / d)}%` : '0%')

export function TerrainRibbonPanel({ roverId }: { roverId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [meta, setMeta] = useState<RibbonMeta | null>(null)
  const [signed, setSigned] = useState(false)
  const stampRef = useRef(0)
  const roverRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    let alive = true
    stampRef.current = 0
    setMeta(null)
    const load = async () => {
      try {
        const latest = await telemetryLatest(roverId)
        if (!alive) return
        const od = latest.kinds['odom']?.data as Record<string, unknown> | undefined
        if (od && typeof od['x'] === 'number') roverRef.current = { x: Number(od['x']), y: Number(od['y']) }
        const s = latest.kinds['terrain_grid']
        if (!s) return
        const stamp = Number((s.data as Record<string, unknown> | undefined)?.['stamp'] ?? 0)
        if (stamp === stampRef.current) return
        const inflated = await inflateRibbon(s)
        if (!alive || !inflated) return
        stampRef.current = stamp
        setMeta(inflated)
        setSigned(!!s.verified)
      } catch { /* keep last good frame */ }
    }
    load()
    const iv = setInterval(load, POLL_MS)
    return () => { alive = false; clearInterval(iv) }
  }, [roverId])

  useEffect(() => {
    if (meta && canvasRef.current) drawTerrainRibbon(canvasRef.current, meta, roverRef.current)
  }, [meta])

  const st = meta ? ribbonStats(meta) : null
  return (
    <div style={{ marginTop: 10 }}>
      <Panel title="Terrain sensed" meta={signed ? <span className="dk-chip ok">SIGNED</span> : <span className="dk-chip prov">—</span>}>
        {meta && st ? (
          <div style={{ display: 'grid', gap: 6 }}>
            <canvas ref={canvasRef} width={226} height={150}
              style={{ width: '100%', borderRadius: 4, background: 'rgba(10,20,32,0.6)', imageRendering: 'pixelated' }} />
            <div style={{ display: 'flex', gap: 8, fontSize: 11 }}>
              <span style={{ color: '#2ea043' }}>■ drive {pct(st.drive, st.sensed)}</span>
              <span style={{ color: '#d29922' }}>■ caution {pct(st.caution, st.sensed)}</span>
              <span style={{ color: '#f85149' }}>■ block {pct(st.block, st.sensed)}</span>
            </div>
            <div style={{ opacity: 0.55, fontSize: 10.5 }}>
              {st.areaM2.toFixed(0)} m² sensed along the mission · {st.sensedPct.toFixed(1)}% of view
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 11.5, opacity: 0.6, lineHeight: 1.5 }}>
            no terrain ribbon yet — drive the rover so the classifier reads the ground
          </div>
        )}
      </Panel>
    </div>
  )
}
