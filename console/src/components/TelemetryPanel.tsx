import { Tag, Tile } from '@carbon/react'
import { useGateway, type FeedEvent, type RoverState } from '../gateway'

type TagType = 'blue' | 'green' | 'red' | 'gray'

function kindTagType(kind: string): TagType {
  if (kind === 'odom') return 'blue'
  if (kind === 'ack') return 'green'
  if (kind === 'fault') return 'red'
  return 'gray'
}

const TELEMETRY_ROWS: Array<[string, (r: RoverState) => string]> = [
  ['rover', r => r.rover],
  ['pose x (m)', r => r.x.toFixed(3)],
  ['pose y (m)', r => r.y.toFixed(3)],
  ['θ (rad)', r => r.theta.toFixed(3)],
  ['updated', r => r.updated ?? '—'],
]

function FeedRow({ e, index }: { e: FeedEvent; index: number }) {
  return (
    <div className="cc-feed-row">
      <span className="cc-muted">{e.ts}</span>
      <Tag type={kindTagType(e.kind)} size="sm">{e.kind}</Tag>
      <span>{e.rover}</span>
      <span className="cc-feed-data">
        {e.data ? JSON.stringify(e.data) : e.topic}
      </span>
    </div>
  )
}

export function TelemetryPanel() {
  const { rover, feed } = useGateway()

  return (
    <Tile className="cc-panel">
      <h2 className="cc-panel-heading">Rover — last known</h2>

      <div style={{ fontVariantNumeric: 'tabular-nums' }}>
        {TELEMETRY_ROWS.map(([label, fn]) => (
          <div key={label} className="cc-telemetry-row">
            <span className="cc-telemetry-label">{label}</span>
            <span>{fn(rover)}</span>
          </div>
        ))}
      </div>

      <h2 className="cc-panel-heading cc-subheading">Live feed</h2>

      <div>
        {feed.slice(0, 40).map((e, i) => (
          <FeedRow key={i} e={e} index={i} />
        ))}
      </div>
    </Tile>
  )
}
