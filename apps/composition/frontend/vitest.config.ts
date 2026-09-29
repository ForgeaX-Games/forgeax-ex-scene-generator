import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Same source aliases as vite.config.ts. Without them, `@forgeax/node-runtime-react`
// resolves to dist and a policy file importing the slider batch prefix from the
// `.` entry sees a stale build (or undefined). Do not import `./editor` from
// renderer policy files — that barrel pulls canvas/DOM.
const kernel = (p: string) => fileURLToPath(new URL(`../../../packages/${p}`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@forgeax\/node-runtime-react\/editor$/, replacement: kernel('node-runtime-react/src/editor/index.ts') },
      { find: /^@forgeax\/node-runtime-react\/themes$/, replacement: kernel('node-runtime-react/src/themes/index.ts') },
      { find: /^@forgeax\/node-runtime-react$/, replacement: kernel('node-runtime-react/src/index.ts') },
      { find: /^@forgeax\/node-runtime\/number-const-slider$/, replacement: kernel('node-runtime/src/layer2/number-const-slider.ts') },
      { find: /^@forgeax\/node-runtime$/, replacement: kernel('node-runtime/src/index.ts') },
    ],
  },
  test: {
    // The HttpApiClient tests stub global `fetch` and guard WebSocket access,
    // so a plain Node environment is sufficient (no DOM polyfill required).
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
