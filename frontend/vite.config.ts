import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/solve': 'http://localhost:8000',
      '/puzzles': 'http://localhost:8000',
      '/models': 'http://localhost:8000',
    },
  },
})
