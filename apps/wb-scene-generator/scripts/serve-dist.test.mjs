#!/usr/bin/env node
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  FILTER_ARGS,
  ensureWorkspacePackages,
  findMonorepoRoot,
} from '../../../scripts/ensure-workspace-packages.mjs'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('serve-dist cold start contract', () => {
  it('builds workspace packages from the monorepo root, not the app cwd', () => {
    const calls = []
    const root = ensureWorkspacePackages(appRoot, {
      spawnSync: (cmd, args, opts) => {
        calls.push({ cmd, args, cwd: opts.cwd })
        return { status: 0 }
      },
      exit: false,
      stdio: 'pipe',
    })
    assert.equal(root, findMonorepoRoot(appRoot))
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].args, FILTER_ARGS)
    assert.equal(calls[0].cwd, root)
    assert.notEqual(calls[0].cwd, appRoot)
  })
})

describe('headless renderer Studio routing contract', () => {
  it('delegates URL selection to the shared core instead of assuming the Studio proxy', async () => {
    const { resolveRendererUrl, SCENE_RENDERER_SPEC } = await import(
      '../../../scripts/headless-renderer-routing.mjs'
    )
    const direct = resolveRendererUrl({
      FORGEAX_INTERFACE_PORT: '18920',
      SCENE_FRONTEND_PORT: '9555',
    }, SCENE_RENDERER_SPEC)
    const proxy = resolveRendererUrl({
      FORGEAX_STANDALONE_PROXY: '1',
      FORGEAX_INTERFACE_PORT: '18920',
      SCENE_FRONTEND_PORT: '9555',
    }, SCENE_RENDERER_SPEC)
    assert.equal(direct.mode, 'direct')
    assert.equal(direct.url, 'http://127.0.0.1:9555/?pane=renderer')
    assert.equal(proxy.mode, 'proxy')
    assert.equal(proxy.url, 'http://127.0.0.1:18920/__fx-plugin/wb-scene-generator/?pane=renderer')
  })
})
