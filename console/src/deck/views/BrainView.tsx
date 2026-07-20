// Brain — the rover AI's SOUL.md (zero-day context / operating charter) as
// stored on the Core Hub. Deck-native editor: load, edit, save through the
// os-control agent (single fixed path, 64 KB cap enforced server-side).

import { useEffect, useState } from 'react'
import { ViewHead, Panel } from '../bits'
import { brainSoul, saveBrainSoul, type SoulDoc } from '../../lib/api'

const mono = 'var(--mono)'
const MAX_BYTES = 65536

export function BrainView() {
  const [doc, setDoc] = useState<SoulDoc | null>(null)
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    brainSoul().then(d => {
      if (!alive) return
      setDoc(d)
      setContent(d.content ?? '')
    }).catch(e => alive && setError(String(e)))
    return () => { alive = false }
  }, [])

  const bytes = new TextEncoder().encode(content).length
  const dirty = doc !== null && content !== (doc.content ?? '')
  const overCap = bytes > MAX_BYTES

  const handleSave = async () => {
    setSaving(true); setError(null)
    try {
      const res = await saveBrainSoul(content)
      setDoc(d => d ? { ...d, content, bytes: res.bytes } : d)
      setSavedAt(new Date().toLocaleTimeString())
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: '20px 26px' }}>
      <ViewHead
        eyebrow="CONTROL · ROVER BRAIN"
        title="Brain"
        sub={<>
          {doc?.exists
            ? <span className="dk-chip ok">SOUL.md LOADED</span>
            : <span className="dk-chip standby">NO SOUL.md YET</span>}
          {' '}<span style={{ color: 'var(--dim)', fontSize: 11 }}>
            the AI's charter — read at every boot as its zero-day context
          </span>
        </>}
      />

      <div style={{ maxWidth: 900, marginTop: 84 }}>
        <Panel
          title="SOUL.md"
          meta={<span style={{ fontFamily: mono, fontSize: 10, color: overCap ? 'var(--crit)' : 'var(--dim)' }}>
            {bytes.toLocaleString()} / {MAX_BYTES.toLocaleString()} bytes
          </span>}
        >
          <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              spellCheck={false}
              style={{
                width: '100%', minHeight: 340, resize: 'vertical',
                fontFamily: mono, fontSize: 12.5, lineHeight: 1.6,
                color: 'var(--ice)', background: 'rgba(11,18,32,0.6)',
                border: '1px solid var(--line-bright)', borderRadius: 3,
                padding: '12px 14px', outline: 'none',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: mono, fontSize: 10, color: 'var(--dim)' }}>
                {doc?.path ?? '/var/lib/friday-brain/SOUL.md'} · Core Hub
              </span>
              {dirty && !overCap && <span className="dk-chip standby">UNSAVED CHANGES</span>}
              {overCap && <span className="dk-chip crit">EXCEEDS 64 KB CAP</span>}
              {savedAt && !dirty && <span className="dk-chip ok">SAVED {savedAt}</span>}
              <button
                className="dk-btn primary"
                disabled={saving || !dirty || overCap}
                style={{ marginLeft: 'auto' }}
                onClick={handleSave}
              >
                {saving ? 'SAVING…' : 'SAVE TO CORE HUB'}
              </button>
            </div>
            {error && (
              <div style={{ fontFamily: mono, fontSize: 11, color: 'var(--crit)' }}>{error}</div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  )
}
