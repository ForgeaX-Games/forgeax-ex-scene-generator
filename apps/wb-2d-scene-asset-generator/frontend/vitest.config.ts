import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The HttpApiClient tests stub global `fetch` and guard WebSocket access,
    // so a plain Node environment is sufficient (no DOM polyfill required).
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
  },
})
