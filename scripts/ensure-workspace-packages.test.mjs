import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  FILTER_ARGS,
  ensureWorkspacePackages,
  findMonorepoRoot,
} from './ensure-workspace-packages.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const apps = [
  'wb-scene-generator',
  'wb-3d-lowpoly',
  'wb-2d-scene-asset-generator',
]

test('findMonorepoRoot walks up from each app directory', () => {
  for (const slug of apps) {
    const appRoot = join(repoRoot, 'apps', slug)
    assert.equal(findMonorepoRoot(appRoot), repoRoot)
    assert.equal(findMonorepoRoot(join(appRoot, 'scripts')), repoRoot)
  }
})

test('ensureWorkspacePackages runs the workspace filter from the monorepo root', () => {
  const calls = []
  for (const slug of apps) {
    calls.length = 0
    const appRoot = join(repoRoot, 'apps', slug)
    const root = ensureWorkspacePackages(appRoot, {
      spawnSync: (cmd, args, opts) => {
        calls.push({ cmd, args, cwd: opts.cwd })
        return { status: 0 }
      },
      exit: false,
      stdio: 'pipe',
    })
    assert.equal(root, repoRoot)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].cmd, 'bun')
    assert.deepEqual(calls[0].args, FILTER_ARGS)
    assert.equal(calls[0].cwd, repoRoot)
  }
})

test('ensureWorkspacePackages from a nested temp app still uses the workspace root', () => {
  const staging = mkdtempSync(join(tmpdir(), 'forgeax-ensure-ws-'))
  try {
    writeFileSync(join(staging, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }))
    const appDir = join(staging, 'apps', 'wb-scene-generator', 'scripts')
    mkdirSync(appDir, { recursive: true })
    const calls = []
    ensureWorkspacePackages(appDir, {
      spawnSync: (cmd, args, opts) => {
        calls.push({ cmd, args, cwd: opts.cwd })
        return { status: 0 }
      },
      exit: false,
      stdio: 'pipe',
    })
    assert.equal(calls[0].cwd, staging)
    assert.deepEqual(calls[0].args, FILTER_ARGS)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
})

test('ensureWorkspacePackages throws when the filter fails and exit is disabled', () => {
  assert.throws(
    () =>
      ensureWorkspacePackages(join(repoRoot, 'apps', 'wb-scene-generator'), {
        spawnSync: () => ({ status: 2 }),
        exit: false,
        stdio: 'pipe',
      }),
    /workspace package build failed \(2\)/,
  )
})
