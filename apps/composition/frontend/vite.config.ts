import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Dev-only: resolve the kernel workspace packages to their TypeScript *source*
// (not built dist) so editing kernel code (node-runtime / node-runtime-react)
// hot-reloads through Vite WITHOUT a `bun run build`. Package `exports` point at
// dist for publish/prod; this alias overrides that for the dev server only.
// Production paths (serve-dist / .app) never load this config, so they keep
// consuming dist. Exact-match (`$`) so CSS subpaths (already → src) are untouched.
const kernel = (p: string) => fileURLToPath(new URL(`../../../packages/${p}`, import.meta.url))
// The kernel is source-aliased from a sibling workspace package. Pin React to
// this app's dependency location as well: Vite's `dedupe` cannot always collapse
// two workspace symlink ancestry chains during linked-source HMR, which gives the
// renderer and App different React dispatchers ("Invalid hook call").
const appDependency = (p: string) => fileURLToPath(new URL(`node_modules/${p}`, import.meta.url))
const reactAlias = [
  { find: /^react$/, replacement: appDependency('react/index.js') },
  { find: /^react\/jsx-runtime$/, replacement: appDependency('react/jsx-runtime.js') },
  { find: /^react\/jsx-dev-runtime$/, replacement: appDependency('react/jsx-dev-runtime.js') },
  { find: /^react-dom$/, replacement: appDependency('react-dom/index.js') },
  { find: /^react-dom\/client$/, replacement: appDependency('react-dom/client.js') },
]
const kernelAlias = [
  { find: /^@forgeax\/node-runtime-react\/editor$/, replacement: kernel('node-runtime-react/src/editor/index.ts') },
  { find: /^@forgeax\/node-runtime-react\/themes$/, replacement: kernel('node-runtime-react/src/themes/index.ts') },
  { find: /^@forgeax\/node-runtime-react$/, replacement: kernel('node-runtime-react/src/index.ts') },
  { find: /^@forgeax\/node-runtime\/diff-pipeline$/, replacement: kernel('node-runtime/src/layer2/diff-pipeline.ts') },
  { find: /^@forgeax\/node-runtime\/number-const-slider$/, replacement: kernel('node-runtime/src/layer2/number-const-slider.ts') },
  { find: /^@forgeax\/node-runtime\/derive-group-ports$/, replacement: kernel('node-runtime/src/layer2/derive-group-ports.ts') },
  { find: /^@forgeax\/node-runtime\/layer1$/, replacement: kernel('node-runtime/src/layer1/index.ts') },
  { find: /^@forgeax\/node-runtime$/, replacement: kernel('node-runtime/src/index.ts') },
]

const devPort = Number(process.env.VITE_DEV_PORT ?? 9555)
const apiTarget = process.env.VITE_API_TARGET ?? 'http://localhost:9557'
const wsTarget = apiTarget.replace(/^http/, 'ws')
const pluginBase = process.env.VITE_PLUGIN_BASE ?? './'
const pluginHmrClientPort = process.env.VITE_PLUGIN_HMR_CLIENT_PORT
  ? Number(process.env.VITE_PLUGIN_HMR_CLIENT_PORT)
  : undefined
const cert = process.env.VITE_DEV_HTTPS_CERT
const key = process.env.VITE_DEV_HTTPS_KEY
const https = cert && key ? { cert: readFileSync(cert), key: readFileSync(key) } : undefined

export default defineConfig(({ mode }) => ({
  // Host serves this dist at /extensions/scene-generator/. Relative `./` keeps
  // /api/v1 and /ws on the Studio origin, which already reverse-proxies them.
  base: mode === 'production' ? './' : pluginBase,
  plugins: [react()],
  // Dev: opt-in viewport perf markers (see node-runtime-react/canvasPerfReport.ts).
  define:
    mode === 'development' && process.env.VITE_CANVAS_PERF_DEBUG !== undefined
      ? {
          'import.meta.env.VITE_CANVAS_PERF_DEBUG': JSON.stringify(process.env.VITE_CANVAS_PERF_DEBUG),
        }
      : undefined,
  resolve: {
    alias: [...reactAlias, ...kernelAlias],
    // Single React/@xyflow/react/zustand instance across app + kernel source — when
    // the kernel is served from source its hooks must share the app's React.
    dedupe: ['react', 'react-dom', '@xyflow/react', 'zustand'],
  },
  // Don't pre-bundle the source-aliased kernel; let Vite transform + HMR it live.
  optimizeDeps: { exclude: ['@forgeax/node-runtime-react', '@forgeax/node-runtime'] },
  server: {
    port: devPort,
    strictPort: true,
    host: true,
    ...(https ? { https } : {}),
    hmr: {
      clientPort: pluginHmrClientPort,
      ...(process.env.VITE_PLUGIN_HMR_PATH ? { path: process.env.VITE_PLUGIN_HMR_PATH } : {}),
    },
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/ws':  { target: wsTarget, ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
}))
