<script setup lang="ts">
import { gateway } from '../gateway'

function sevClass(sev: string) {
  return {
    Critical: 'border-[#f85149] text-[#ff7b72]',
    Error: 'border-[#f38b8b] text-[#f38b8b]',
    Warning: 'border-[#d29922] text-[#d29922]',
    Info: 'border-[#58a6ff] text-[#58a6ff]',
  }[sev] || 'border-[#30363d]'
}
</script>

<template>
  <div class="bg-[#161b22] border border-[#222b36] rounded-lg p-4 overflow-auto min-h-0">
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-xs uppercase tracking-wide text-[#8b98a5]">Security &amp; alerts</h2>
      <button class="text-xs text-[#58a6ff]" @click="gateway.refreshSecurityEvents()">refresh</button>
    </div>

    <div v-if="gateway.state.liveAlerts.length" class="mb-3">
      <div class="text-[11px] text-[#8b98a5] mb-1">live (this session)</div>
      <div v-for="(a, i) in gateway.state.liveAlerts.slice(0, 10)" :key="'l' + i"
           class="text-xs px-2 py-1 rounded bg-[#0d1117] border-l-2 border-[#f38b8b] mb-1">
        <span class="text-[#6e7681]">{{ a.ts }}</span>
        <span class="font-semibold mx-1">{{ a.data?.category || 'FAULT' }}</span>
        <span class="text-[#d2a8ff]">{{ a.rover }}</span>
        <span class="text-[#8b98a5]"> {{ a.data?.description || '' }}</span>
      </div>
    </div>

    <div class="text-[11px] text-[#8b98a5] mb-1">recorded Security Events</div>
    <div v-if="!gateway.state.securityEvents.length" class="text-xs text-[#6e7681]">none</div>
    <div v-for="ev in gateway.state.securityEvents" :key="ev.name"
         class="text-xs px-2 py-1 rounded bg-[#0d1117] border-l-2 mb-1" :class="sevClass(ev.severity)">
      <span class="font-semibold">{{ ev.category }}</span>
      <span class="ml-1 opacity-70">{{ ev.severity }}</span>
      <span class="text-[#d2a8ff] ml-1">{{ ev.rover }}</span>
      <span class="text-[#8b98a5]"> {{ ev.description || '' }}</span>
      <span class="text-[#6e7681] float-right">{{ ev.event_time }}</span>
    </div>
  </div>
</template>
