// Fully-typed REST client for the Friday Command Center gateway.
// All paths are relative so the browser always talks to the same origin as the page.
// Throws Error("<METHOD> <path> -> <status>: <body>") on non-2xx responses.
// The gateway is the ONLY origin; never call Frappe directly.

// ── HTTP helpers ─────────────────────────────────────────────────────────────

async function getJSON<T>(path: string): Promise<T> {
  const r = await fetch(path)
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}: ${await r.text()}`)
  return r.json() as Promise<T>
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`POST ${path} -> ${r.status}: ${await r.text()}`)
  return r.json() as Promise<T>
}

// ── Domain interfaces (verified DocType fields) ───────────────────────────────

export interface Rover {
  name: string          // Frappe doc name (internal ID)
  rover_id: string
  rover_name: string
  fleet: string
  status: string        // Select: online | offline | error
  firmware_version: string
  tls_cert_fingerprint: string
  signing_public_key: string
  owner_org: string
  last_seen: string | null
  last_pose_x: number
  last_pose_y: number
  last_pose_theta: number
}

export interface RoverStateSnapshot {
  rover: string
  x: number
  y: number
  theta: number
  updated: string | null
}

export interface Fleet {
  name: string
  fleet_name: string
  status: string
  description: string
}

export interface Waypoint {
  seq: number
  x: number
  y: number
  action: string
}

export interface Mission {
  name: string
  title: string
  rover: string
  status: string        // Draft | Pending | Approved | Active | Completed | Aborted
  approved_by: string | null
  approved_on: string | null
  mission_payload: string   // JSON string (Code field)
  waypoints: Waypoint[]
}

export interface Operator {
  name: string
  operator_id: string
  operator_name: string
  status: string        // Active | Suspended | Revoked
  user: string
  ed25519_public_key: string
  key_fingerprint: string
}

export interface AllowlistEntry {
  name: string
  rover: string
  operator: string
  enabled: 0 | 1
  epoch: number
  granted_on: string
  granted_by: string
  notes: string
}

export interface Revocation {
  name: string
  operator: string
  scope: 'All Rovers' | 'Specific Rover'
  rover: string | null
  status: string        // Active | Lifted
  epoch: number
  revoked_on: string
  revoked_by: string
  reason: string
}

export interface SecurityEvent {
  name: string
  rover: string
  operator: string | null
  category: string
  severity: string      // Critical | Error | Warning | Info
  event_time: string | null
  acknowledged: 0 | 1
  acknowledged_by: string | null
  acknowledged_on: string | null
  description: string | null
  source_fault: string | null
}

export interface AuditEntry {
  name: string
  rover: string
  operator: string
  command_class: string
  outcome: string       // Accepted | Rejected | Expired | Replayed
  category: string
  msg_id: string
  nonce: string
  issued_at: string
  expires_at: string
  received_at: string
  payload: string       // JSON string
  signature: string
}

export interface Certificate {
  name: string
  rover: string
  common_name: string
  status: string        // Active | Revoked
  issuing_ca: string
  serial: string
  fingerprint: string
  issued_on: string
  expires_on: string
  revoked_on: string | null
  revoked_reason: string | null
  cert_pem: string
}

export interface CertAuthority {
  name: string
  common_name: string
  status: string
  created: string
}

export interface Settings {
  protocol_major: number
  broker_host: string
  broker_port: number
  command_expiry_s: number
  clock_skew_tolerance_s: number
  default_authority_lease_s: number
}

export type ServiceAction = 'start' | 'stop' | 'restart'

/** Live systemd unit status from the Core Hub os-control agent. */
export interface SystemService {
  name: string          // systemd unit (e.g. module-registry.service)
  active: string        // ActiveState: active | inactive | failed | activating | ...
  sub: string           // SubState: running | dead | exited | ...
  enabled: string       // UnitFileState: enabled | disabled | static
  description: string
}

/** Result of a start/stop/restart action. */
export interface ServiceActionResult {
  name: string
  action: ServiceAction
  ok: boolean
  active: string
  sub: string
  stderr: string
}

// ── Request body types ────────────────────────────────────────────────────────

export interface CreateMissionBody {
  title: string
  rover: string
  waypoints: Array<{ seq: number; x: number; y: number; action: string }>
  payload?: string
}

export interface RevokeOperatorBody {
  operator: string
  scope: 'All Rovers' | 'Specific Rover'
  rover?: string
  reason: string
}

export interface IssueCertBody {
  rover: string
  cert_pem: string
  serial: string
  fingerprint: string
  expires_on: string
  issuing_ca: string
}

// ── Nonce / command response types ────────────────────────────────────────────

export interface NonceResponse {
  nonce: string
  issued_at: string
  expires_at: string
}

export interface SignBytesResponse {
  signing_hex: string
}

export interface CommandResponse {
  nonce: string
}

export interface OkResponse {
  ok: true
}

// ── Fleet ─────────────────────────────────────────────────────────────────────

/** GET /api/rovers — list all rovers */
export const rovers = (): Promise<Rover[]> =>
  getJSON('/api/rovers')

/** GET /api/rover-state?rover=<id> — latest telemetry snapshot */
export const roverState = (id: string): Promise<RoverStateSnapshot> =>
  getJSON(`/api/rover-state?rover=${encodeURIComponent(id)}`)

/** GET /api/fleets — list all fleets */
export const fleets = (): Promise<Fleet[]> =>
  getJSON('/api/fleets')

// ── Missions ──────────────────────────────────────────────────────────────────

/** GET /api/missions — list all missions */
export const missions = (): Promise<Mission[]> =>
  getJSON('/api/missions')

/** GET /api/mission?name=<name> — fetch a single mission with waypoints */
export const mission = (name: string): Promise<Mission> =>
  getJSON(`/api/mission?name=${encodeURIComponent(name)}`)

/** POST /api/mission — create a new mission (returns created Mission) */
export const createMission = (body: CreateMissionBody): Promise<Mission> =>
  postJSON('/api/mission', body)

// ── Operators ─────────────────────────────────────────────────────────────────

/** GET /api/operators — list all operators */
export const operators = (): Promise<Operator[]> =>
  getJSON('/api/operators')

/** GET /api/allowlist?rover=<id> — rover's operator allowlist */
export const allowlist = (rover: string): Promise<AllowlistEntry[]> =>
  getJSON(`/api/allowlist?rover=${encodeURIComponent(rover)}`)

/** POST /api/operator/revoke — revoke an operator's access */
export const revokeOperator = (body: RevokeOperatorBody): Promise<OkResponse> =>
  postJSON('/api/operator/revoke', body)

/** GET /api/revocations — list all operator revocations */
export const revocations = (): Promise<Revocation[]> =>
  getJSON('/api/revocations')

/** POST /api/revocation/lift — lift an active revocation by doc name */
export const liftRevocation = (name: string): Promise<OkResponse> =>
  postJSON('/api/revocation/lift', { name })

// ── Certificates ──────────────────────────────────────────────────────────────

/**
 * GET /api/certificates?status=<status>&rover=<rover>
 * Both params are optional. status: 'Active' | 'Revoked'
 */
export const certificates = (
  status?: 'Active' | 'Revoked',
  rover?: string,
): Promise<Certificate[]> => {
  const q = new URLSearchParams()
  if (status) q.set('status', status)
  if (rover) q.set('rover', rover)
  const qs = q.toString()
  return getJSON(`/api/certificates${qs ? `?${qs}` : ''}`)
}

/** GET /api/certificate-authorities — list CAs */
export const certificateAuthorities = (): Promise<CertAuthority[]> =>
  getJSON('/api/certificate-authorities')

/** POST /api/certificate/issue — issue a rover certificate */
export const issueCertificate = (body: IssueCertBody): Promise<Certificate> =>
  postJSON('/api/certificate/issue', body)

/** POST /api/certificate/revoke — revoke a certificate by name */
export const revokeCertificate = (name: string, reason: string): Promise<OkResponse> =>
  postJSON('/api/certificate/revoke', { name, reason })

// ── Security & Audit ──────────────────────────────────────────────────────────

/**
 * GET /api/audit?rover=<rover>&limit=<n>
 * Both params are optional.
 */
export const auditLog = (rover?: string, limit?: number): Promise<AuditEntry[]> => {
  const q = new URLSearchParams()
  if (rover) q.set('rover', rover)
  if (limit != null) q.set('limit', String(limit))
  const qs = q.toString()
  return getJSON(`/api/audit${qs ? `?${qs}` : ''}`)
}

/**
 * GET /api/security-events?rover=<rover>&limit=<n>
 * Both params are optional.
 */
export const securityEvents = (rover?: string, limit?: number): Promise<SecurityEvent[]> => {
  const q = new URLSearchParams()
  if (rover) q.set('rover', rover)
  if (limit != null) q.set('limit', String(limit))
  const qs = q.toString()
  return getJSON(`/api/security-events${qs ? `?${qs}` : ''}`)
}

/** POST /api/security-event/ack — acknowledge a security event by name */
export const ackSecurityEvent = (name: string): Promise<OkResponse> =>
  postJSON('/api/security-event/ack', { name })

// ── Settings ──────────────────────────────────────────────────────────────────

/** GET /api/settings — Command Center Settings singleton */
export const settings = (): Promise<Settings> =>
  getJSON('/api/settings')

// ── System services (Core Hub OS control) ─────────────────────────────────────

/** GET /api/system/services — live systemd status for the allowlisted Core Hub units */
export const systemServices = (): Promise<SystemService[]> =>
  getJSON('/api/system/services')

/** POST /api/system/service — start | stop | restart an allowlisted unit */
export const systemServiceAction = (
  name: string,
  action: ServiceAction,
): Promise<ServiceActionResult> =>
  postJSON('/api/system/service', { name, action })

// ── Command flow ──────────────────────────────────────────────────────────────
// Reused from gateway.ts. Key stays in the OS keychain agent (see agent.ts);
// these calls only pass the already-signed envelope or bytes to sign.

/** POST /api/nonce — issue a signed nonce for a command envelope */
export const issueNonce = (rover: string, operator: string): Promise<NonceResponse> =>
  postJSON('/api/nonce', { rover, operator })

/** POST /api/sign-bytes — gateway returns the canonical bytes to sign */
export const signBytes = (envelope: unknown): Promise<SignBytesResponse> =>
  postJSON('/api/sign-bytes', { envelope })

/** POST /api/command — dispatch a signed command envelope */
export const sendCommand = (envelope: unknown, signature: string): Promise<CommandResponse> =>
  postJSON('/api/command', { envelope, signature })
