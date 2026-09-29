#!/usr/bin/env node
/**
 * Fallback for the better-sqlite3 native addon.
 *
 * The normal path is `trustedDependencies: ['better-sqlite3']` in the repo-root
 * package.json: bun then runs the package's own install script and prebuild-install
 * downloads a prebuilt addon for this Node ABI. This script only kicks in when no
 * prebuilt matches (foreign ABI, musl, offline) and rebuilds from source
 * (c++17 for older g++).
 *
 * The addon is loaded by the backend under Node, so the load probe runs in a fresh
 * `node` child process: an in-process require would answer for whatever runtime
 * happens to execute this script, and node-gyp inherits npm_config_* targeting from
 * the installer that spawned us — both make "built fine but reports unloadable"
 * possible. Probing out-of-process against real node removes that ambiguity.
 */
import { createRequire } from 'node:module'
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(here, '..', 'backend', 'package.json'))
const pkgRoot = dirname(require.resolve('better-sqlite3/package.json'))
const bindingGyp = join(pkgRoot, 'binding.gyp')

function patchCppStandard() {
  if (!existsSync(bindingGyp)) return
  const src = readFileSync(bindingGyp, 'utf8')
  if (!src.includes('c++20')) return
  writeFileSync(bindingGyp, src.replace(/c\+\+20/g, 'c++17'))
}

const NODE_BIN = process.versions.bun ? 'node' : process.execPath
const PROBE = "const D = require('better-sqlite3'); new D(':memory:').close()"

function canLoad() {
  try {
    execFileSync(NODE_BIN, ['-e', PROBE], { cwd: join(here, '..', 'backend'), stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function rebuild() {
  patchCppStandard()
  // Build for the Node that will load the addon: npm_config_* inherited from the
  // package manager that spawned this postinstall can retarget node-gyp's headers.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('npm_config_')))
  env.npm_config_runtime = 'node'
  env.npm_config_target = process.versions.bun
    ? execFileSync('node', ['-p', 'process.versions.node'], { encoding: 'utf8' }).trim()
    : process.versions.node
  // Node 22+ node-gyp needs Python >=3.7; fall back to python3.8 when default is too old.
  if (!env.PYTHON) {
    for (const py of ['/usr/bin/python3.8', '/usr/bin/python3.9', '/usr/bin/python3.10']) {
      if (existsSync(py)) {
        env.PYTHON = py
        break
      }
    }
  }
  execSync('npm run build-release', { cwd: pkgRoot, stdio: 'inherit', env })
}

if (!canLoad()) {
  console.log('[ensure-better-sqlite3] no loadable prebuilt addon; rebuilding from source')
  rebuild()
  if (!canLoad()) {
    console.error('[ensure-better-sqlite3] node still cannot load better-sqlite3 after rebuild — the backend would start without AssetStore library.db')
    process.exit(1)
  }
  console.log('[ensure-better-sqlite3] ok')
}
