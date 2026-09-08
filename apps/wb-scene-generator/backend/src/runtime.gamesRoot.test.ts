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

  it('maps workbench sandbox to sibling .forgeax/games (no host env)', () => {
    process.env.FORGEAX_PROJECT_ROOT = '/tmp/instance/.forgeax/workbench/wb-scene-generator'
    expect(resolveSharedGamesRoot()).toBe(resolve('/tmp/instance/.forgeax/games'))
  })

  it('falls back under workspace when not in a workbench sandbox', () => {
    process.env.FORGEAX_PROJECT_ROOT = '/tmp/standalone-ws'
    expect(resolveSharedGamesRoot()).toBe(resolve('/tmp/standalone-ws/.forgeax/games'))
  })

  it('stores Workbench projects under the active game', () => {
    const instanceRoot = mkdtempSync(resolve(tmpdir(), 'wb-scene-instance-'))
    tempRoots.push(instanceRoot)
    const workbenchRoot = resolve(instanceRoot, '.forgeax/workbench/wb-scene-generator')
    const gameRoot = resolve(instanceRoot, '.forgeax/games/river-town')
    mkdirSync(workbenchRoot, { recursive: true })
    mkdirSync(gameRoot, { recursive: true })
    writeFileSync(resolve(instanceRoot, '.forgeax/active-game.json'), JSON.stringify({ slug: 'river-town' }))
    process.env.FORGEAX_PROJECT_ROOT = workbenchRoot

    expect(resolveActiveGameSlug()).toBe('river-town')
    expect(resolveProjectWorkspaceRoot()).toBe(
      resolve(gameRoot, '.forgeax/workbench/wb-scene-generator'),
    )
  })

  it('rejects a missing active game instead of writing to the shared sandbox', () => {
    const instanceRoot = mkdtempSync(resolve(tmpdir(), 'wb-scene-instance-'))
    tempRoots.push(instanceRoot)
    const workbenchRoot = resolve(instanceRoot, '.forgeax/workbench/wb-scene-generator')
    mkdirSync(workbenchRoot, { recursive: true })
    process.env.FORGEAX_PROJECT_ROOT = workbenchRoot

    expect(() => resolveProjectWorkspaceRoot()).toThrow(ActiveGameRequiredError)
    try {
      resolveProjectWorkspaceRoot()
    } catch (error) {
      expect(error).toMatchObject({ code: 'ACTIVE_GAME_REQUIRED', retryable: true })
    }
  })
})
