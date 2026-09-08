#!/usr/bin/env node
// HMR dev launcher: backend (`tsx --watch src/main.ts`) + frontend (Vite dev
// server with its own /api,/ws proxy from vite.config). The unbundled,
// hot-reloading counterpart to serve-dist.mjs (which serves built dist).
//
// run.sh launches this via `bun run dev` when FORGEAX_PLUGIN_HMR != 0, passing
// PORT (backend) / VITE_DEV_PORT / VITE_API_TARGET / VITE_DEV_HTTPS_CERT|KEY /
// and a per-plugin FORGEAX_PROJECT_ROOT through the environment. We just fan
// those into the two sub-package dev scripts (the SSOT for "how each half runs
// in watch mode"); Vite serves the frontend and proxies to the backend, so no
// custom static/proxy layer is needed here.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureWorkspacePackages } from '../../../scripts/ensure-workspace-packages.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
ensureWorkspacePackages(root)
const shell = process.platform === 'win32'

// vendor/dist holds the geometry DSL types the backend batteries import at
// runtime. `serve` builds it via the backend `prebuild`; the `tsx --watch` dev
// path does not, so build it once up front when missing.
if (!existsSync(resolve(root, 'vendor/dist'))) {
  console.log('[dev] vendor/dist missing; running bun run build:vendor')
  const r = spawnSync('bun', ['run', 'build:vendor'], { cwd: root, stdio: 'inherit', shell })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

const opts = { cwd: root, stdio: 'inherit', shell }
// `--conditions=source` makes the backend's `tsx --watch` resolve the kernel
// workspace packages (node-runtime, editor-host) to their TS *source* via the
// `source` export condition, so editing kernel code hot-restarts the backend
// WITHOUT a `bun run build`. Only our packages declare `source`; everything
// else falls through to `import`→dist. Frontend (Vite) uses resolve.alias for
// the same effect, so the condition is scoped to the backend process only.
const backendEnv = {
  ...process.env,
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ? process.env.NODE_OPTIONS + ' ' : ''}--conditions=source`,
}
const backend = spawn('bun', ['run', '--cwd', 'backend', 'dev'], { ...opts, env: backendEnv })
const frontend = spawn('bun', ['run', '--cwd', 'frontend', 'dev'], opts)

let shuttingDown = false
function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of [backend, frontend]) child.kill(signal)
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

// If either half exits, tear down the other and propagate the exit code.
for (const [name, child] of [['backend', backend], ['frontend', frontend]]) {
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`[dev] ${name} exited (code ${code}); shutting down the other half`)
      shutdown('SIGTERM')
    }
    process.exit(code ?? 0)
  })
}
