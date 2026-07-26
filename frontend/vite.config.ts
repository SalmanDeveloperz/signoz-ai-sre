import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Defaults target localhost ports for `npm run dev` on the host. Inside
// docker-compose, these are overridden to the service names (control-plane,
// worker-service, watcher-service) since "localhost" inside a container
// refers to the container itself, not its sibling services. See
// docker-compose.yml's frontend service and SETUP.md.
const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL || 'http://localhost:4001'
const WORKER_URL = process.env.WORKER_URL || 'http://localhost:4000'
const WATCHER_URL = process.env.WATCHER_URL || 'http://localhost:4002'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      // Same-origin from the browser's perspective, so no CORS setup is
      // needed on any of the 3 backend services. See README Section 2.
      '/api/control-plane': {
        target: CONTROL_PLANE_URL,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/control-plane/, ''),
      },
      '/api/worker': {
        target: WORKER_URL,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/worker/, ''),
      },
      '/api/watcher': {
        target: WATCHER_URL,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/watcher/, ''),
      },
    },
  },
})
