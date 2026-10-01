import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // twitter-text is CJS and references the Node `global`; shim it so the
  // browser bundle can never throw a ReferenceError at evaluation time.
  define: { global: 'globalThis' },
  optimizeDeps: { include: ['twitter-text', 'twemoji-parser'] },
})
