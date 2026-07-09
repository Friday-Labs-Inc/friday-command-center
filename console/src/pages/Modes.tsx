// Modes — interactive mode composer.
// Local React state only; no backend calls. Three selections (autonomy level,
// mission profile, decision brain) compose a mode that can be activated once
// the OS-side mode-manager is wired. Until then, Activate fires a Toast.

import { useState, useCallback } from 'react'
import { Button, Tag, ToastNotification } from '@carbon/react'
import { Rocket, Roadmap } from '@carbon/icons-react'
import { ConfigCard, type CardStatus } from '../components/ConfigCard'

// ── Domain data ──────────────────────────────────────────────────────────────

const AUTONOMY_LEVELS = [
  {
    id: 0 as const,
    label: 'Manual',
    meta: 'Operator drives every command; rover executes nothing on its own.',
  },
  {
    id: 1 as const,
    label: 'Assisted',
    meta: 'Operator sets goals; rover handles low-level motion and obstacle avoidance.',
  },
  {
    id: 2 as const,
    label: 'Supervised',
    meta: 'Rover plans and executes; operator approves key decisions before acting.',
  },
  {
    id: 3 as const,
    label: 'Autonomous',
    meta: 'AI plans and executes end-to-end; operator supervises and may override.',
  },
]

const PROFILES = [
  { id: 'Bench' as const,         meta: 'Lab testing and calibration — safe indoor environment.' },
  { id: 'Agriculture' as const,   meta: 'Crop monitoring, soil sampling and irrigation scouting.' },
  { id: 'Forestry' as const,      meta: 'Canopy mapping, trail surveying and fire-risk assessment.' },
  { id: 'Environmental' as const, meta: 'Water, air and soil quality monitoring in the field.' },
  { id: 'Surveillance' as const,  meta: 'Non-destructive perimeter watch and anomaly reporting.' },
]

const BRAINS = [
  { id: 'Rules' as const,  meta: 'Deterministic rule set — fast, predictable, zero inference cost.' },
  { id: 'Nav2' as const,   meta: 'ROS 2 Nav2 stack — autonomy via behavior trees and path planning.' },
  { id: 'Vision' as const, meta: 'Edge vision model — perception-driven decisions from camera data.' },
  { id: 'Hermes' as const, meta: 'Hermes AI (MiniMax-M3) — LLM-backed reasoning and tool execution.' },
]

type AutonLevel  = typeof AUTONOMY_LEVELS[number]['id']
type ProfileId   = typeof PROFILES[number]['id']
type BrainId     = typeof BRAINS[number]['id']

// ── Helpers ──────────────────────────────────────────────────────────────────

function cardStatus(selected: boolean): CardStatus {
  return selected ? 'ok' : 'off'
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function Modes() {
  const [autonomy, setAutonomy] = useState<AutonLevel>(0)
  const [profile,  setProfile]  = useState<ProfileId>('Bench')
  const [brain,    setBrain]    = useState<BrainId>('Rules')
  const [toast,    setToast]    = useState(false)

  const selectedLevel   = AUTONOMY_LEVELS.find(l => l.id === autonomy)!
  const selectedProfile = PROFILES.find(p => p.id === profile)!
  const selectedBrain   = BRAINS.find(b => b.id === brain)!

  const handleActivate = useCallback(() => {
    setToast(true)
    setTimeout(() => setToast(false), 7000)
  }, [])

  return (
    <div className="cc-page">

      {/* ── Toast (fixed so it floats above all content) ───────────────────── */}
      {toast && (
        <div style={{ position: 'fixed', top: '3.75rem', right: '1.5rem', zIndex: 9000 }}>
          <ToastNotification
            kind="info"
            title="Mode activation pending"
            subtitle="mode-manager pending — this will bring up the mode's services when the OS layer is wired."
            timeout={7000}
            onCloseButtonClick={() => setToast(false)}
          />
        </div>
      )}

      {/* ── Page header ────────────────────────────────────────────────────── */}
      <header className="cc-pagehead">
        <p className="cc-pagehead__eyebrow">Autonomy</p>
        <div className="cc-pagehead__row">
          <div>
            <h1 className="cc-pagehead__title">Operating modes</h1>
            <p className="cc-pagehead__sub">
              A mode = autonomy level × mission profile × decision brain. Compose one and activate.
            </p>
          </div>
          <Tag type="blue" size="md">mode-manager pending</Tag>
        </div>
      </header>

      {/* ── Section 1: Autonomy level ──────────────────────────────────────── */}
      <section className="cc-section">
        <div className="cc-section__head">
          <h2 className="cc-section__title">Autonomy level</h2>
          <span className="cc-section__meta">4 levels · tap to select</span>
        </div>
        <div className="cc-grid cc-grid--4">
          {AUTONOMY_LEVELS.map(l => (
            <ConfigCard
              key={l.id}
              status={cardStatus(l.id === autonomy)}
              onClick={() => setAutonomy(l.id)}
            >
              <p className="cc-card__eyebrow">Level {l.id}</p>
              <h3 className="cc-card__title">{l.label}</h3>
              <p className="cc-card__meta">{l.meta}</p>
            </ConfigCard>
          ))}
        </div>
      </section>

      {/* ── Section 2: Mission profile ─────────────────────────────────────── */}
      <section className="cc-section">
        <div className="cc-section__head">
          <h2 className="cc-section__title">Mission profile</h2>
          <span className="cc-section__meta">5 profiles · tap to select</span>
        </div>
        <div className="cc-grid cc-grid--3">
          {PROFILES.map(p => (
            <ConfigCard
              key={p.id}
              status={cardStatus(p.id === profile)}
              onClick={() => setProfile(p.id)}
            >
              <p className="cc-card__eyebrow">Profile</p>
              <h3 className="cc-card__title">{p.id}</h3>
              <p className="cc-card__meta">{p.meta}</p>
            </ConfigCard>
          ))}
        </div>
      </section>

      {/* ── Section 3: Decision brain ──────────────────────────────────────── */}
      <section className="cc-section">
        <div className="cc-section__head">
          <h2 className="cc-section__title">Decision brain</h2>
          <span className="cc-section__meta">4 brains · tap to select</span>
        </div>
        <div className="cc-grid cc-grid--4">
          {BRAINS.map(b => (
            <ConfigCard
              key={b.id}
              status={cardStatus(b.id === brain)}
              onClick={() => setBrain(b.id)}
            >
              <p className="cc-card__eyebrow">Brain</p>
              <h3 className="cc-card__title">{b.id}</h3>
              <p className="cc-card__meta">{b.meta}</p>
            </ConfigCard>
          ))}
        </div>
      </section>

      {/* ── Section 4: Selected mode ───────────────────────────────────────── */}
      <section className="cc-section">
        <div className="cc-section__head">
          <h2 className="cc-section__title">Selected mode</h2>
          <span className="cc-section__meta">review before activating</span>
        </div>
        <ConfigCard status="warn">
          <div className="cc-card__head">
            <div>
              <p className="cc-card__eyebrow">Composed mode</p>
              <h3 className="cc-card__title">
                {selectedLevel.label} · {selectedProfile.id} · {selectedBrain.id} brain
              </h3>
            </div>
            <Roadmap size={20} className="cc-card__icon" />
          </div>
          <div className="cc-card__body">
            <div className="cc-kv">
              <span className="cc-kv__k">Autonomy</span>
              <span className="cc-kv__v">{selectedLevel.id} — {selectedLevel.label}</span>
            </div>
            <div className="cc-kv">
              <span className="cc-kv__k">Profile</span>
              <span className="cc-kv__v">{selectedProfile.id}</span>
            </div>
            <div className="cc-kv">
              <span className="cc-kv__k">Brain</span>
              <span className="cc-kv__v">{selectedBrain.id}</span>
            </div>
          </div>
          <div className="cc-card__foot">
            <Button kind="primary" size="md" renderIcon={Rocket} onClick={handleActivate}>
              Activate mode
            </Button>
            <span className="cc-card__meta">mode-manager pending — OS-side wiring required</span>
          </div>
        </ConfigCard>
      </section>

    </div>
  )
}
