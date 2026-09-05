import { defineConfig } from 'vitest/config'

// 1단계(server/orderBlock.js, server/orderBlockLifecycle.js)는 DOM이 필요 없는 순수 로직이라
// 기본 환경(node)으로 충분하다. 2단계(src/OrderBlockBoxPrimitive.test.js,
// src/CandleChart.test.jsx)는 파일별로 필요한 곳에만 파일 상단 `// @vitest-environment jsdom`
// 지시어로 jsdom을 켠다 - 전역 환경을 jsdom으로 바꾸면 server 쪽 테스트까지 불필요하게
// 무거워지므로 여기서는 include 범위만 넓히고 기본 environment는 그대로 둔다.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.test.js', 'src/**/*.test.{js,jsx}'],
  },
})
