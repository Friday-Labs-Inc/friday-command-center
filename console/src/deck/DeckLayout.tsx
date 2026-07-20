// FCC 2030 Command Deck — the flagship shell. Top status rail, nav, live
// telemetry column, event stream. Views render in the center with a CSS
// keyframe enter (keyed on route). Real data: module registry + gateway
// latency. Concept data (authority lease, brain, safe-stop) states its source.

import { useEffect, useMemo, useState } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import './deck.scss'
import { DeckContext, fleetSeats, stateDot, useDeck, useDeckDataSource } from './data'
import { Panel } from './bits'
import { BridgeView } from './views/BridgeView'
import { ModulesView } from './views/ModulesView'
import { MissionsView } from './views/MissionsView'
import { TerrainView } from './views/TerrainView'
import { EnvironmentView } from './views/EnvironmentView'
import { ModesView } from './views/ModesView'
import { BrainView } from './views/BrainView'
import { SystemView } from './views/SystemView'
import { AccessView } from './views/AccessView'
import { CertificatesView } from './views/CertificatesView'
import { SecurityView } from './views/SecurityView'
import { CommandView } from './views/CommandView'

// ── nav icons (inline, stroke-only) ──────────────────────────────────────────
const I = {
  bridge: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor">
      <circle cx="8" cy="8" r="6.2" /><circle cx="8" cy="8" r="1.6" fill="currentColor" />
      <path d="M8 1.8v2.4M8 11.8v2.4M1.8 8h2.4M11.8 8h2.4" />
    </svg>
  ),
  modules: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor">
      <rect x="1.5" y="1.5" width="5.4" height="5.4" /><rect x="9.1" y="1.5" width="5.4" height="5.4" />
      <rect x="1.5" y="9.1" width="5.4" height="5.4" /><rect x="9.1" y="9.1" width="5.4" height="5.4" />
    </svg>
  ),
  missions: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor">
      <path d="M2 13.5 6 3l4 7 4-9" />
      <circle cx="2" cy="13.5" r="1.3" fill="currentColor" /><circle cx="14" cy="1.5" r="1.3" fill="currentColor" />
    </svg>
  ),
  terrain: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor">
      <path d="M1.5 12.5 5 6l2.5 4L11 4l3.5 8.5z" /><path d="M1.5 12.5h13" opacity=".5" />
    </svg>
  ),
  environment: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor">
      <path d="M6 2v7.2a3 3 0 1 0 4 0V2z" /><path d="M8 5v6" opacity=".6" />
      <circle cx="8" cy="11.5" r="1.1" fill="currentColor" />
    </svg>
  ),
  config: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor">
      <rect x="2" y="2" width="12" height="12" rx="1" /><path d="M5 8h6M5 11h4M5 5h6" />
    </svg>
  ),
  system: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor">
      <rect x="1.8" y="2.2" width="12.4" height="4" rx="1" /><rect x="1.8" y="9.8" width="12.4" height="4" rx="1" />
      <circle cx="4.4" cy="4.2" r="0.7" fill="currentColor" /><circle cx="4.4" cy="11.8" r="0.7" fill="currentColor" />
    </svg>
  ),
  modes: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor">
      <path d="M2 4.5h12M2 8h12M2 11.5h12" /><circle cx="5" cy="4.5" r="1.5" fill="var(--void)" /><circle cx="10" cy="8" r="1.5" fill="var(--void)" /><circle cx="6.5" cy="11.5" r="1.5" fill="var(--void)" />
    </svg>
  ),
  brain: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor">
      <rect x="4.5" y="4.5" width="7" height="7" rx="1" /><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M4.5 2.5v2M11.5 2.5v2M4.5 11.5v2M11.5 11.5v2" />
    </svg>
  ),
  access: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor">
      <circle cx="6" cy="6" r="3.2" /><path d="M8.2 8.2 13.5 13.5M11 11l1.5-1.5M12.5 12.5 14 11" />
    </svg>
  ),
  certs: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor">
      <path d="M8 1.5 13.5 4v4.5C13.5 11.5 11 13.7 8 14.5 5 13.7 2.5 11.5 2.5 8.5V4z" /><path d="M6 8l1.6 1.6L10.2 6.5" />
    </svg>
  ),
  audit: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor">
      <rect x="2.5" y="1.8" width="11" height="12.4" rx="1" /><path d="M5 5h6M5 8h6M5 11h4" />
    </svg>
  ),
  command: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor">
      <rect x="1.8" y="2.5" width="12.4" height="11" rx="1" /><path d="M4.5 6l2 2-2 2M8.5 10h3" />
    </svg>
  ),
}

function MissionClock() {
  const [t, setT] = useState(0)
  useEffect(() => {
    const t0 = Date.now()
    const id = setInterval(() => setT(Math.floor((Date.now() - t0) / 1000)), 1000)
    return () => clearInterval(id)
  }, [])
  const p = (n: number) => String(n).padStart(2, '0')
  return <>{`T+${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`}</>
}

function TopRail() {
  const { modules, error, latencyMs } = useDeck()
  const liveCount = (modules ?? []).filter((m) => m.liveness === 'OK').length
  return (
    <header className="dk-top">
      <div className="dk-wordmark"><b>Friday</b><span>FCC · DECK</span></div>
      <div className="dk-topsep" />
      <div className="dk-stat"><span className="k">Session clock</span><span className="v"><MissionClock /></span></div>
      <div className="dk-topsep dk-s-uplink" />
      <div className="dk-stat dk-s-uplink">
        <span className="k">Gateway</span>
        <span className="dk-chain">
          <i style={error ? { background: 'var(--crit)', boxShadow: '0 0 8px var(--crit)' } : undefined} />
          {error ? 'REGISTRY UNREACHABLE' : <>LIVE<span className="sep">·</span>{latencyMs != null ? `${latencyMs} ms` : '—'}</>}
        </span>
      </div>
      <div className="dk-topsep dk-s-rover" />
      <div className="dk-stat dk-s-rover">
        <span className="k">Rover</span>
        <span className="v">MARK1-001 <span className="u">· domain 42 · {liveCount} live</span></span>
      </div>
      <div className="dk-grow" />
      <div className="dk-lease">
        <span className="k">AUTHORITY</span>
        <span className="v">MARK1-CORE-001</span>
      </div>
      <div className="dk-operator">
        <div className="ring">OP</div>
        <div className="dk-stat"><span className="k">Operator</span><span className="v">console · read-only</span></div>
      </div>
    </header>
  )
}

function Nav() {
  type IconKey = keyof typeof I
  const views: Array<[string, string, IconKey]> = [
    ['', 'Bridge', 'bridge'],
    ['modules', 'Modules', 'modules'],
    ['missions', 'Missions', 'missions'],
    ['terrain', 'Terrain', 'terrain'],
    ['environment', 'Environment', 'environment'],
  ]
  const control: Array<[string, string, IconKey]> = [
    ['system', 'System', 'system'],
    ['modes', 'Modes', 'modes'],
    ['brain', 'Brain', 'brain'],
  ]
  const security: Array<[string, string, IconKey]> = [
    ['access', 'Access', 'access'],
    ['certificates', 'Certificates', 'certs'],
    ['security', 'Security', 'audit'],
    ['command', 'Command', 'command'],
  ]
  return (
    <nav className="dk-nav" aria-label="Deck navigation">
      <div className="grp">DECK</div>
      {views.map(([path, label, icon]) => (
        <NavLink key={label} to={`/deck/${path}`} end={path === ''} className={({ isActive }) => (isActive ? 'on' : '')}>
          {I[icon]}<span className="lbl">{label}</span>
        </NavLink>
      ))}
      <div className="grp">CONTROL</div>
      {control.map(([path, label, icon]) => (
        <NavLink key={label} to={`/deck/${path}`} className={({ isActive }) => (isActive ? 'on' : '')}>
          {I[icon]}<span className="lbl">{label}</span>
        </NavLink>
      ))}
      <div className="grp">SECURITY</div>
      {security.map(([path, label, icon]) => (
        <NavLink key={label} to={`/deck/${path}`} className={({ isActive }) => (isActive ? 'on' : '')}>
          {I[icon]}<span className="lbl">{label}</span>
        </NavLink>
      ))}
      <div className="foot">
        <div className="rovername">◈ MARK1 · FIELD UNIT 001</div>
        <div className="rovermeta">modular research rover<br />ROS 2 Jazzy · domain 42<br />signed MQTT · mTLS</div>
      </div>
    </nav>
  )
}

function Telemetry() {
  const { modules } = useDeck()
  const seats = useMemo(() => fleetSeats(modules), [modules])
  const drive = (modules ?? []).find((m) => m.module_id === 'MARK1-MOB-DRIVE-001')
  return (
    <aside className="dk-tele" aria-label="Telemetry">
      <Panel title="Heartbeat · Drive" meta="/mark1/locomotion">
        <div className="dk-pad">
          <div className="dk-bignum">{drive && drive.liveness === 'OK' ? '5.0' : '—'} <span className="u">Hz</span></div>
          <div className="dk-subnum">
            {drive ? <>age {drive.heartbeat_age_s ?? '—'} s · {drive.liveness} · BEST_EFFORT</> : 'not registered'}
          </div>
        </div>
      </Panel>
      <Panel title="Liveness" meta="registry · live">
        <div className="dk-pad">
          {seats.map((s) => (
            <div className="dk-lvrow" key={s.module_id}>
              <span className={`dk-lvdot ${stateDot[s.state]}`} />
              <span className="nm">{s.short}</span>
              <span className="age">{s.live ? `${s.live.heartbeat_age_s ?? '—'} s` : '—'}</span>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Safe-stop budget" meta="HIL-verified">
        <div className="dk-pad">
          <div className="dk-bignum">107 <span className="u">ms</span></div>
          <div className="dk-safebar"><i /></div>
          <div className="dk-safelbl"><span>measured (sim, Phase 4)</span><span>budget 500 ms</span></div>
        </div>
      </Panel>
    </aside>
  )
}

function Stream() {
  const { events, pushEvent } = useDeck()
  return (
    <footer className="dk-stream">
      <div className="dk-events">
        {events.map((e, i) => (
          <div className={`dk-ev ${e.kind}`} key={`${e.ts}-${i}`}>
            <span className="ts">{e.ts}</span>
            <span className="src">{e.src}</span>
            <span className="msg">{e.msg}</span>
          </div>
        ))}
        {events.length === 0 && (
          <div className="dk-ev"><span className="ts">—</span><span className="src">deck</span><span className="msg">waiting for registry events…</span></div>
        )}
      </div>
      <div className="dk-cmdline">
        <span className="ps">mark1://cmd ▸</span>
        <input
          placeholder="command dispatch arrives with the signing agent — input is parked for now"
          aria-label="Command input"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.currentTarget.value.trim()) {
              pushEvent('dispatch', `parked (no signer wired): ${e.currentTarget.value.trim()}`, 'warn')
              e.currentTarget.value = ''
            }
          }}
        />
        <span className="sig">SIGNING AGENT <b style={{ color: 'var(--dim)' }}>○ OFFLINE</b></span>
      </div>
    </footer>
  )
}

function DeckMain() {
  const location = useLocation()
  // Keyed wrapper → remounts per route, replaying the CSS enter animation.
  // (A declarative CSS keyframe always resolves to the visible end state; the
  // previous framer-motion AnimatePresence could stick at opacity 0 when the
  // deck's frequent state updates interrupted the JS-driven enter animation.)
  return (
    <main className="dk-main">
      <div key={location.pathname} className="dk-view">
        <Routes location={location}>
          <Route index element={<BridgeView />} />
          <Route path="modules" element={<ModulesView />} />
          <Route path="missions" element={<MissionsView />} />
          <Route path="terrain" element={<TerrainView />} />
          <Route path="environment" element={<EnvironmentView />} />
          <Route path="system" element={<SystemView />} />
          <Route path="modes" element={<ModesView />} />
          <Route path="brain" element={<BrainView />} />
          <Route path="access" element={<AccessView />} />
          <Route path="certificates" element={<CertificatesView />} />
          <Route path="security" element={<SecurityView />} />
          <Route path="command" element={<CommandView />} />
        </Routes>
      </div>
      <div className="dk-scanline" />
    </main>
  )
}

export function DeckApp() {
  const data = useDeckDataSource()
  return (
    <DeckContext.Provider value={data}>
      <div className="dk-root">
        <div className="dk-grid">
          <TopRail />
          <Nav />
          <DeckMain />
          <Telemetry />
          <Stream />
        </div>
      </div>
    </DeckContext.Provider>
  )
}
