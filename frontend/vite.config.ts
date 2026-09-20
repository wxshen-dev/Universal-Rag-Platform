import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // 避免与仓库根目录 VitePress 文档站（5173）冲突
    port: 5180,
    strictPort: true,
    proxy: {
      '/api/v1': {
        target: 'http://127.0.0.1:18080',
        changeOrigin: true,
      },
    },
  },
})
