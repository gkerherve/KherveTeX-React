import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the same build works in Tauri and in a browser
export default defineConfig({
  base: './',
  plugins: [react()],
  clearScreen: false,
  server: { port: 5174, strictPort: true },
})
