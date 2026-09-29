import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import {
  ActiveGameRequiredError,
  resolveActiveGameSlug,
  resolveProjectWorkspaceRoot,
  resolveSharedGamesRoot,
} from './runtime.js'

describe('resolveSharedGamesRoot', () => {
  const prev = process.env.FORGEAX_PROJECT_ROOT
  const tempRoots: string[] = []

  afterEach(() => {
    if (prev === undefined) delete process.env.FORGEAX_PROJECT_ROOT
    else process.env.FORGEAX_PROJECT_ROOT = prev
    for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('maps an extension runtime sandbox to sibling .forgeax/games (no host env)', () => {
    process.env.FORGEAX_PROJECT_ROOT = '/tmp/instance/.forgeax/extension-runtime/scene-generator'
    expect(resolveSharedGamesRoot()).toBe(resolve('/tmp/instance/.forgeax/games'))
  })

  it('falls back under workspace when not in an extension runtime sandbox', () => {
    process.env.FORGEAX_PROJECT_ROOT = '/tmp/standalone-ws'
    expect(resolveSharedGamesRoot()).toBe(resolve('/tmp/standalone-ws/.forgeax/games'))
  })

  it('stores extension projects under the active game', () => {
    const instanceRoot = mkdtempSync(resolve(tmpdir(), 'scene-instance-'))
    tempRoots.push(instanceRoot)
    const runtimeRoot = resolve(instanceRoot, '.forgeax/extension-runtime/scene-generator')
    const gameRoot = resolve(instanceRoot, '.forgeax/games/river-town')
    mkdirSync(runtimeRoot, { recursive: true })
    mkdirSync(gameRoot, { recursive: true })
    writeFileSync(resolve(instanceRoot, '.forgeax/active-game.json'), JSON.stringify({ slug: 'river-town' }))
    process.env.FORGEAX_PROJECT_ROOT = runtimeRoot

    expect(resolveActiveGameSlug()).toBe('river-town')
    expect(resolveProjectWorkspaceRoot()).toBe(
      resolve(gameRoot, '.forgeax/extension-state/scene-generator'),
    )
  })

  it('rejects a missing active game instead of writing to the shared sandbox', () => {
    const instanceRoot = mkdtempSync(resolve(tmpdir(), 'scene-instance-'))
    tempRoots.push(instanceRoot)
    const runtimeRoot = resolve(instanceRoot, '.forgeax/extension-runtime/scene-generator')
    mkdirSync(runtimeRoot, { recursive: true })
    process.env.FORGEAX_PROJECT_ROOT = runtimeRoot

    expect(() => resolveProjectWorkspaceRoot()).toThrow(ActiveGameRequiredError)
    try {
      resolveProjectWorkspaceRoot()
    } catch (error) {
      expect(error).toMatchObject({ code: 'ACTIVE_GAME_REQUIRED', retryable: true })
    }
  })
})
