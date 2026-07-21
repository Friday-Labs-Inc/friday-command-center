// Terrain traversability ribbon — the operator's "sense of mission terrain".
//
// The rover accumulates a persistent map-frame terrain grid and radios it as the
// signed tlm/terrain_grid (zlib-b64 over int8 cost cells, same wire shape as tlm/map).
// This module decodes it and paints a top-down drive/caution/block ribbon: where the
// ground is safe, where to slow down, and where NOT to drive — built up along the path.
//
// Cost cells mirror friday_terrain: 0 free · 40 gentle · 60 rough · 70 steep · 100 lethal
// · 0xFF (255) unsensed. We fold those into four operator-legible classes.

export type Trav = 'drive' | 'caution' | 'block' | 'unknown'

export interface RibbonMeta {
  w: number; h: number; res: number
  ox: number; oy: number
  cells: Uint8Array
}

export function classifyCost(cost: number): Trav {
  if (cost === 0xff) return 'unknown'     // -1, never sensed
  if (cost >= 100) return 'block'         // lethal / non-traversable
  if (cost >= 60) return 'caution'        // rough or steep — slow down
  return 'drive'                          // free (0) or gentle (40)
}

// Palette tuned to read in both deck themes; alpha 0 hides unsensed cells.
export const TRAV_COLOR: Record<Trav, [number, number, number, number]> = {
  drive:   [46, 160, 67, 235],    // green
  caution: [210, 153, 34, 235],   // amber
  block:   [248, 81, 73, 245],    // red
  unknown: [0, 0, 0, 0],          // transparent
}

export interface RibbonStats {
  drive: number; caution: number; block: number
  sensed: number; total: number
  sensedPct: number; areaM2: number
}

export function ribbonStats(m: RibbonMeta): RibbonStats {
  let drive = 0, caution = 0, block = 0, sensed = 0
  for (let i = 0; i < m.cells.length; i++) {
    const t = classifyCost(m.cells[i])
    if (t === 'unknown') continue
    sensed++
    if (t === 'drive') drive++
    else if (t === 'caution') caution++
    else block++
  }
  const total = m.w * m.h
  return {
    drive, caution, block, sensed, total,
    sensedPct: total ? (100 * sensed) / total : 0,
    areaM2: sensed * m.res * m.res,
  }
}

// Tight bounding box of sensed cells (so the ribbon fills the panel, not a sea of void).
export function sensedBBox(m: RibbonMeta): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = m.w, y0 = m.h, x1 = -1, y1 = -1
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      if (m.cells[y * m.w + x] !== 0xff) {
        if (x < x0) x0 = x; if (x > x1) x1 = x
        if (y < y0) y0 = y; if (y > y1) y1 = y
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 }
}

/** Paint the ribbon into `canvas`, cropped to the sensed bbox and scaled to fit.
 *  `rover` is optional {x,y} in map metres; drawn as a marker. Returns the bbox drawn. */
export function drawTerrainRibbon(
  canvas: HTMLCanvasElement, m: RibbonMeta, rover?: { x: number; y: number } | null,
): { x0: number; y0: number; x1: number; y1: number } | null {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const bb = sensedBBox(m)
  if (!bb) return null
  const gw = bb.x1 - bb.x0 + 1, gh = bb.y1 - bb.y0 + 1
  // paint the cropped grid into an offscreen ImageData, then blit scaled (nearest)
  const img = ctx.createImageData(gw, gh)
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const c = m.cells[(bb.y0 + y) * m.w + (bb.x0 + x)]
      const [r, g, b, a] = TRAV_COLOR[classifyCost(c)]
      const o = (y * gw + x) * 4
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = a
    }
  }
  const off = document.createElement('canvas')
  off.width = gw; off.height = gh
  off.getContext('2d')!.putImageData(img, 0, 0)
  const scale = Math.min(canvas.width / gw, canvas.height / gh)
  const dw = gw * scale, dh = gh * scale
  const dx = (canvas.width - dw) / 2, dy = (canvas.height - dh) / 2
  ctx.imageSmoothingEnabled = false
  // map y grows up; canvas y grows down — flip vertically so north is up
  ctx.save(); ctx.translate(dx, dy + dh); ctx.scale(1, -1)
  ctx.drawImage(off, 0, 0, dw, dh)
  ctx.restore()
  // rover marker
  if (rover) {
    const cx = (rover.x - m.ox) / m.res - bb.x0
    const cy = (rover.y - m.oy) / m.res - bb.y0
    if (cx >= 0 && cx <= gw && cy >= 0 && cy <= gh) {
      const px = dx + cx * scale, py = dy + dh - cy * scale
      ctx.fillStyle = '#e6edf3'; ctx.strokeStyle = '#0d1117'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    }
  }
  return bb
}

/** Decode a signed tlm/terrain_grid sample (zlib-b64) into a RibbonMeta. */
export async function inflateRibbon(sample: { data: unknown }): Promise<RibbonMeta | null> {
  const d = sample.data as Record<string, unknown> | null
  if (!d || d['enc'] !== 'zlib-b64' || typeof d['data'] !== 'string') return null
  const bin = Uint8Array.from(atob(d['data'] as string), c => c.charCodeAt(0))
  const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('deflate'))
  const cells = new Uint8Array(await new Response(stream).arrayBuffer())
  return {
    w: Number(d['w']), h: Number(d['h']), res: Number(d['res']),
    ox: Number(d['ox']), oy: Number(d['oy']), cells,
  }
}
