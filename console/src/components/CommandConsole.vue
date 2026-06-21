<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { gateway } from '../gateway'
import { agent } from '../agent'

const operator = ref('OP-001')
const rover = ref('MARK1-001')
const v = ref('0.5')
const w = ref('0.0')
const enrollKey = ref('')
const enrolled = ref(false)
const agentUp = ref(false)
const out = ref('')
const ok = ref(false)
const busy = ref(false)

async function refreshStatus() {
  try {
    const s = await agent.status(operator.value)
    agentUp.value = true
    enrolled.value = !!s.enrolled
  } catch {
    agentUp.value = false
    enrolled.value = false
  }
}
onMounted(refreshStatus)
watch(operator, refreshStatus)

async function enroll() {
  busy.value = true
  out.value = ''
  try {
    if (enrollKey.value.trim().length !== 64) throw new Error('private key must be 64 hex chars')
    const r = await agent.enroll(operator.value, enrollKey.value.trim())
    enrollKey.value = '' // never keep the key in the page
    enrolled.value = true
    ok.value = true
    out.value = `✓ enrolled in OS keychain — pubkey ${r.public_key.slice(0, 16)}… (register it in the allowlist)`
  } catch (e: any) {
    ok.value = false
    out.value = `✗ ${e.message}`
  } finally {
    busy.value = false
  }
}

async function send() {
  busy.value = true
  out.value = ''
  try {
    const n = await gateway.issueNonce(rover.value, operator.value)
    const envelope = {
      protocol_version: { major: 0, minor: 1, patch: 0 },
      rover_id: rover.value, sender_id: operator.value, msg_id: n.nonce, nonce: n.nonce,
      issued_at: n.issued_at, expires_at: n.expires_at,
      payload: { class: 'motion', type: 1, linear_velocity: parseFloat(v.value), angular_velocity: parseFloat(w.value) },
    }
    const sb = await gateway.signBytes(envelope)
    const sig = await agent.sign(operator.value, sb.signing_hex) // key stays in the agent/keychain
    const res = await gateway.sendCommand(envelope, sig)
    ok.value = true
    out.value = `✓ signed by the agent (key never left the keychain) & dispatched — nonce ${res.nonce}`
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
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-xs uppercase tracking-wide text-[#8b98a5]">Command console</h2>
      <span class="text-[11px] px-2 py-0.5 rounded-full"
            :class="!agentUp ? 'bg-[#341a1a] text-[#f38b8b]' : enrolled ? 'bg-[#16301c] text-[#6fd38a]' : 'bg-[#33280f] text-[#d29922]'">
        {{ !agentUp ? 'agent offline' : enrolled ? 'key in keychain' : 'not enrolled' }}
      </span>
    </div>

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

    <button :disabled="busy || !agentUp || !enrolled" @click="send"
      class="mt-3 w-full rounded py-2 text-sm font-semibold text-white disabled:bg-[#30363d] bg-[#238636]">
      {{ busy ? 'signing…' : 'Sign & send (via keychain agent)' }}</button>

    <details class="mt-3">
      <summary class="text-xs text-[#8b98a5] cursor-pointer">Enroll a key into the keychain (one-time)</summary>
      <div class="mt-2">
        <input v-model="enrollKey" placeholder="Ed25519 private key (64 hex)" class="w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 text-sm" />
        <p class="text-[11px] text-[#d29922] mt-1">Stored in the OS keychain by the local agent and cleared from this page. It is never sent to the Command Center server.</p>
        <button :disabled="busy || !agentUp" @click="enroll"
          class="mt-2 w-full rounded py-1.5 text-xs font-semibold disabled:bg-[#30363d] bg-[#1f6feb] text-white">Enroll in keychain</button>
      </div>
    </details>

    <p v-if="out" class="text-xs mt-2 break-words" :class="ok ? 'text-[#6fd38a]' : 'text-[#f38b8b]'">{{ out }}</p>
  </div>
</template>
