import { defineConfig } from 'vitest/config'

// Minimal test project for the 3d-lowpoly frontend. Kept separate from
// vite.config.ts so `vite build` is untouched. The current suite is pure logic
// (no DOM render), so the lightweight `node` environment is sufficient; switch
// to `jsdom` here if a component-render test is added later.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
