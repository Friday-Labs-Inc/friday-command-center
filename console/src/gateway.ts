// Reactive store + client for the gateway: a live WebSocket event stream plus the
// REST endpoints the panels read/write. The operator's private key never passes
// through here — only signed envelopes do (see signer.ts + CommandConsole.vue).

import { reactive, readonly } from 'vue'

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

const state = reactive({
  connected: false,
  rover: { rover: '—', x: 0, y: 0, theta: 0, updated: null } as RoverState,
  feed: [] as FeedEvent[],
  liveAlerts: [] as FeedEvent[],
  securityEvents: [] as SecurityEvent[],
})

function handle(ev: any) {
  const item: FeedEvent = {
    ts: new Date().toLocaleTimeString(), kind: ev.kind, rover: ev.rover, topic: ev.topic, data: ev.data,
  }
  state.feed.unshift(item)
  if (state.feed.length > 100) state.feed.pop()

  if (ev.kind === 'odom' && ev.data) {
    state.rover = { rover: ev.rover, x: +ev.data.x, y: +ev.data.y, theta: +ev.data.theta, updated: item.ts }
  }
  if (ev.kind === 'fault') {
    state.liveAlerts.unshift(item)
    if (state.liveAlerts.length > 50) state.liveAlerts.pop()
  }
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${location.host}/ws`)
  ws.onopen = () => { state.connected = true }
  ws.onclose = () => { state.connected = false; setTimeout(connect, 1500) }
  ws.onmessage = (e) => handle(JSON.parse(e.data))
}

async function postJSON(url: string, body: any) {
  const r = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`${url} -> ${r.status}: ${await r.text()}`)
  return r.json()
}

async function getJSON(url: string) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} -> ${r.status}`)
  return r.json()
}

export const gateway = {
  state: readonly(state),
  connect,
  async refreshSecurityEvents(rover?: string) {
    state.securityEvents = await getJSON(`/api/security-events${rover ? `?rover=${rover}` : ''}`)
  },
  async issueNonce(rover: string, operator: string) {
    return postJSON('/api/nonce', { rover, operator })
  },
  async signBytes(envelope: any) {
    return postJSON('/api/sign-bytes', { envelope })
  },
  async sendCommand(envelope: any, signature: string) {
    return postJSON('/api/command', { envelope, signature })
  },
}
