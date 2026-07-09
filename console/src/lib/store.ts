// Live WebSocket store — moved from gateway.ts.
// Framework-agnostic: module-level snapshot, immutable on every mutation,
// useSyncExternalStore-compatible (getSnapshot always returns the SAME object
// reference unless something actually changed).
//
// REST calls are NOT in here — they live in lib/api.ts.
// Call initStore() once from AppShell on mount.

import { useSyncExternalStore } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

export interface LiveRoverState {
  rover: string
  x: number
  y: number
  theta: number
  updated: string | null
}

export interface LiveFeedEvent {
  ts: string
  kind: string
  rover: string
  topic?: string
  data?: unknown
}

export interface LiveState {
  connected: boolean
  rover: LiveRoverState
  feed: LiveFeedEvent[]       // capped at 100
  liveAlerts: LiveFeedEvent[] // fault events only, capped at 50
}

// ── Snapshot ─────────────────────────────────────────────────────────────────

let snapshot: LiveState = {
  connected: false,
  rover: { rover: '—', x: 0, y: 0, theta: 0, updated: null },
  feed: [],
  liveAlerts: [],
}

const listeners = new Set<() => void>()

function emit(next: LiveState): void {
  snapshot = next
  listeners.forEach(l => l())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function getSnapshot(): LiveState {
  return snapshot
}

export function useLiveStore(): LiveState {
  return useSyncExternalStore(subscribe, getSnapshot)
}

// ── WS handler ───────────────────────────────────────────────────────────────

function handle(ev: Record<string, unknown>): void {
  const item: LiveFeedEvent = {
    ts: new Date().toLocaleTimeString(),
    kind: ev.kind as string,
    rover: ev.rover as string,
    topic: ev.topic as string | undefined,
    data: ev.data,
  }

  let newFeed = [item, ...snapshot.feed]
  if (newFeed.length > 100) newFeed = newFeed.slice(0, 100)

  let newLiveAlerts = snapshot.liveAlerts
  let newRover = snapshot.rover

  if (ev.kind === 'odom' && ev.data) {
    const d = ev.data as { x: number; y: number; theta: number }
    newRover = {
      rover: ev.rover as string,
      x: +d.x,
      y: +d.y,
      theta: +d.theta,
      updated: item.ts,
    }
  }

  if (ev.kind === 'fault') {
    newLiveAlerts = [item, ...snapshot.liveAlerts]
    if (newLiveAlerts.length > 50) newLiveAlerts = newLiveAlerts.slice(0, 50)
  }

  emit({ ...snapshot, feed: newFeed, liveAlerts: newLiveAlerts, rover: newRover })
}

// ── Connection ────────────────────────────────────────────────────────────────

function connect(): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${location.host}/ws`)
  ws.onopen = () => { emit({ ...snapshot, connected: true }) }
  ws.onclose = () => {
    emit({ ...snapshot, connected: false })
    setTimeout(connect, 1500)
  }
  ws.onmessage = (e) => {
    try { handle(JSON.parse(e.data as string)) } catch { /* ignore malformed */ }
  }
}

let _initialized = false

/** Call once from AppShell on mount. Idempotent. */
export function initStore(): void {
  if (_initialized) return
  _initialized = true
  connect()
}
