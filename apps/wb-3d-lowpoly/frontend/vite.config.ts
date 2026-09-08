import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev-only: resolve the kernel workspace packages to their TypeScript *source*
// (not built dist) so editing kernel code (node-runtime / node-runtime-react)
// hot-reloads through Vite WITHOUT a `bun run build`. Package `exports` point at
// dist for publish/prod; this alias overrides that for the dev server only.
// Production paths (serve-dist / .app) never load this config, so they keep
// consuming dist. Exact-match (`$`) so CSS subpaths (already → src) are untouched.
const kernel = (p: string) => fileURLToPath(new URL(`../../../packages/${p}`, import.meta.url))
const kernelAlias = [
  { find: /^@forgeax\/node-runtime-react\/editor$/, replacement: kernel('node-runtime-react/src/editor/index.ts') },
  { find: /^@forgeax\/node-runtime-react\/themes$/, replacement: kernel('node-runtime-react/src/themes/index.ts') },
  { find: /^@forgeax\/node-runtime-react$/, replacement: kernel('node-runtime-react/src/index.ts') },
  { find: /^@forgeax\/node-runtime\/diff-pipeline$/, replacement: kernel('node-runtime/src/layer2/diff-pipeline.ts') },
  { find: /^@forgeax\/node-runtime\/derive-group-ports$/, replacement: kernel('node-runtime/src/layer2/derive-group-ports.ts') },
  { find: /^@forgeax\/node-runtime\/layer1$/, replacement: kernel('node-runtime/src/layer1/index.ts') },
  { find: /^@forgeax\/node-runtime$/, replacement: kernel('node-runtime/src/index.ts') },
]

// Dev port + backend target are env-overridable so this plugin can run on its
// own address alongside the scene-generator (which uses 9555 -> 9557). Defaults
// use the isolated 3d-lowpoly ports.
const devPort = Number(process.env.VITE_DEV_PORT ?? 9565)
const apiTarget = process.env.VITE_API_TARGET ?? 'http://localhost:9567'
const wsTarget = apiTarget.replace(/^http/, 'ws')
const pluginBase = process.env.VITE_PLUGIN_BASE ?? './'
const pluginHmrClientPort = process.env.VITE_PLUGIN_HMR_CLIENT_PORT
  ? Number(process.env.VITE_PLUGIN_HMR_CLIENT_PORT)
  : undefined

// When embedded as an iframe inside an HTTPS host (Studio with
// FORGEAX_INTERFACE_HTTPS=1), this dev server must also serve HTTPS or the
// browser blocks the frame as mixed content. The host (run.sh) passes its TLS
// cert via these env vars; absent them we stay on plain HTTP for local dev.
const httpsCert = process.env.VITE_DEV_HTTPS_CERT
const httpsKey = process.env.VITE_DEV_HTTPS_KEY
const httpsOption =
  httpsCert && httpsKey
    ? { cert: readFileSync(httpsCert), key: readFileSync(httpsKey) }
    : undefined

export default defineConfig({
  base: pluginBase,
  plugins: [react()],
  resolve: {
    alias: kernelAlias,
    // Single React/@xyflow/react/zustand instance across app + kernel source — when
    // the kernel is served from source its hooks must share the app's React.
    dedupe: ['react', 'react-dom', '@xyflow/react', 'zustand'],
  },
  // Don't pre-bundle the source-aliased kernel; let Vite transform + HMR it live.
  optimizeDeps: { exclude: ['@forgeax/node-runtime-react', '@forgeax/node-runtime'] },
  server: {
    port: devPort,
    host: true,
    ...(httpsOption ? { https: httpsOption } : {}),
    hmr: {
      clientPort: pluginHmrClientPort,
      ...(process.env.VITE_PLUGIN_HMR_PATH ? { path: process.env.VITE_PLUGIN_HMR_PATH } : {}),
    },
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/ws':  { target: wsTarget, ws: true },
    },
  },
  // `vite preview` serves the built (bundled/minified) dist instead of the
  // unbundled dev server — same loading profile as the host-served wb-scene
  // dist, so the workbench opens fast. Mirrors `server`'s port/https/proxy so
  // the built app still reaches the backend on its isolated port.
  preview: {
    port: devPort,
    host: true,
    ...(httpsOption ? { https: httpsOption } : {}),
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/ws':  { target: wsTarget, ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
})
