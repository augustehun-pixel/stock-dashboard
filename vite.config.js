import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
    // GitHub Codespaces의 포트 포워딩 주소(예: xxxx-5173.app.github.dev)로 접속할 때
    // Vite의 기본 호스트 검사에 막히지 않도록 허용한다. Codespaces가 아닌 환경에서는 영향 없음.
    allowedHosts: process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
      ? [`.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`]
      : undefined,
  },
})
