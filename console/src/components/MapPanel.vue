<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { Map as MlMap, Marker } from 'maplibre-gl'
import { gateway } from '../gateway'

// Odom (local metres, x=east y=north) is anchored onto a base lng/lat for the demo,
// so the rover marker moves on a real basemap as telemetry arrives.
const BASE_LNG = 77.5946
const BASE_LAT = 12.9716
const mapEl = ref<HTMLElement | null>(null)
let map: MlMap | null = null
let marker: Marker | null = null

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

onMounted(() => {
  map = new MlMap({ container: mapEl.value!, style: osmStyle, center: [BASE_LNG, BASE_LAT], zoom: 15 })
  marker = new Marker({ color: '#58a6ff' }).setLngLat([BASE_LNG, BASE_LAT]).addTo(map)
})

onBeforeUnmount(() => map?.remove())

watch(
  () => [gateway.state.rover.x, gateway.state.rover.y],
  ([x, y]) => {
    const ll = toLngLat(x, y)
    marker?.setLngLat(ll)
    map?.easeTo({ center: ll, duration: 600 })
  },
)
</script>

<template>
  <div class="bg-[#161b22] border border-[#222b36] rounded-lg overflow-hidden flex flex-col min-h-0">
    <h2 class="text-xs uppercase tracking-wide text-[#8b98a5] px-4 pt-3">Fleet map</h2>
    <div ref="mapEl" class="flex-1 m-3 rounded-md overflow-hidden"></div>
  </div>
</template>
