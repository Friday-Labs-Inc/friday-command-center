import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Theme } from '@carbon/react'
import 'maplibre-gl/dist/maplibre-gl.css'
import './styles.scss'
import { AppShell } from './shell/AppShell'
import { DeckApp } from './deck/DeckLayout'

// The Command Deck (/deck) is the flagship interface; the Carbon console
// remains the config plane at its existing routes ("classic").
createRoot(document.getElementById('app')!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Navigate to="/deck" replace />} />
      <Route path="/deck/*" element={<DeckApp />} />
      <Route
        path="/*"
        element={
          <Theme theme="g100">
            <AppShell />
          </Theme>
        }
      />
    </Routes>
  </BrowserRouter>,
)
