// AppShell — Carbon UI Shell root.
// Provides: fixed Header (live status tag) + fixed SideNav (always-expanded on
// desktop) + main content area with correct header/sidenav offsets.
// Routes are defined here; page components are imported from src/pages/*.

import { useEffect } from 'react'
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import {
  Header,
  HeaderMenuButton,
  HeaderName,
  HeaderGlobalBar,
  SideNav,
  SideNavItems,
  SideNavLink,
  Tag,
} from '@carbon/react'
import {
  Dashboard,
  Van,
  Map,
  UserMultiple,
  Certificate,
  SecurityServices,
  Terminal,
  Settings as SettingsIcon,
} from '@carbon/icons-react'

import { useLiveStore, initStore } from '../lib/store'
import { FleetDashboard } from '../pages/FleetDashboard'
import { RoverDetail } from '../pages/RoverDetail'
import { Missions } from '../pages/Missions'
import { Operators } from '../pages/Operators'
import { Certificates } from '../pages/Certificates'
import { SecurityAudit } from '../pages/SecurityAudit'
import { CommandConsole } from '../pages/CommandConsole'
import { Settings } from '../pages/Settings'

// ── Nav items ─────────────────────────────────────────────────────────────────

type NavIcon = React.FC<{ size?: number }>

interface NavItem {
  to: string
  label: string
  Icon: NavIcon
}

const NAV_ITEMS: NavItem[] = [
  { to: '/',            label: 'Fleet',            Icon: Van as NavIcon },
  { to: '/missions',    label: 'Missions',          Icon: Map as NavIcon },
  { to: '/operators',   label: 'Operators',         Icon: UserMultiple as NavIcon },
  { to: '/certificates',label: 'Certificates',      Icon: Certificate as NavIcon },
  { to: '/security',    label: 'Security & audit',  Icon: SecurityServices as NavIcon },
  { to: '/command',     label: 'Command console',   Icon: Terminal as NavIcon },
  { to: '/settings',    label: 'Settings',          Icon: SettingsIcon as NavIcon },
]

// ── Shell ─────────────────────────────────────────────────────────────────────

export function AppShell() {
  const { connected } = useLiveStore()
  const location = useLocation()
  const navigate = useNavigate()

  // Initialise the WebSocket store once on mount (idempotent).
  useEffect(() => {
    initStore()
  }, [])

  return (
    <>
      {/* ── Header (fixed, 3 rem / 48 px) ─────────────────────────────────── */}
      <Header aria-label="Friday Command Center">
        {/*
          HeaderMenuButton is visible on small screens (Carbon hides it on lg
          via the cds--header__menu-toggle--is-active / media query logic).
        */}
        <HeaderMenuButton
          aria-label="Open menu"
          isActive={false}
          onClick={() => {/* mobile toggle — SideNav is isPersistent on desktop */}}
        />
        <HeaderName prefix="Friday">Command Center</HeaderName>
        <HeaderGlobalBar>
          <div className="cc-header-status">
            <Tag
              type={connected ? 'green' : 'gray'}
              size="sm"
            >
              {connected ? 'live' : 'connecting'}
            </Tag>
          </div>
        </HeaderGlobalBar>
      </Header>

      {/* ── SideNav (fixed, always-expanded, 16 rem wide) ─────────────────── */}
      <SideNav
        aria-label="Side navigation"
        isFixedNav
        isPersistent
        expanded
      >
        <SideNavItems>
          {NAV_ITEMS.map(({ to, label, Icon }) => {
            // Exact match for root; prefix match for all others.
            const isActive =
              to === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(to)

            return (
              <SideNavLink
                key={to}
                renderIcon={Icon}
                href={to}
                isActive={isActive}
                onClick={(e: React.MouseEvent) => {
                  e.preventDefault()
                  navigate(to)
                }}
              >
                {label}
              </SideNavLink>
            )
          })}
        </SideNavItems>
      </SideNav>

      {/* ── Main content area (offset for header + sidenav) ───────────────── */}
      <main className="cc-shell-main">
        <Routes>
          <Route path="/"              element={<FleetDashboard />} />
          <Route path="/rovers/:id"    element={<RoverDetail />} />
          <Route path="/missions"      element={<Missions />} />
          <Route path="/operators"     element={<Operators />} />
          <Route path="/certificates"  element={<Certificates />} />
          <Route path="/security"      element={<SecurityAudit />} />
          <Route path="/command"       element={<CommandConsole />} />
          <Route path="/settings"      element={<Settings />} />
        </Routes>
      </main>
    </>
  )
}
