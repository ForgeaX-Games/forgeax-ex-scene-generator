import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Same idea as frontend/vitest.config.ts: `@forgeax/scene-authoring` package
// exports point at dist. Without this alias, adapter identity tests see a stale
// compile that still hashes `@scene-id` into `node_<hash>`.
const kernel = (p: string) => fileURLToPath(new URL(`../../../packages/${p}`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@forgeax\/scene-authoring$/, replacement: kernel('scene-authoring/src/index.ts') },
      { find: /^@forgeax\/scene$/, replacement: kernel('scene/src/index.ts') },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
})
