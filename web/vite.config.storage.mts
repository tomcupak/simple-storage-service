import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  root: 'apps/storage',
  publicDir: 'public',
  server: {
    port: 10412,
  },
  plugins: [react(), tsconfigPaths({ root: '../../' })],
  build: {
    outDir: '../../dist/storage',
    emptyOutDir: true,
  },
})
