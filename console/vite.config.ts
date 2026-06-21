import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// Dev: Vite serves the SPA at :5173 and proxies the gateway's REST + WebSocket
// (running on :8090) so the browser only ever talks to one origin.
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // CQRS: writes go to the command dispatcher (:8091), reads + WS to the gateway (:8090).
      '/api/nonce': 'http://127.0.0.1:8091',
      '/api/sign-bytes': 'http://127.0.0.1:8091',
      '/api/command': 'http://127.0.0.1:8091',
      '/api': 'http://127.0.0.1:8090',
      '/ws': { target: 'ws://127.0.0.1:8090', ws: true },
    },
  },
})
