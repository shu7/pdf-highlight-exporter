import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 開発時は FastAPI (8000) へ /api をプロキシする
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
