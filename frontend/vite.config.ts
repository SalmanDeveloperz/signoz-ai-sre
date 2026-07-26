import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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
    proxy: {
      // Same-origin from the browser's perspective, so no CORS setup is
      // needed on any of the 3 backend services. See README Section 2.
      '/api/control-plane': {
        target: 'http://localhost:4001',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/control-plane/, ''),
      },
      '/api/worker': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/worker/, ''),
      },
      '/api/watcher': {
        target: 'http://localhost:4002',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/watcher/, ''),
      },
    },
  },
})
