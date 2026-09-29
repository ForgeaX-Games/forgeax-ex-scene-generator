import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PathResolver } from '../layer1/path-resolver.js'

let scratchDir: string

beforeEach(() => {
  scratchDir = join(tmpdir(), `forgeax-pr-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(scratchDir, { recursive: true })
})

afterEach(() => {
  rmSync(scratchDir, { recursive: true, force: true })
})

function makeResolver(): PathResolver {
  const gameRoot = join(scratchDir, '.forgeax', 'games', 'demo')
  mkdirSync(gameRoot, { recursive: true })
  return new PathResolver({
    pluginId: 'test',
    projectRoot: scratchDir,
    gameRoot,
  })
}

describe('PathResolver', () => {
  it('resolves a manifest default with ${gameRoot} interpolation', () => {
    const r = makeResolver()
    r.registerSlot({
      id: 'test.output.assets',
      default: '${gameRoot}/assets/',
      kind: 'directory',
      access: 'write',
    })
    const out = r.resolve('test.output.assets')
    expect(out).toMatch(/\.forgeax\/games\/demo\/assets/)
  })

  it('honours session override above persisted override', () => {
    const r = makeResolver()
    r.registerSlot({
      id: 'test.scratch',
      default: '${gameRoot}/default/',
      kind: 'directory',
      access: 'write',
    })
    r.setSlot('test.scratch', `${scratchDir}/persisted/`, true)
    expect(r.resolve('test.scratch')).toMatch(/persisted/)
    r.setSlot('test.scratch', `${scratchDir}/session/`, false)
    expect(r.resolve('test.scratch')).toMatch(/session/)
    r.resetSlot('test.scratch') // session only
    expect(r.resolve('test.scratch')).toMatch(/persisted/)
  })

  it('honours FORGEAX_PATH_<NORMALIZED> env var when no override is set', () => {
    const r = makeResolver()
    r.registerSlot({
      id: 'test.output.envpath',
      default: '${gameRoot}/default/',
      kind: 'directory',
      access: 'write',
    })
    process.env.FORGEAX_PATH_EXTENSION_TEST_OUTPUT_ENVPATH = `${scratchDir}/from-env/`
    try {
      expect(r.resolve('test.output.envpath')).toMatch(/from-env/)
    } finally {
      delete process.env.FORGEAX_PATH_EXTENSION_TEST_OUTPUT_ENVPATH
    }
  })

  it('rejects paths that escape the project root', () => {
    const r = makeResolver()
    r.registerSlot({
      id: 'test.escape',
      default: '/etc/passwd',
      kind: 'file',
      access: 'read',
    })
    expect(() => r.resolve('test.escape')).toThrow(/escapes project root/)
  })

  it('persists changes across resolver instances via paths.config.json', () => {
    const r1 = makeResolver()
    r1.registerSlot({
      id: 'test.persistent',
      default: '${gameRoot}/orig/',
      kind: 'directory',
      access: 'write',
    })
    r1.setSlot('test.persistent', `${scratchDir}/persisted-2/`, true)
    expect(r1.resolve('test.persistent')).toMatch(/persisted-2/)

    // New resolver instance pointed at the same gameRoot picks up paths.config.json.
    const gameRoot = join(scratchDir, '.forgeax', 'games', 'demo')
    expect(existsSync(join(gameRoot, 'paths.config.json'))).toBe(true)

    const r2 = new PathResolver({
      pluginId: 'test',
      projectRoot: scratchDir,
      gameRoot,
    })
    r2.registerSlot({
      id: 'test.persistent',
      default: '${gameRoot}/orig/',
      kind: 'directory',
      access: 'write',
    })
    expect(r2.resolve('test.persistent')).toMatch(/persisted-2/)
  })

  it('lists slots filtered by plugin id namespace', () => {
    const r = makeResolver()
    r.registerSlot({ id: 'test.a', default: '${gameRoot}/a/', kind: 'directory', access: 'write' })
    r.registerSlot({ id: 'test.b', default: '${gameRoot}/b/', kind: 'directory', access: 'write' })
    r.registerSlot({ id: 'other.c', default: '${gameRoot}/c/', kind: 'directory', access: 'write' })
    expect(r.listSlots('test').map((s) => s.id).sort()).toEqual(['test.a', 'test.b'])
    expect(r.listSlots().length).toBe(3)
  })

  it('saves persisted overrides as schemaVersion=1 JSON', () => {
    const r = makeResolver()
    r.registerSlot({
      id: 'test.persisted',
      default: '${gameRoot}/orig/',
      kind: 'directory',
      access: 'write',
    })
    r.setSlot('test.persisted', `${scratchDir}/x/`, true)
    const gameRoot = join(scratchDir, '.forgeax', 'games', 'demo')
    const cfg = JSON.parse(readFileSync(join(gameRoot, 'paths.config.json'), 'utf-8'))
    expect(cfg.schemaVersion).toBe(1)
    expect(cfg.slots['test.persisted']).toMatch(/\/x/)
  })
})
