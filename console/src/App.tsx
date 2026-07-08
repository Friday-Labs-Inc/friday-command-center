import { useEffect } from 'react'
import { Header, HeaderName, Tag } from '@carbon/react'
import { useGateway, gateway } from './gateway'
import { MapPanel } from './components/MapPanel'
import { TelemetryPanel } from './components/TelemetryPanel'
import { CommandConsole } from './components/CommandConsole'
import { AlertsPanel } from './components/AlertsPanel'

export function App() {
  const { connected } = useGateway()

  useEffect(() => {
    gateway.connect()
    gateway.refreshSecurityEvents().catch(() => {})
  }, [])

  return (
    <>
      <Header aria-label="Friday Command Center">
        <HeaderName prefix="Friday">Command Center</HeaderName>
        <div style={{ flex: 1 }} />
        <div className="cc-header-status">
          <Tag type={connected ? 'green' : 'red'}>
            {connected ? 'live' : 'connecting…'}
          </Tag>
        </div>
      </Header>
      <div className="cc-content-offset">
        <div className="cc-grid">
          <MapPanel />
          <TelemetryPanel />
          <CommandConsole />
          <AlertsPanel />
        </div>
      </div>
    </>
  )
}
