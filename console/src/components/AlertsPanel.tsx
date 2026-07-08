import { Button, Tag, Tile } from '@carbon/react'
import { useGateway, gateway, type FeedEvent, type SecurityEvent } from '../gateway'

type TagType = 'red' | 'magenta' | 'cyan' | 'blue' | 'gray'

function sevTagType(sev: string): TagType {
  if (sev === 'Critical') return 'red'
  if (sev === 'Error') return 'magenta'
  if (sev === 'Warning') return 'cyan'
  if (sev === 'Info') return 'blue'
  return 'gray'
}

function LiveAlertRow({ a }: { a: FeedEvent }) {
  return (
    <div className="cc-alert-row">
      <span className="cc-muted">{a.ts}</span>
      <strong>{a.data?.category ?? 'FAULT'}</strong>
      <span>{a.rover}</span>
      <span className="cc-feed-data">{a.data?.description ?? ''}</span>
    </div>
  )
}

function SecurityRow({ ev }: { ev: SecurityEvent }) {
  return (
    <div key={ev.name} className="cc-security-row">
      <strong>{ev.category}</strong>
      <Tag type={sevTagType(ev.severity)} size="sm">{ev.severity}</Tag>
      <span>{ev.rover}</span>
      <span className="cc-feed-data">{ev.description ?? ''}</span>
      <span className="cc-security-time">{ev.event_time}</span>
    </div>
  )
}

export function AlertsPanel() {
  const { liveAlerts, securityEvents } = useGateway()

  return (
    <Tile className="cc-panel">
      <div className="cc-alerts-header">
        <h2 className="cc-panel-heading" style={{ margin: 0 }}>Security &amp; alerts</h2>
        <Button
          kind="ghost"
          size="sm"
          onClick={() => { gateway.refreshSecurityEvents() }}
        >
          refresh
        </Button>
      </div>

      {liveAlerts.length > 0 && (
        <div style={{ marginBottom: 'var(--cds-spacing-05)' }}>
          <p className="cc-subheading" style={{ marginTop: 0 }}>live (this session)</p>
          {liveAlerts.slice(0, 10).map((a, i) => (
            <LiveAlertRow key={`l${i}`} a={a} />
          ))}
        </div>
      )}

      <p className="cc-subheading" style={{ marginTop: liveAlerts.length > 0 ? undefined : 0 }}>
        recorded Security Events
      </p>
      {securityEvents.length === 0 ? (
        <p className="cc-muted" style={{ fontSize: '0.75rem', margin: 0 }}>none</p>
      ) : (
        securityEvents.map(ev => <SecurityRow key={ev.name} ev={ev} />)
      )}
    </Tile>
  )
}
