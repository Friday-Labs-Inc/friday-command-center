import { createRoot } from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import './styles.scss'
import { App } from './App'

createRoot(document.getElementById('app')!).render(<App />)
