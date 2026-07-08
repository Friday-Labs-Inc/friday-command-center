// Renders an OSM raster basemap with a live rover marker.
// Odom telemetry (local metres, x=east y=north) is anchored to a base
// lng/lat so the marker moves on the real map as odometry arrives.

import { useRef, useEffect } from 'react'
import { Map as MlMap, Marker } from 'maplibre-gl'
import { Tile } from '@carbon/react'
import { useGateway } from '../gateway'

const BASE_LNG = 77.5946
const BASE_LAT = 12.9716

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const osmStyle: any = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
}

function toLngLat(x: number, y: number): [number, number] {
  const lat = BASE_LAT + y / 111320
  const lng = BASE_LNG + x / (111320 * Math.cos((BASE_LAT * Math.PI) / 180))
  return [lng, lat]
}

export function MapPanel() {
  const mapEl = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const markerRef = useRef<Marker | null>(null)
  const { rover } = useGateway()

  // Initialise map once on mount; tear down on unmount.
  useEffect(() => {
    if (!mapEl.current) return
    const m = new MlMap({
      container: mapEl.current,
      style: osmStyle,
      center: [BASE_LNG, BASE_LAT],
      zoom: 15,
    })
    const mk = new Marker({ color: '#0f62fe' })
      .setLngLat([BASE_LNG, BASE_LAT])
      .addTo(m)
    mapRef.current = m
    markerRef.current = mk
    return () => { m.remove() }
  }, [])

  // Move the marker whenever the rover's odometry position changes.
  useEffect(() => {
    const ll = toLngLat(rover.x, rover.y)
    markerRef.current?.setLngLat(ll)
    mapRef.current?.easeTo({ center: ll, duration: 600 })
  }, [rover.x, rover.y])

  return (
    <Tile className="cc-panel-map">
      <h2
        className="cc-panel-heading"
        style={{ padding: 'var(--cds-spacing-05) var(--cds-spacing-05) 0' }}
      >
        Fleet map
      </h2>
      <div
        ref={mapEl}
        style={{
          flex: 1,
          overflow: 'hidden',
          margin: 'var(--cds-spacing-03)',
          position: 'relative',
        }}
      />
    </Tile>
  )
}
