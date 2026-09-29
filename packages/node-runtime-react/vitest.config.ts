import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const kernel = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@forgeax\/node-runtime\/diff-pipeline$/, replacement: kernel('node-runtime/src/layer2/diff-pipeline.ts') },
      { find: /^@forgeax\/node-runtime\/number-const-slider$/, replacement: kernel('node-runtime/src/layer2/number-const-slider.ts') },
      { find: /^@forgeax\/node-runtime\/derive-group-ports$/, replacement: kernel('node-runtime/src/layer2/derive-group-ports.ts') },
    ],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
