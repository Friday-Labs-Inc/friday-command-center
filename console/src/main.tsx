import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Theme } from '@carbon/react'
import 'maplibre-gl/dist/maplibre-gl.css'
import './styles.scss'
import { AppShell } from './shell/AppShell'

createRoot(document.getElementById('app')!).render(
  <BrowserRouter>
    <Theme theme="g100">
      <AppShell />
    </Theme>
  </BrowserRouter>,
)
