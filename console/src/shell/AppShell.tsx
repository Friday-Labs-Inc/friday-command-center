// AppShell — Carbon UI Shell root for the Friday Labs OS control panel.
// Fixed Header (live-link tag) + fixed SideNav (config-panel IA) + main content.

import { useEffect } from 'react'
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import {
  Header, HeaderMenuButton, HeaderName, HeaderGlobalBar,
  SideNav, SideNavItems, SideNavLink, Tag,
} from '@carbon/react'
import {
  Dashboard, GatewayApi, Devices, Roadmap, Bot,
  Map, UserMultiple, Settings as SettingsIcon, Model,
} from '@carbon/icons-react'

import { useLiveStore, initStore } from '../lib/store'
import { Overview } from '../pages/Overview'
import { RoverDetail } from '../pages/RoverDetail'
import { Missions } from '../pages/Missions'
import { Operators } from '../pages/Operators'
import { Certificates } from '../pages/Certificates'
import { SecurityAudit } from '../pages/SecurityAudit'
import { CommandConsole } from '../pages/CommandConsole'
import { Settings } from '../pages/Settings'
import { System } from '../pages/System'
import { Modules } from '../pages/Modules'
import { Modes } from '../pages/Modes'
import { Brain } from '../pages/Brain'
import { Blueprint } from '../pages/Blueprint'

type NavIcon = React.FC<{ size?: number }>

const NAV_ITEMS: Array<{ to: string; label: string; Icon: NavIcon }> = [
  { to: '/',         label: 'Overview',  Icon: Dashboard as NavIcon },
  { to: '/blueprint',label: 'Blueprint', Icon: Model as NavIcon },
  { to: '/system',   label: 'System',    Icon: GatewayApi as NavIcon },
  { to: '/modules',  label: 'Modules',   Icon: Devices as NavIcon },
  { to: '/modes',    label: 'Modes',     Icon: Roadmap as NavIcon },
  { to: '/brain',    label: 'Brain',     Icon: Bot as NavIcon },
  { to: '/missions', label: 'Missions',  Icon: Map as NavIcon },
  { to: '/access',   label: 'Access',    Icon: UserMultiple as NavIcon },
  { to: '/settings', label: 'Settings',  Icon: SettingsIcon as NavIcon },
]


export function AppShell() {
  const { connected } = useLiveStore()
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => { initStore() }, [])

  return (
    <>
      <Header aria-label="Friday Labs OS control panel">
        <HeaderMenuButton aria-label="Open menu" isActive={false} onClick={() => {}} />
        <HeaderName prefix="Friday Labs">OS Control Panel</HeaderName>
        <HeaderGlobalBar>
          <div className="cc-header-status">
            <Tag type={connected ? 'green' : 'gray'} size="sm">{connected ? 'live' : 'connecting'}</Tag>
          </div>
        </HeaderGlobalBar>
      </Header>

      <SideNav aria-label="Side navigation" isFixedNav isPersistent expanded>
        <SideNavItems>
          {NAV_ITEMS.map(({ to, label, Icon }) => {
            const isActive = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
            return (
              <SideNavLink
                key={to}
                renderIcon={Icon}
                href={to}
                isActive={isActive}
                onClick={(e: React.MouseEvent) => { e.preventDefault(); navigate(to) }}
              >
                {label}
              </SideNavLink>
            )
          })}
        </SideNavItems>
      </SideNav>

      <main className="cc-shell-main">
        <Routes>
          <Route path="/"             element={<Overview />} />
          <Route path="/blueprint"    element={<Blueprint />} />
          <Route path="/system"       element={<System />} />
          <Route path="/modules"      element={<Modules />} />
          <Route path="/modes"        element={<Modes />} />
          <Route path="/brain"        element={<Brain />} />
          <Route path="/missions"     element={<Missions />} />
          <Route path="/access"       element={<Operators />} />
          <Route path="/operators"    element={<Operators />} />
          <Route path="/certificates" element={<Certificates />} />
          <Route path="/security"     element={<SecurityAudit />} />
          <Route path="/command"      element={<CommandConsole />} />
          <Route path="/settings"     element={<Settings />} />
          <Route path="/rovers/:id"   element={<RoverDetail />} />
        </Routes>
      </main>
    </>
  )
}
