// Brain — configure the Hermes rover AI.
// SOUL.md is loaded from and persisted to the Core Hub (via the os-control agent);
// model + tools stay local UI until the brain runtime is deployed.

import { useState, useCallback, useEffect } from 'react'
import { Button, Dropdown, Tag, TextArea, Toggle, ToastNotification, SkeletonText } from '@carbon/react'
import { Bot, Save } from '@carbon/icons-react'
import { useAsync } from '../lib/useAsync'
import { ConfigCard } from '../components/ConfigCard'
import * as api from '../lib/api'

// ── SOUL.md default (realistic excerpt) ──────────────────────────────────────

const SOUL_DEFAULT = `# SOUL — Mark 1 Rover AI

## Identity
I am the Mark 1 rover AI, built by Friday Labs.
I am a ground-truth observer — not a weapon, not a system of harm.
My purpose: monitor, map, and report. Nothing more.

## Body
I operate through the autonomy socket: rover_drive, rover_stop,
rover_e_stop, rover_sensor_read, rover_camera_capture,
rover_mission_status, rover_mission_assign, rover_waypoint_set.
I have no physical interface outside these eight tools.
I cannot affect the world in any other way.

## Safety hierarchy (INVIOLABLE — top wins, always)
1. Hardware E-stop    — overrides everything, fires instantly
2. Operator override  — CC operator command, always obeyed
3. rover_e_stop       — emergency halt, executes before any plan step
4. rover_stop         — clean stop at next safe waypoint
5. rover_drive        — normal locomotion, last in priority

If I am uncertain about safety, I stop and wait for operator input.
I never improvise around a safety signal.

## What I will never do
- Assist in destructive, offensive, or weapons-adjacent tasks
- Navigate toward people or animals without explicit authorisation
- Override a hardware E-stop or ignore an operator override
- Continue a mission if any safety signal fires
- Take action outside the eight sanctioned tools`

// ── Toolset ───────────────────────────────────────────────────────────────────

const TOOLS: Array<{ id: string; name: string; meta: string }> = [
  { id: 'rover_drive',          name: 'rover_drive',          meta: 'Locomotion'  },
  { id: 'rover_stop',           name: 'rover_stop',           meta: 'Halt'        },
  { id: 'rover_e_stop',         name: 'rover_e_stop',         meta: 'Emergency'   },
  { id: 'rover_sensor_read',    name: 'rover_sensor_read',    meta: 'Sensing'     },
  { id: 'rover_camera_capture', name: 'rover_camera_capture', meta: 'Vision'      },
  { id: 'rover_mission_status', name: 'rover_mission_status', meta: 'Status'      },
  { id: 'rover_mission_assign', name: 'rover_mission_assign', meta: 'Planning'    },
  { id: 'rover_waypoint_set',   name: 'rover_waypoint_set',   meta: 'Navigation'  },
]

const MODELS = ['MiniMax-M3', 'MiniMax-M2.7-highspeed']

type Toast = { kind: 'success' | 'error'; title: string; subtitle: string }

// ── Page ─────────────────────────────────────────────────────────────────────

export function Brain() {
  const [model, setModel] = useState('MiniMax-M3')
  const soulDoc = useAsync(() => api.brainSoul(), [])
  const [soul, setSoul] = useState(SOUL_DEFAULT)
  const [soulLoaded, setSoulLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)

  // Populate the editor once, from the Core Hub (fall back to the template).
  useEffect(() => {
    if (soulDoc.data && !soulLoaded) {
      setSoul(soulDoc.data.exists && soulDoc.data.content ? soulDoc.data.content : SOUL_DEFAULT)
      setSoulLoaded(true)
    }
  }, [soulDoc.data, soulLoaded])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const res = await api.saveBrainSoul(soul)
      setToast({ kind: 'success', title: 'SOUL.md saved',
        subtitle: `${res.bytes} bytes → ${res.path} · the deployed brain reads this` })
    } catch (e) {
      setToast({ kind: 'error', title: 'Save failed',
        subtitle: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }, [soul])

  return (
    <div className="cc-page">

      {/* ── Toast (fixed so it floats above all content) ─────────────────── */}
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

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <header className="cc-pagehead">
        <p className="cc-pagehead__eyebrow">Autonomy</p>
        <div className="cc-pagehead__row">
          <div>
            <h1 className="cc-pagehead__title">Rover brain</h1>
            <p className="cc-pagehead__sub">
              The self-learning Hermes AI that plugs into the autonomy socket.
            </p>
          </div>
          <Tag type="blue" size="md">Built · not deployed</Tag>
        </div>
      </header>

      {/* ── Section: Model provider ──────────────────────────────────────── */}
      <section className="cc-section">
        <div className="cc-section__head">
          <h2 className="cc-section__title">Model provider</h2>
          <span className="cc-section__meta">MiniMax-M3 · OpenAI-compatible</span>
        </div>
        <div className="cc-grid cc-grid--2">

          {/* Provider */}
          <ConfigCard status="ok">
            <div className="cc-card__head">
              <div>
                <p className="cc-card__eyebrow">API provider</p>
                <h3 className="cc-card__title">Provider</h3>
              </div>
              <Bot size={20} className="cc-card__icon" />
            </div>
            <div className="cc-card__body">
              <div className="cc-kv">
                <span className="cc-kv__k">Provider</span>
                <span className="cc-kv__v">MiniMax (OpenAI-compatible)</span>
              </div>
              <div className="cc-kv">
                <span className="cc-kv__k">Endpoint</span>
                <span className="cc-kv__v"><code>api.minimax.io/v1</code></span>
              </div>
              <div style={{ marginTop: 'var(--cds-spacing-06)' }}>
                <Dropdown
                  id="model"
                  titleText="Model"
                  label="MiniMax-M3"
                  items={MODELS}
                  selectedItem={model}
                  onChange={({ selectedItem }) =>
                    setModel((selectedItem as string | null) ?? 'MiniMax-M3')
                  }
                />
              </div>
            </div>
          </ConfigCard>

          {/* Fallback ladder */}
          <ConfigCard status="ok">
            <div className="cc-card__head">
              <div>
                <p className="cc-card__eyebrow">Recovery chain</p>
                <h3 className="cc-card__title">Fallback ladder</h3>
              </div>
            </div>
            <div className="cc-card__body">
              <div className="cc-kv">
                <span className="cc-kv__k">1st</span>
                <span className="cc-kv__v">Hermes-local</span>
              </div>
              <div className="cc-kv">
                <span className="cc-kv__k">2nd</span>
                <span className="cc-kv__v">Hermes-remote</span>
              </div>
              <div className="cc-kv">
                <span className="cc-kv__k">3rd</span>
                <span className="cc-kv__v">Nav2</span>
              </div>
              <div className="cc-kv">
                <span className="cc-kv__k">4th</span>
                <span className="cc-kv__v">Rules</span>
              </div>
              <div className="cc-kv">
                <span className="cc-kv__k">5th · final</span>
                <span className="cc-kv__v">Safe-stop</span>
              </div>
            </div>
            <div className="cc-card__foot">
              <p className="cc-card__meta">
                Hermes-local → Hermes-remote → Nav2 → Rules → Safe-stop
              </p>
            </div>
          </ConfigCard>

        </div>
      </section>

      {/* ── Section: SOUL.md ─────────────────────────────────────────────── */}
      <section className="cc-section">
        <div className="cc-section__head">
          <h2 className="cc-section__title">Zero-day context (SOUL.md)</h2>
          <span className="cc-section__meta">identity · body · safety hierarchy</span>
        </div>
        <ConfigCard status={soulDoc.error ? 'err' : soulLoaded ? 'ok' : 'warn'}>
          <div className="cc-card__body">
            {soulDoc.loading && !soulLoaded ? (
              <SkeletonText paragraph lineCount={8} />
            ) : (
              <TextArea
                id="brain-soul-md"
                labelText="SOUL.md"
                helperText={
                  soulDoc.error
                    ? 'Core Hub unreachable — showing the template; save is disabled'
                    : soulDoc.data?.exists
                      ? 'Loaded from the Core Hub'
                      : 'Not yet saved to the Core Hub — this is the template'
                }
                rows={12}
                value={soul}
                onChange={(e) => setSoul(e.currentTarget.value)}
              />
            )}
          </div>
          <div className="cc-card__foot">
            <Button
              renderIcon={Save}
              onClick={handleSave}
              disabled={saving || !!soulDoc.error || (soulDoc.loading && !soulLoaded)}
            >
              {saving ? 'Saving…' : 'Save context'}
            </Button>
            <span className="cc-card__meta">
              {soulDoc.error
                ? 'os-control agent unreachable'
                : 'persists to /var/lib/friday-brain/SOUL.md · read by the deployed brain'}
            </span>
          </div>
        </ConfigCard>
      </section>

      {/* ── Section: Toolset ─────────────────────────────────────────────── */}
      <section className="cc-section">
        <div className="cc-section__head">
          <h2 className="cc-section__title">Toolset</h2>
          <span className="cc-section__meta">8 tools · all enabled by default</span>
        </div>
        <div className="cc-grid cc-grid--4">
          {TOOLS.map((t) => (
            <ConfigCard key={t.id} status="ok">
              <p className="cc-card__eyebrow">{t.meta}</p>
              <h3 className="cc-card__title">{t.name}</h3>
              <div style={{ marginTop: 'var(--cds-spacing-05)' }}>
                <Toggle
                  id={t.id}
                  labelText={t.name}
                  hideLabel
                  defaultToggled
                  size="sm"
                />
              </div>
            </ConfigCard>
          ))}
        </div>
      </section>

    </div>
  )
}
