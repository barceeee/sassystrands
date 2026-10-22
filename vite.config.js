import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ExcelJS is only imported dynamically by the import screen, so it lands in its own chunk.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
})
