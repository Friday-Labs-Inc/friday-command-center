<script setup lang="ts">
import { onMounted } from 'vue'
import { gateway } from './gateway'
import MapPanel from './components/MapPanel.vue'
import TelemetryPanel from './components/TelemetryPanel.vue'
import CommandConsole from './components/CommandConsole.vue'
import AlertsPanel from './components/AlertsPanel.vue'

onMounted(() => {
  gateway.connect()
  gateway.refreshSecurityEvents().catch(() => {})
})
</script>

<template>
  <div class="h-full flex flex-col">
    <header class="flex items-center gap-3 px-5 py-3 border-b border-[#222b36]">
      <h1 class="text-base font-semibold">🛰️ Friday Command Center</h1>
      <span
        class="text-xs px-2 py-0.5 rounded-full"
        :class="gateway.state.connected ? 'bg-[#16301c] text-[#6fd38a]' : 'bg-[#341a1a] text-[#f38b8b]'"
      >{{ gateway.state.connected ? 'live' : 'connecting…' }}</span>
    </header>
    <main class="flex-1 grid grid-cols-2 grid-rows-2 gap-4 p-4 min-h-0">
      <MapPanel />
      <TelemetryPanel />
      <CommandConsole />
      <AlertsPanel />
    </main>
  </div>
</template>
