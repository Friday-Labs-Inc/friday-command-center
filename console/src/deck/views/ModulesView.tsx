// ModulesView — module registry as a grid of instrument cards.
// DOM + per-card animated canvas sparklines; no three.js.

import { useEffect, useRef, useMemo } from 'react'
import { useDeck, fleetSeats } from '../data'
import type { Seat } from '../data'
import { Panel } from '../bits'

// ── semantic maps ─────────────────────────────────────────────────────────────

const S_COLOR: Record<Seat['state'], string> = {
  live:        '#3be896',
  degraded:    '#ffb454',
  dead:        '#ff4d6a',
  provisioned: '#5a7396',
}

const S_FRAC: Record<Seat['state'], number> = {
  live: 0.96, degraded: 0.55, dead: 0.40, provisioned: 0.18,
}

const S_CHIP: Record<Seat['state'], string> = {
  live:        'dk-chip ok',
  degraded:    'dk-chip standby',
  dead:        'dk-chip crit',
  provisioned: 'dk-chip prov',
}

const S_LABEL: Record<Seat['state'], string> = {
  live: 'LIVE', degraded: 'DEGRADED', dead: 'DEAD', provisioned: 'PROVISIONED',
}

// ── liveness ring ─────────────────────────────────────────────────────────────

function LivenessRing({ state }: { state: Seat['state'] }) {
  const r = 24, cx = 32, cy = 32
  const circ  = 2 * Math.PI * r
  const frac  = S_FRAC[state]
  const color = S_COLOR[state]
  const isLive = state === 'live'
  const main   = isLive ? '5.0' : state === 'provisioned' ? 'RDY' : '—'

  return (
    <svg width={64} height={64} viewBox="0 0 64 64" style={{ flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#16283e" strokeWidth={4} />
      <circle
        cx={cx} cy={cy} r={r} fill="none"
        stroke={color} strokeWidth={4}
        strokeDasharray={`${frac * circ} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <text
        x={cx} y={isLive ? cy - 5 : cy}
        textAnchor="middle" dominantBaseline="middle"
        fill={color} fontSize={isLive ? 13 : 11}
        fontFamily="var(--mono)"
      >
        {main}
      </text>
      {isLive && (
        <text
          x={cx} y={cy + 9}
          textAnchor="middle" dominantBaseline="middle"
          fill={color} fontSize={8}
          fontFamily="var(--mono)" opacity={0.65}
        >
          Hz
        </text>
      )}
    </svg>
  )
}

// ── sparkline painter ─────────────────────────────────────────────────────────

function paintSparkline(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  data: number[],
  state: Seat['state'],
): void {
  ctx.clearRect(0, 0, w, h)
  if (data.length < 2) return

  const color = S_COLOR[state]
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * w,
    y: h - v * h * 0.76 - h * 0.06,
  }))

  // area fill — live only
  if (state === 'live') {
    ctx.fillStyle = color + '28'
    ctx.beginPath()
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    ctx.lineTo(w, h)
    ctx.lineTo(0, h)
    ctx.closePath()
    ctx.fill()
  }

  // trace
  ctx.strokeStyle = state === 'live' ? color : '#2a3d56'
  ctx.lineWidth   = 1.2
  ctx.beginPath()
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.stroke()

  // live endpoint dot
  if (state === 'live') {
    const last = pts[pts.length - 1]
    ctx.fillStyle = color
    ctx.shadowColor = color
    ctx.shadowBlur  = 5
    ctx.beginPath()
    ctx.arc(last.x - 1, last.y, 2.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
  }
}

// ── main view ─────────────────────────────────────────────────────────────────

export function ModulesView() {
  const { modules, error } = useDeck()

  const seats = useMemo(() => fleetSeats(modules), [modules])

  const liveCount = useMemo(
    () => seats.filter(s => s.state === 'live').length,
    [seats],
  )

  // Mirrors seats into a ref so the rAF loop never holds a stale closure
  const seatsRef   = useRef<Seat[]>([])
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const sparkData  = useRef<Map<string, number[]>>(new Map())

  useEffect(() => { seatsRef.current = seats }, [seats])

  // Seed synthetic history for each seat the first time it appears
  useEffect(() => {
    for (const seat of seats) {
      if (sparkData.current.has(seat.module_id)) continue
      const isLive = seat.state === 'live'
      sparkData.current.set(
        seat.module_id,
        Array.from({ length: 40 }, (_, idx) =>
          isLive
            ? 0.50 + Math.sin(idx * 0.28 + Math.random()) * 0.14 + Math.random() * 0.08
            : 0.18 + Math.random() * 0.05,
        ),
      )
    }
  }, [seats])

  // Single rAF loop drives every sparkline canvas
  useEffect(() => {
    let raf = 0
    let last = 0

    function tick(t: number): void {
      raf = requestAnimationFrame(tick)

      // Throttle to ~6 fps; always run the first frame (last === 0)
      if (last > 0 && t - last < 160) return
      last = t

      seatsRef.current.forEach((seat, i) => {
        const canvas = canvasRefs.current[i]
        if (!canvas) return

        // Size buffer to physical pixels
        const dpr  = Math.min(devicePixelRatio || 1, 2)
        const rect = canvas.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return
        const cw = Math.round(rect.width  * dpr)
        const ch = Math.round(rect.height * dpr)
        if (canvas.width !== cw || canvas.height !== ch) {
          canvas.width  = cw
          canvas.height = ch
        }

        const ctx = canvas.getContext('2d')
        if (!ctx) return

        // Evolve live traces
        const data = sparkData.current.get(seat.module_id) ?? []
        if (seat.state === 'live') {
          const next = 0.5 + Math.sin(t / 820 + i) * 0.19 + (Math.random() - 0.5) * 0.11
          data.push(Math.max(0.05, Math.min(0.95, next)))
          if (data.length > 40) data.shift()
          sparkData.current.set(seat.module_id, data)
        }

        paintSparkline(ctx, cw, ch, data, seat.state)
      })
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, []) // stable — reads live data only through refs

  return (
    <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: '22px 24px' }}>

      {/* Scrolling header — in normal flow so it scrolls with cards */}
      <div style={{ marginBottom: 20 }}>
        <div style={{
          fontFamily: 'var(--mono)', fontSize: 8.5,
          letterSpacing: '.3em', color: 'var(--cyan)',
          textTransform: 'uppercase',
        }}>
          MODULE REGISTRY · CORE HUB
        </div>
        <h1 style={{
          fontWeight: 200, fontSize: 22, color: 'var(--white)',
          letterSpacing: '.28em', textTransform: 'uppercase',
          margin: '4px 0 0', padding: 0,
        }}>
          FLEET ORGANS
        </h1>
        <div style={{
          fontFamily: 'var(--mono)', fontSize: 9.5,
          color: 'var(--dim)', marginTop: 5,
        }}>
          {liveCount} live · liveness from 5 Hz heartbeat · registry epoch live
        </div>
      </div>

      {/* Registry unreachable notice */}
      {error != null && (
        <div style={{
          fontFamily: 'var(--mono)', fontSize: 9,
          color: 'var(--dim)', marginBottom: 12,
          letterSpacing: '0.06em',
        }}>
          registry unreachable — showing last-known fleet
        </div>
      )}

      {/* Module grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(238px, 1fr))',
        gap: 14,
      }}>
        {seats.map((seat, i) => {
          const namespace = seat.live?.namespace ?? `/mark1/${seat.hw}`
          const protocol  = seat.live?.protocol  ?? '0.1.0'
          const firmware  = seat.live?.fw_version
            ?? (seat.state === 'provisioned' ? 'queued' : 'staged')

          return (
            <Panel
              key={seat.module_id}
              title={seat.hw}
              meta={<span className={S_CHIP[seat.state]}>{S_LABEL[seat.state]}</span>}
            >
              {/* Body: liveness ring + key-value rows */}
              <div style={{ display: 'flex', gap: 12, padding: '14px 14px 10px' }}>
                <LivenessRing state={seat.state} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="dk-kv">
                    <span className="k">module</span>
                    <span className="v">{seat.short}</span>
                  </div>
                  <div className="dk-kv">
                    <span className="k">silicon</span>
                    <span className="v">{seat.chip}</span>
                  </div>
                  <div className="dk-kv">
                    <span className="k">caps</span>
                    <span className="v">{seat.caps}</span>
                  </div>
                  <div className="dk-kv">
                    <span className="k">firmware</span>
                    <span className="v">{firmware}</span>
                  </div>
                </div>
              </div>

              {/* Sparkline — full card width, no horizontal padding */}
              <canvas
                ref={el => { canvasRefs.current[i] = el }}
                style={{ display: 'block', width: '100%', height: '26px' }}
              />

              {/* Footer: namespace | protocol */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '6px 10px',
                borderTop: '1px solid #16283e',
                fontFamily: 'var(--mono)', fontSize: 8.5, color: 'var(--dim)',
              }}>
                <span>{namespace}</span>
                <span>proto {protocol}</span>
              </div>
            </Panel>
          )
        })}
      </div>
    </div>
  )
}
