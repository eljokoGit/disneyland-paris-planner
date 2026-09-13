import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Le moteur de calcul vit dans ../shared et est partagé avec le backend.
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true, ws: false } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
