#!/usr/bin/env node
/**
 * Ensure better-sqlite3 native addon loads for the current Node.js version.
 * Rebuilds from source when missing or ABI-incompatible (c++17 for older g++).
 */
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
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

function canLoad() {
  try {
    const Database = require('better-sqlite3')
    const db = new Database(':memory:')
    db.close()
    return true
  } catch {
    return false
  }
}

function rebuild() {
  patchCppStandard()
  // Node 22+ node-gyp needs Python >=3.7; fall back to python3.8 when default is too old.
  const env = { ...process.env }
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
  console.log('[ensure-better-sqlite3] rebuilding native addon for', process.version)
  rebuild()
  if (!canLoad()) {
    console.error('[ensure-better-sqlite3] rebuild failed — AssetStore library.db will be unavailable')
    process.exit(1)
  }
  console.log('[ensure-better-sqlite3] ok')
}
