import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/v1':      { target: 'http://localhost:8000', changeOrigin: true },
      '/portal':  { target: 'http://localhost:8000', changeOrigin: true },
      '/billing': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
})
