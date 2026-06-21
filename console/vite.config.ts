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
      '/api': 'http://127.0.0.1:8090',
      '/ws': { target: 'ws://127.0.0.1:8090', ws: true },
    },
  },
})
