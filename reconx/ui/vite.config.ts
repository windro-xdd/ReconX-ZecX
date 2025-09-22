import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const process: any

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const raw = env.VITE_API_BASE_URL
  const isAbs = !!raw && /^https?:\/\//i.test(raw)
  const target = isAbs ? raw : 'http://localhost:8000'
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': { target, changeOrigin: true }
      }
    }
  }
})
