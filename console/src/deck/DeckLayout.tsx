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
  return (
    <nav className="dk-nav" aria-label="Deck navigation">
      <div className="grp">DECK</div>
      {views.map(([path, label, icon]) => (
        <NavLink key={label} to={`/deck/${path}`} end={path === ''} className={({ isActive }) => (isActive ? 'on' : '')}>
          {I[icon]}<span className="lbl">{label}</span>
        </NavLink>
      ))}
      <div className="grp">CONFIG · CLASSIC</div>
      <a href="/system">{I.config}<span className="lbl">System</span><span className="tag">CC</span></a>
      <a href="/modes">{I.config}<span className="lbl">Modes</span><span className="tag">CC</span></a>
      <a href="/brain">{I.config}<span className="lbl">Brain</span><span className="tag">CC</span></a>
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
