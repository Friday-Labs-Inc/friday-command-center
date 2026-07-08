// Reactive store + client for the gateway: a live WebSocket event stream plus the
// REST endpoints the panels read/write. The operator's private key never passes
// through here — only signed envelopes do (see signer.ts + CommandConsole.tsx).
//
// State is module-level and immutable-snapshot-per-mutation so it works with
// React's useSyncExternalStore without any framework-specific reactivity.

import { useSyncExternalStore } from 'react'

export interface RoverState {
  rover: string
  x: number
  y: number
  theta: number
  updated: string | null
}

export interface FeedEvent {
  ts: string
  kind: string
  rover: string
  topic?: string
  data?: any
}

export interface SecurityEvent {
  name: string
  rover: string
  operator?: string
  category: string
  severity: string
  description?: string
  event_time?: string
  acknowledged?: number
}

export interface GatewayState {
  connected: boolean
  rover: RoverState
  feed: FeedEvent[]
  liveAlerts: FeedEvent[]
  securityEvents: SecurityEvent[]
}

// The single source of truth: always an immutable object, replaced on every mutation.
let snapshot: GatewayState = {
  connected: false,
  rover: { rover: '—', x: 0, y: 0, theta: 0, updated: null },
  feed: [],
  liveAlerts: [],
  securityEvents: [],
}

const listeners = new Set<() => void>()

function emit(next: GatewayState): void {
  snapshot = next
  listeners.forEach(l => l())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function getSnapshot(): GatewayState {
  return snapshot
}

export function useGateway(): GatewayState {
  return useSyncExternalStore(subscribe, getSnapshot)
}

function handle(ev: any): void {
  const item: FeedEvent = {
    ts: new Date().toLocaleTimeString(),
    kind: ev.kind,
    rover: ev.rover,
    topic: ev.topic,
    data: ev.data,
  }

  let newFeed = [item, ...snapshot.feed]
  if (newFeed.length > 100) newFeed = newFeed.slice(0, 100)

  let newLiveAlerts = snapshot.liveAlerts
  let newRover = snapshot.rover

  if (ev.kind === 'odom' && ev.data) {
    newRover = {
      rover: ev.rover,
      x: +ev.data.x,
      y: +ev.data.y,
      theta: +ev.data.theta,
      updated: item.ts,
    }
  }
  if (ev.kind === 'fault') {
    newLiveAlerts = [item, ...snapshot.liveAlerts]
    if (newLiveAlerts.length > 50) newLiveAlerts = newLiveAlerts.slice(0, 50)
  }

  emit({ ...snapshot, feed: newFeed, liveAlerts: newLiveAlerts, rover: newRover })
}

function connect(): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${location.host}/ws`)
  ws.onopen = () => { emit({ ...snapshot, connected: true }) }
  ws.onclose = () => { emit({ ...snapshot, connected: false }); setTimeout(connect, 1500) }
  ws.onmessage = (e) => { handle(JSON.parse(e.data)) }
}

async function postJSON(url: string, body: any): Promise<any> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`${url} -> ${r.status}: ${await r.text()}`)
  return r.json()
}

async function getJSON(url: string): Promise<any> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} -> ${r.status}`)
  return r.json()
}

export const gateway = {
  connect,
  async refreshSecurityEvents(rover?: string): Promise<void> {
    const events = await getJSON(`/api/security-events${rover ? `?rover=${rover}` : ''}`)
    emit({ ...snapshot, securityEvents: events })
  },
  async issueNonce(rover: string, operator: string): Promise<any> {
    return postJSON('/api/nonce', { rover, operator })
  },
  async signBytes(envelope: any): Promise<any> {
    return postJSON('/api/sign-bytes', { envelope })
  },
  async sendCommand(envelope: any, signature: string): Promise<any> {
    return postJSON('/api/command', { envelope, signature })
  },
}
