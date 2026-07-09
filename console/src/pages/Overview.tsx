// Overview — the Friday Labs OS control-panel home. A single-glance cockpit:
// compute-node health, live link, active mission, operating mode, and the
// rover brain. Real data where the backend exposes it; clearly-labelled
// "configured / not yet reporting" where the OS layer is still being wired.

import { useNavigate } from 'react-router-dom'
import { Button, Tag, SkeletonText } from '@carbon/react'
import { Chip, Satellite, Microscope, ArrowRight, Bot, Roadmap } from '@carbon/icons-react'
import { useAsync } from '../lib/useAsync'
import { useLiveStore } from '../lib/store'
import { ConfigCard, type CardStatus } from '../components/ConfigCard'
import * as api from '../lib/api'

function Dot({ status }: { status: CardStatus }) {
  const cls = { ok: 'cc-dot--ok', warn: 'cc-dot--warn', err: 'cc-dot--err', off: 'cc-dot--off' }[status]
  return <span className={`cc-dot ${cls}`} aria-hidden="true" />
}

const STATUS_TAG: Record<CardStatus, { type: 'green' | 'gray' | 'red' | 'blue'; label: string }> = {
  ok: { type: 'green', label: 'online' },
  warn: { type: 'blue', label: 'configured' },
  err: { type: 'red', label: 'fault' },
  off: { type: 'gray', label: 'not reporting' },
}

export function Overview() {
  const nav = useNavigate()
  const { connected } = useLiveStore()
  const rovers = useAsync(() => api.rovers(), [])
  const missions = useAsync(() => api.missions(), [])
  const operators = useAsync(() => api.operators(), [])

  const rover = rovers.data?.[0]
  const roverOnline = !!rover && rover.status === 'Active'
  const activeMissions = (missions.data ?? []).filter((m) => m.status === 'Active')

  // The three compute nodes. Core Hub tracks the connected rover; Telemetry
  // Gateway + Research Deck are provisioned targets not yet reporting.
  const nodes: Array<{ name: string; role: string; addr: string; Icon: any; status: CardStatus; meta: string; to: string }> = [
    {
      name: 'Core Hub', role: 'Pi 4B · friday-core-os', addr: '10.0.1.1',
      Icon: Chip, status: roverOnline ? 'ok' : 'off',
      meta: roverOnline ? 'module-registry · mosquitto · micro-ROS agent' : 'no rover reporting',
      to: '/system',
    },
    {
      name: 'Telemetry Gateway', role: 'Pi 3B+ · friday-telemetry-os', addr: '10.0.1.2',
      Icon: Satellite, status: 'off', meta: 'image not built yet', to: '/system',
    },
    {
      name: 'Research Deck', role: 'Pi 5 · friday-researchdeck-os', addr: '10.0.1.3',
      Icon: Microscope, status: 'off', meta: 'hardware pending (Pi 5 + AI HAT+ 2)', to: '/system',
    },
  ]

  return (
    <div className="cc-page">
      <header className="cc-pagehead">
        <p className="cc-pagehead__eyebrow">Friday Labs OS</p>
        <div className="cc-pagehead__row">
          <div>
            <h1 className="cc-pagehead__title">Mark 1 — control panel</h1>
            <p className="cc-pagehead__sub">Configure and operate the rover operating system — nodes, modules, modes, and the AI brain, from one place.</p>
          </div>
          <Tag type={connected ? 'green' : 'gray'} size="md">
            <Dot status={connected ? 'ok' : 'off'} />{connected ? 'Command link live' : 'Command link offline'}
          </Tag>
        </div>
      </header>

      {/* ── Compute nodes ─────────────────────────────────────────────────── */}
      <section className="cc-section">
        <div className="cc-section__head">
          <h2 className="cc-section__title">System</h2>
          <span className="cc-section__meta">3 compute nodes</span>
        </div>
        <div className="cc-grid cc-grid--3">
          {nodes.map((n) => {
            const tag = STATUS_TAG[n.status]
            return (
              <ConfigCard key={n.name} status={n.status} onClick={() => nav(n.to)}>
                <div className="cc-card__head">
                  <div>
                    <p className="cc-card__eyebrow">{n.role}</p>
                    <h3 className="cc-card__title">{n.name}</h3>
                  </div>
                  <n.Icon size={20} className="cc-card__icon" />
                </div>
                <div className="cc-card__body">
                  <Tag type={tag.type} size="sm">{tag.label}</Tag>
                  <p className="cc-card__meta">{n.addr} · {n.meta}</p>
                </div>
                <div className="cc-card__foot">
                  <Button kind="ghost" size="sm" renderIcon={ArrowRight} onClick={(e) => { e.stopPropagation(); nav(n.to) }}>Manage</Button>
                </div>
              </ConfigCard>
            )
          })}
        </div>
      </section>

      {/* ── At a glance ───────────────────────────────────────────────────── */}
      <section className="cc-section">
        <div className="cc-section__head">
          <h2 className="cc-section__title">At a glance</h2>
        </div>
        <div className="cc-grid cc-grid--4">
          <ConfigCard status={connected ? 'ok' : 'off'}>
            <p className="cc-card__eyebrow">Command link</p>
            <p className="cc-card__metric">{connected ? 'Live' : 'Off'}</p>
            <p className="cc-card__meta">signed MQTT · EMQX broker</p>
          </ConfigCard>
          <ConfigCard status={activeMissions.length ? 'ok' : 'off'}>
            <p className="cc-card__eyebrow">Active missions</p>
            {missions.loading
              ? <SkeletonText heading width="40%" />
              : <p className="cc-card__metric">{activeMissions.length}</p>}
            <p className="cc-card__meta">{(missions.data?.length ?? 0)} total planned</p>
          </ConfigCard>
          <ConfigCard status="ok" onClick={() => nav('/access')}>
            <p className="cc-card__eyebrow">Operators</p>
            {operators.loading
              ? <SkeletonText heading width="40%" />
              : <p className="cc-card__metric">{operators.data?.length ?? 0}</p>}
            <p className="cc-card__meta">allowlisted signing keys</p>
          </ConfigCard>
          <ConfigCard status="warn" onClick={() => nav('/modules')}>
            <p className="cc-card__eyebrow">Modules</p>
            <p className="cc-card__metric">1<small>/ 4</small></p>
            <p className="cc-card__meta">locomotion live · sensors, bay pending</p>
          </ConfigCard>
        </div>
      </section>

      {/* ── Mode + Brain ──────────────────────────────────────────────────── */}
      <section className="cc-section">
        <div className="cc-section__head">
          <h2 className="cc-section__title">Autonomy</h2>
        </div>
        <div className="cc-grid cc-grid--2">
          <ConfigCard status="warn">
            <div className="cc-card__head">
              <div>
                <p className="cc-card__eyebrow">Operating mode</p>
                <h3 className="cc-card__title">Manual · Bench · Rules brain</h3>
              </div>
              <Roadmap size={20} className="cc-card__icon" />
            </div>
            <div className="cc-card__body">
              <div className="cc-kv"><span className="cc-kv__k">Autonomy level</span><span className="cc-kv__v">0 — Manual</span></div>
              <div className="cc-kv"><span className="cc-kv__k">Mission profile</span><span className="cc-kv__v">Bench</span></div>
              <div className="cc-kv"><span className="cc-kv__k">Decision brain</span><span className="cc-kv__v">Rules</span></div>
            </div>
            <div className="cc-card__foot">
              <Button kind="tertiary" size="sm" renderIcon={ArrowRight} onClick={() => nav('/modes')}>Change mode</Button>
              <span className="cc-card__meta">mode-manager pending</span>
            </div>
          </ConfigCard>

          <ConfigCard status="warn">
            <div className="cc-card__head">
              <div>
                <p className="cc-card__eyebrow">Rover brain</p>
                <h3 className="cc-card__title">Hermes (stripped) · MiniMax-M3</h3>
              </div>
              <Bot size={20} className="cc-card__icon" />
            </div>
            <div className="cc-card__body">
              <div className="cc-kv"><span className="cc-kv__k">Status</span><span className="cc-kv__v">Built · not deployed</span></div>
              <div className="cc-kv"><span className="cc-kv__k">Provider</span><span className="cc-kv__v"><code>api.minimax.io</code></span></div>
              <div className="cc-kv"><span className="cc-kv__k">Toolset</span><span className="cc-kv__v">hermes-rover (8 tools)</span></div>
            </div>
            <div className="cc-card__foot">
              <Button kind="tertiary" size="sm" renderIcon={ArrowRight} onClick={() => nav('/brain')}>Configure brain</Button>
            </div>
          </ConfigCard>
        </div>
      </section>
    </div>
  )
}
