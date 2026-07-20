// Operating Mode — autonomy level × mission profile × decision brain.
// The composed mode persists to the Core Hub (os-control agent). Deck-native
// port of the classic Modes page: same option sets, same activate semantics.

import { useEffect, useState } from 'react'
import { ViewHead, Panel } from '../bits'
import { activeMode, saveActiveMode, dispatchMode, telemetryLatest, type ActiveMode } from '../../lib/api'

const AUTONOMY_LEVELS = [
  { id: 0, label: 'Manual',     meta: 'Operator drives every command; rover executes nothing on its own.' },
  { id: 1, label: 'Assisted',   meta: 'Operator sets goals; rover handles low-level motion and obstacle avoidance.' },
  { id: 2, label: 'Supervised', meta: 'Rover plans and executes; operator approves key decisions before acting.' },
  { id: 3, label: 'Autonomous', meta: 'AI plans and executes end-to-end; operator supervises and may override.' },
]
const PROFILES = [
  { id: 'Bench',         meta: 'Lab testing and calibration — safe indoor environment.' },
  { id: 'Agriculture',   meta: 'Crop monitoring, soil sampling and irrigation scouting.' },
  { id: 'Forestry',      meta: 'Canopy mapping, trail surveying and fire-risk assessment.' },
  { id: 'Environmental', meta: 'Water, air and soil quality monitoring in the field.' },
  { id: 'Surveillance',  meta: 'Non-destructive perimeter watch and anomaly reporting.' },
]
const BRAINS = [
  { id: 'Rules',  meta: 'Deterministic rule set — fast, predictable, zero inference cost.' },
  { id: 'Nav2',   meta: 'ROS 2 Nav2 stack — autonomy via behavior trees and path planning.' },
  { id: 'Vision', meta: 'Edge vision model — perception-driven decisions from camera data.' },
  { id: 'Hermes', meta: 'Hermes AI (MiniMax-M3) — LLM-backed reasoning and tool execution.' },
]

const mono = 'var(--mono)'

function Selector<T extends string | number>(props: {
  label: string
  options: Array<{ id: T; meta: string }>
  labelFor?: (o: { id: T }) => string
  value: T
  onPick: (v: T) => void
}) {
  const { label, options, value, onPick, labelFor } = props
  const active = options.find(o => o.id === value)
  return (
    <Panel title={label}>
      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {options.map(o => (
            <button
              key={String(o.id)}
              className="dk-btn"
              style={o.id === value ? { borderColor: 'var(--cyan)', color: 'var(--cyan)' } : undefined}
              onClick={() => onPick(o.id)}
            >
              {labelFor ? labelFor(o) : String(o.id)}
            </button>
          ))}
        </div>
        {active && (
          <div style={{ fontFamily: mono, fontSize: 11, color: 'var(--dim)', lineHeight: 1.5 }}>
            {active.meta}
          </div>
        )}
      </div>
    </Panel>
  )
}

export function ModesView() {
  const [autonomy, setAutonomy] = useState(0)
  const [profile, setProfile] = useState('Bench')
  const [brain, setBrain] = useState('Rules')
  const [active, setActive] = useState<ActiveMode | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enforced, setEnforced] = useState<number | null>(null)  // live autonomy from the rover

  useEffect(() => {
    let alive = true
    activeMode().then(m => {
      if (!alive) return
      if (AUTONOMY_LEVELS.some(l => l.id === m.autonomy_level)) setAutonomy(m.autonomy_level)
      if (PROFILES.some(p => p.id === m.mission_profile)) setProfile(m.mission_profile)
      if (BRAINS.some(b => b.id === m.brain)) setBrain(m.brain)
      if (m.exists) setActive(m)
    }).catch(e => alive && setError(String(e)))
    const pollEnforced = () => telemetryLatest('MARK1-SIM-001')
      .then(t => { const a = t.kinds['autonomy']?.data as Record<string, unknown> | undefined; if (alive && a) setEnforced(Number(a['autonomy_level'])) })
      .catch(() => {})
    pollEnforced()
    const iv = setInterval(pollEnforced, 3000)
    return () => { alive = false; clearInterval(iv) }
  }, [])

  const isActive = !!active && active.autonomy_level === autonomy
    && active.mission_profile === profile && active.brain === brain
  const levelLabel = AUTONOMY_LEVELS.find(l => l.id === autonomy)?.label ?? `L${autonomy}`

  const handleActivate = async () => {
    setSaving(true); setError(null)
    try {
      const res = await saveActiveMode({ autonomy_level: autonomy, mission_profile: profile, brain })
      setActive(res)
      // Also dispatch a SIGNED mode command to the sim rover so it ACTS on it
      // (the rover's command router gates motion by the enforced autonomy level).
      try {
        await dispatchMode({ rover_id: 'MARK1-SIM-001', autonomy_level: autonomy, mission_profile: profile, brain })
      } catch { /* rover offline: config still persisted to the Core Hub */ }
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: '20px 26px' }}>
      <ViewHead
        eyebrow="CONTROL · OPERATING MODE"
        title="Modes"
        sub={<>
          {active
            ? <span className="dk-chip ok">ACTIVE · L{active.autonomy_level} {active.mission_profile} · {active.brain}</span>
            : <span className="dk-chip standby">NO MODE ACTIVATED</span>}
          {' '}<span style={{ color: 'var(--dim)', fontSize: 11 }}>a mode = autonomy level × mission profile × decision brain</span>
        </>}
      />

      <div style={{ display: 'grid', gap: 14, maxWidth: 900, marginTop: 84 }}>
        <Selector
          label="Autonomy level"
          options={AUTONOMY_LEVELS}
          labelFor={(o) => `L${o.id} · ${AUTONOMY_LEVELS.find(l => l.id === o.id)!.label}`}
          value={autonomy}
          onPick={setAutonomy}
        />
        <Selector label="Mission profile" options={PROFILES} value={profile} onPick={setProfile} />
        <Selector label="Decision brain" options={BRAINS} value={brain} onPick={setBrain} />

        <Panel title="Composed mode" meta={<>
          {enforced !== null && <span className="dk-chip ok" style={{ marginRight: 6 }}>ROVER ENFORCING L{enforced}</span>}
          {isActive ? <span className="dk-chip ok">CURRENT</span> : <span className="dk-chip standby">UNSAVED</span>}
        </>}>
          <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ fontFamily: mono, fontSize: 15, color: 'var(--ice)', letterSpacing: '0.04em' }}>
              L{autonomy} · {levelLabel} <span style={{ color: 'var(--dim)' }}>×</span> {profile} <span style={{ color: 'var(--dim)' }}>×</span> {brain}
            </div>
            <button
              className="dk-btn primary"
              disabled={saving || isActive}
              style={{ marginLeft: 'auto' }}
              onClick={handleActivate}
            >
              {saving ? 'ACTIVATING…' : isActive ? 'ACTIVE' : 'ACTIVATE ON CORE HUB'}
            </button>
          </div>
          {error && (
            <div style={{ padding: '0 14px 12px', fontFamily: mono, fontSize: 11, color: 'var(--crit)' }}>
              {error}
            </div>
          )}
          {active?.updated && (
            <div style={{ padding: '0 14px 12px', fontFamily: mono, fontSize: 10, color: 'var(--dim)' }}>
              last activated {new Date(active.updated).toLocaleString()} · persisted to /var/lib/friday on the Core Hub
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
