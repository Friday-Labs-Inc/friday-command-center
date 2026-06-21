<script setup lang="ts">
import { gateway } from '../gateway'
</script>

<template>
  <div class="bg-[#161b22] border border-[#222b36] rounded-lg p-4 overflow-auto min-h-0">
    <h2 class="text-xs uppercase tracking-wide text-[#8b98a5] mb-3">Rover — last known</h2>
    <div class="text-sm tabular-nums divide-y divide-[#222b36]">
      <div class="flex justify-between py-1.5"><span class="text-[#8b98a5]">rover</span><span>{{ gateway.state.rover.rover }}</span></div>
      <div class="flex justify-between py-1.5"><span class="text-[#8b98a5]">pose x (m)</span><span>{{ gateway.state.rover.x.toFixed(3) }}</span></div>
      <div class="flex justify-between py-1.5"><span class="text-[#8b98a5]">pose y (m)</span><span>{{ gateway.state.rover.y.toFixed(3) }}</span></div>
      <div class="flex justify-between py-1.5"><span class="text-[#8b98a5]">θ (rad)</span><span>{{ gateway.state.rover.theta.toFixed(3) }}</span></div>
      <div class="flex justify-between py-1.5"><span class="text-[#8b98a5]">updated</span><span>{{ gateway.state.rover.updated ?? '—' }}</span></div>
    </div>

    <h2 class="text-xs uppercase tracking-wide text-[#8b98a5] mt-5 mb-2">Live feed</h2>
    <div class="space-y-1">
      <div
        v-for="(e, i) in gateway.state.feed.slice(0, 40)" :key="i"
        class="text-xs px-2 py-1 rounded bg-[#0d1117] border-l-2"
        :class="{ 'border-[#58a6ff]': e.kind === 'odom', 'border-[#6fd38a]': e.kind === 'ack', 'border-[#f38b8b]': e.kind === 'fault', 'border-[#30363d]': !['odom','ack','fault'].includes(e.kind) }"
      >
        <span class="text-[#6e7681]">{{ e.ts }}</span>
        <span class="font-semibold uppercase mx-1">{{ e.kind }}</span>
        <span class="text-[#d2a8ff]">{{ e.rover }}</span>
        <span class="text-[#8b98a5]"> {{ e.data ? JSON.stringify(e.data) : e.topic }}</span>
      </div>
    </div>
  </div>
</template>
