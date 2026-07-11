// Command Deck data layer — one registry poller shared by every deck view via
// context. REAL data: the module registry (Core Hub → os-control agent →
// gateway). Anything not yet backed by rover hardware is labelled SIM by the
// component that renders it (honest-UI rule).

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { modulesRegistry, type RegistryModule } from '../lib/api'

export type { RegistryModule }

export interface DeckEvent {
  ts: string
  src: string
  msg: string
  kind: '' | 'ok' | 'warn' | 'ai'
}

export interface DeckData {
  modules: RegistryModule[] | null // null until first poll answers
  error: string | null
  latencyMs: number | null
  events: DeckEvent[]
  pushEvent: (src: string, msg: string, kind?: DeckEvent['kind']) => void
}

export const DeckContext = createContext<DeckData>({
  modules: null,
  error: null,
  latencyMs: null,
  events: [],
  pushEvent: () => {},
})

export const useDeck = () => useContext(DeckContext)

export const POLL_MS = 5000

/** Known fleet hardware, keyed by module_id — enriches live registry rows and
 *  lets the deck show provisioned-but-offline boards honestly. */
export interface FleetSeat {
  module_id: string
  short: string
  chip: string
  hw: string
  caps: string
}
export const FLEET_SEATS: FleetSeat[] = [
  { module_id: 'MARK1-MOB-DRIVE-001', short: 'DRIVE-001',    chip: 'ESP32-S3', hw: 'locomotion', caps: 'drive · safe-stop' },
  { module_id: 'MARK1-MOB-STEER-001', short: 'STEER-001',    chip: 'WROOM-32', hw: 'locomotion', caps: 'steer · safe-stop' },
  { module_id: 'MARK1-SPARKBAY-001',  short: 'SPARKBAY-001', chip: 'ESP32-S3', hw: 'aerial_bay', caps: 'launch · cradle' },
  { module_id: 'MARK1-SENSOR-001',    short: 'SENSOR-001',   chip: 'WROOM-32', hw: 'sensor',     caps: 'env · mmWave' },
  { module_id: 'MARK1-SPARE-001',     short: 'SPARE-001',    chip: 'WROOM-32', hw: 'spare',      caps: 'hot spare' },
]

export type SeatState = 'live' | 'degraded' | 'dead' | 'provisioned'

export interface Seat extends FleetSeat {
  state: SeatState
  live: RegistryModule | null
}

/** Merge the live registry into the known fleet: registered modules carry
 *  their real liveness; known-but-unregistered boards show as provisioned. */
export function fleetSeats(modules: RegistryModule[] | null): Seat[] {
  const byId = new Map((modules ?? []).map((m) => [m.module_id, m]))
  const seats: Seat[] = FLEET_SEATS.map((s) => {
    const live = byId.get(s.module_id) ?? null
    byId.delete(s.module_id)
    const state: SeatState = !live
      ? 'provisioned'
      : live.liveness === 'OK'
        ? 'live'
        : live.liveness === 'DEGRADED'
          ? 'degraded'
          : 'dead'
    return { ...s, state, live }
  })
  // unknown registrants (e.g. future modules) appear too — never hide real data
  byId.forEach((m) =>
    seats.push({
      module_id: m.module_id,
      short: m.module_id.replace('MARK1-', ''),
      chip: '—',
      hw: m.hardware_type,
      caps: m.capabilities.join(' · '),
      state: m.liveness === 'OK' ? 'live' : m.liveness === 'DEGRADED' ? 'degraded' : 'dead',
      live: m,
    }),
  )
  return seats
}

export const stateDot: Record<SeatState, string> = {
  live: 'ok',
  degraded: 'warn',
  dead: 'crit',
  provisioned: 'off',
}

const nowTs = () => {
  const d = new Date()
  return d.toTimeString().slice(0, 8)
}

/** The deck's single data heart: polls the registry, measures gateway latency,
 *  and turns real state CHANGES into stream events. */
export function useDeckDataSource(): DeckData {
  const [modules, setModules] = useState<RegistryModule[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [latencyMs, setLatency] = useState<number | null>(null)
  const [events, setEvents] = useState<DeckEvent[]>([])
  const prev = useRef<Map<string, string>>(new Map())

  const pushEvent = (src: string, msg: string, kind: DeckEvent['kind'] = '') =>
    setEvents((e) => [{ ts: nowTs(), src, msg, kind }, ...e].slice(0, 10))

  useEffect(() => {
    let alive = true
    const load = async () => {
      const t0 = performance.now()
      try {
        const snap = await modulesRegistry()
        if (!alive) return
        setLatency(Math.round(performance.now() - t0))
        setModules(snap.modules)
        setError(null)
        // diff → real events
        const seen = new Map(snap.modules.map((m) => [m.module_id, m.liveness]))
        seen.forEach((lv, id) => {
          const was = prev.current.get(id)
          if (was === undefined) {
            pushEvent('registry', `registered ${id} → liveness ${lv}`, lv === 'OK' ? 'ok' : 'warn')
          } else if (was !== lv) {
            pushEvent('core_hub', `${id} liveness ${was} → ${lv}`, lv === 'OK' ? 'ok' : 'warn')
          }
        })
        prev.current.forEach((_, id) => {
          if (!seen.has(id)) pushEvent('registry', `${id} left the registry`, 'warn')
        })
        prev.current = seen
      } catch (e) {
        if (!alive) return
        setError((e as Error).message)
      }
    }
    load()
    const t = setInterval(load, POLL_MS)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  return { modules, error, latencyMs, events, pushEvent }
}
