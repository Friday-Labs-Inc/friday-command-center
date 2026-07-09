// Modes — interactive mode composer.
// A mode = autonomy level × mission profile × decision brain. The composed mode is
// persisted to the Core Hub via the os-control agent (loaded on open, saved on
// Activate). The rover-side mode-manager that ACTS on the mode is a separate node.

import { useState, useCallback, useEffect } from 'react'
import { Button, Tag, ToastNotification } from '@carbon/react'
import { Rocket, Roadmap } from '@carbon/icons-react'
import { useAsync } from '../lib/useAsync'
import { ConfigCard, type CardStatus } from '../components/ConfigCard'
import * as api from '../lib/api'

// ── Domain data ──────────────────────────────────────────────────────────────

const AUTONOMY_LEVELS = [
  { id: 0 as const, label: 'Manual',     meta: 'Operator drives every command; rover executes nothing on its own.' },
  { id: 1 as const, label: 'Assisted',   meta: 'Operator sets goals; rover handles low-level motion and obstacle avoidance.' },
  { id: 2 as const, label: 'Supervised', meta: 'Rover plans and executes; operator approves key decisions before acting.' },
  { id: 3 as const, label: 'Autonomous', meta: 'AI plans and executes end-to-end; operator supervises and may override.' },
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

type AutonLevel = typeof AUTONOMY_LEVELS[number]['id']
type ProfileId  = typeof PROFILES[number]['id']
type BrainId    = typeof BRAINS[number]['id']

interface Mode { autonomy_level: number; mission_profile: string; brain: string }
type Toast = { kind: 'success' | 'error'; title: string; subtitle: string }

// ── Helpers ──────────────────────────────────────────────────────────────────

const cardStatus = (selected: boolean): CardStatus => (selected ? 'ok' : 'off')

// ── Page ─────────────────────────────────────────────────────────────────────

export function Modes() {
  const modeDoc = useAsync(() => api.activeMode(), [])
  const [autonomy, setAutonomy] = useState<AutonLevel>(0)
  const [profile,  setProfile]  = useState<ProfileId>('Bench')
  const [brain,    setBrain]    = useState<BrainId>('Rules')
  const [active,   setActive]   = useState<Mode | null>(null)
  const [loaded,   setLoaded]   = useState(false)
  const [activating, setActivating] = useState(false)
  const [toast,    setToast]    = useState<Toast | null>(null)

  // Hydrate the composer from the Core Hub's active mode, once.
  useEffect(() => {
    if (modeDoc.data && !loaded) {
      const m = modeDoc.data
      if (AUTONOMY_LEVELS.some(l => l.id === m.autonomy_level)) setAutonomy(m.autonomy_level as AutonLevel)
      if (PROFILES.some(p => p.id === m.mission_profile)) setProfile(m.mission_profile as ProfileId)
      if (BRAINS.some(b => b.id === m.brain)) setBrain(m.brain as BrainId)
      if (m.exists) setActive({ autonomy_level: m.autonomy_level, mission_profile: m.mission_profile, brain: m.brain })
      setLoaded(true)
    }
  }, [modeDoc.data, loaded])

  const selectedLevel   = AUTONOMY_LEVELS.find(l => l.id === autonomy)!
  const selectedProfile = PROFILES.find(p => p.id === profile)!
  const selectedBrain   = BRAINS.find(b => b.id === brain)!

  const isActive = !!active && active.autonomy_level === autonomy
    && active.mission_profile === profile && active.brain === brain

  const handleActivate = useCallback(async () => {
    setActivating(true)
    try {
      const res = await api.saveActiveMode({ autonomy_level: autonomy, mission_profile: profile, brain })
      setActive({ autonomy_level: res.autonomy_level, mission_profile: res.mission_profile, brain: res.brain })
      setToast({ kind: 'success', title: 'Mode activated',
        subtitle: `${selectedLevel.label} · ${profile} · ${brain} saved to the Core Hub` })
    } catch (e) {
      setToast({ kind: 'error', title: 'Activation failed', subtitle: e instanceof Error ? e.message : String(e) })
    } finally {
      setActivating(false)
    }
  }, [autonomy, profile, brain, selectedLevel])

  return (
    <div className="cc-page">
      {toast && (
        <div style={{ position: 'fixed', top: '3.75rem', right: '1.5rem', zIndex: 9000 }}>
          <ToastNotification
            kind={toast.kind}
            lowContrast
            title={toast.title}
            subtitle={toast.subtitle}
            timeout={6000}
            onCloseButtonClick={() => setToast(null)}
          />
        </div>
      )}

      <header className="cc-pagehead">
        <p className="cc-pagehead__eyebrow">Autonomy</p>
        <div className="cc-pagehead__row">
          <div>
            <h1 className="cc-pagehead__title">Operating modes</h1>
            <p className="cc-pagehead__sub">
              A mode = autonomy level × mission profile × decision brain. Compose one and activate.
            </p>
          </div>
          <Tag type={active ? 'green' : 'gray'} size="md">
            {modeDoc.error
              ? 'agent offline'
              : active
                ? `Active · L${active.autonomy_level} ${active.mission_profile} · ${active.brain}`
                : 'no active mode'}
          </Tag>
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
            <ConfigCard key={l.id} status={cardStatus(l.id === autonomy)} onClick={() => setAutonomy(l.id)}>
              <p className="cc-card__eyebrow">Level {l.id}{active?.autonomy_level === l.id ? ' · active' : ''}</p>
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
            <ConfigCard key={p.id} status={cardStatus(p.id === profile)} onClick={() => setProfile(p.id)}>
              <p className="cc-card__eyebrow">Profile{active?.mission_profile === p.id ? ' · active' : ''}</p>
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
            <ConfigCard key={b.id} status={cardStatus(b.id === brain)} onClick={() => setBrain(b.id)}>
              <p className="cc-card__eyebrow">Brain{active?.brain === b.id ? ' · active' : ''}</p>
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
          <span className="cc-section__meta">{isActive ? 'this is the active mode' : 'review before activating'}</span>
        </div>
        <ConfigCard status={isActive ? 'ok' : 'warn'}>
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
            <Button
              kind="primary"
              size="md"
              renderIcon={Rocket}
              onClick={handleActivate}
              disabled={activating || !!modeDoc.error || isActive}
            >
              {activating ? 'Activating…' : isActive ? 'Active' : 'Activate mode'}
            </Button>
            <span className="cc-card__meta">
              {modeDoc.error
                ? 'os-control agent unreachable'
                : 'saved to the Core Hub · rover-side mode-manager applies it (pending)'}
            </span>
          </div>
        </ConfigCard>
      </section>
    </div>
  )
}
