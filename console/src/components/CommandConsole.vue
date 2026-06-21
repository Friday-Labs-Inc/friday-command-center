<script setup lang="ts">
import { ref } from 'vue'
import { gateway } from '../gateway'
import { importEd25519Private, signHex } from '../signer'

const operator = ref('OP-001')
const rover = ref('MARK1-001')
const v = ref('0.5')
const w = ref('0.0')
const priv = ref('')
const out = ref('')
const ok = ref(false)
const busy = ref(false)

async function send() {
  busy.value = true
  out.value = ''
  try {
    if (!crypto?.subtle) throw new Error('Web Crypto unavailable (use a modern browser on https/localhost)')
    if (priv.value.trim().length !== 64) throw new Error('private key must be 64 hex chars')
    const n = await gateway.issueNonce(rover.value, operator.value)
    const envelope = {
      protocol_version: { major: 0, minor: 1, patch: 0 },
      rover_id: rover.value, sender_id: operator.value, msg_id: n.nonce, nonce: n.nonce,
      issued_at: n.issued_at, expires_at: n.expires_at,
      payload: { class: 'motion', type: 1, linear_velocity: parseFloat(v.value), angular_velocity: parseFloat(w.value) },
    }
    const sb = await gateway.signBytes(envelope)
    const key = await importEd25519Private(priv.value.trim())
    const sig = await signHex(key, sb.signing_hex)
    const res = await gateway.sendCommand(envelope, sig)
    ok.value = true
    out.value = `✓ signed in-browser & dispatched — nonce ${res.nonce}`
  } catch (e: any) {
    ok.value = false
    out.value = `✗ ${e.message}`
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="bg-[#161b22] border border-[#222b36] rounded-lg p-4 overflow-auto min-h-0">
    <h2 class="text-xs uppercase tracking-wide text-[#8b98a5] mb-3">Command console — client-side signed</h2>
    <div class="grid grid-cols-2 gap-2">
      <label class="text-xs text-[#8b98a5]">Operator
        <input v-model="operator" class="mt-1 w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 text-sm" /></label>
      <label class="text-xs text-[#8b98a5]">Rover
        <input v-model="rover" class="mt-1 w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 text-sm" /></label>
      <label class="text-xs text-[#8b98a5]">Linear (m/s)
        <input v-model="v" class="mt-1 w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 text-sm" /></label>
      <label class="text-xs text-[#8b98a5]">Angular (rad/s)
        <input v-model="w" class="mt-1 w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 text-sm" /></label>
    </div>
    <label class="block text-xs text-[#8b98a5] mt-2">Ed25519 private key (hex)
      <input v-model="priv" placeholder="64 hex chars" class="mt-1 w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 text-sm" /></label>
    <p class="text-[11px] text-[#d29922] mt-1.5">⚠ Dev only: pasted here. In production the key lives in a hardware token / OS keystore. It is used only in your browser and never sent to the server.</p>
    <button :disabled="busy" @click="send"
      class="mt-3 w-full rounded py-2 text-sm font-semibold text-white disabled:bg-[#30363d] bg-[#238636]">
      {{ busy ? 'signing…' : 'Sign & send command' }}</button>
    <p v-if="out" class="text-xs mt-2" :class="ok ? 'text-[#6fd38a]' : 'text-[#f38b8b]'">{{ out }}</p>
  </div>
</template>
