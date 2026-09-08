import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const broadcast = vi.fn()

vi.mock('../routes/ws.js', () => ({
  broadcastToClients: (...args: unknown[]) => broadcast(...args),
}))

vi.mock('../runtime.js', () => ({
  getActiveProjectDir: async () => join(tmpdir(), 'game-sandbox-test-project'),
}))

describe('gameSandboxStore watcher', () => {
  let sandboxDir: string

  beforeEach(async () => {
    broadcast.mockClear()
    vi.resetModules()
    sandboxDir = join(tmpdir(), `game-sandbox-watcher-${Date.now()}`)
    mkdirSync(join(sandboxDir, 'blobs'), { recursive: true })
    writeFileSync(join(sandboxDir, 'index.json'), '[]', 'utf-8')
  })

  afterEach(async () => {
    const mod = await import('./gameSandboxStore.js')
    mod._resetGameSandboxWatcherForTests()
    mod.clearGameTexturesBinding()
    rmSync(sandboxDir, { recursive: true, force: true })
  })

  it('broadcasts library:changed when index.json is updated after bind', async () => {
    const mod = await import('./gameSandboxStore.js')
    await mod.setGameTexturesDir(sandboxDir)

    writeFileSync(
      join(sandboxDir, 'index.json'),
      JSON.stringify([{ assetName: 'grass', assetType: 'tile', sha256: 'abc', file: 'blobs/abc.png', mimeType: 'image/png', sizeBytes: 1 }]),
      'utf-8',
    )

    await vi.waitFor(() => {
      expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ event: 'library:changed' }))
    }, { timeout: 1000 })
  })

  it('still broadcasts when bound BEFORE the sandbox dir exists (2D publishToGame creates it later)', async () => {
    // Real-world order: scene:library.useGameTextures binds the path before the
    // 2D app's first publishToGame creates the textures dir. Previously watch()
    // threw ENOENT and was swallowed → no live refresh ever.
    const lateDir = join(tmpdir(), `game-sandbox-late-${Date.now()}`)
    rmSync(lateDir, { recursive: true, force: true })

    const mod = await import('./gameSandboxStore.js')
    await mod.setGameTexturesDir(lateDir) // dir does not exist yet

    // Simulate the 2D publish landing an index.json into the (now-created) dir.
    mkdirSync(join(lateDir, 'blobs'), { recursive: true })
    writeFileSync(
      join(lateDir, 'index.json'),
      JSON.stringify([{ assetName: 'sand', assetType: 'tile', sha256: 'def', file: 'blobs/def.png', mimeType: 'image/png', sizeBytes: 1 }]),
      'utf-8',
    )

    await vi.waitFor(() => {
      expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ event: 'library:changed' }))
    }, { timeout: 3000 }) // covers the 1.5s mtime-poll fallback if fs.watch misses

    mod._resetGameSandboxWatcherForTests()
    mod.clearGameTexturesBinding()
    rmSync(lateDir, { recursive: true, force: true })
  })
})

describe('gameSandboxStore project binding', () => {
  let projectADir: string
  let projectBDir: string
  let sandboxA: string
  let sandboxB: string
  let activeProjectDir: string

  beforeEach(async () => {
    vi.resetModules()
    broadcast.mockClear()
    const stamp = Date.now()
    projectADir = join(tmpdir(), `game-sandbox-proj-a-${stamp}`)
    projectBDir = join(tmpdir(), `game-sandbox-proj-b-${stamp}`)
    sandboxA = join(tmpdir(), `game-sandbox-a-${stamp}`)
    sandboxB = join(tmpdir(), `game-sandbox-b-${stamp}`)
    activeProjectDir = projectADir
    for (const d of [projectADir, projectBDir, sandboxA, sandboxB]) mkdirSync(d, { recursive: true })
    mkdirSync(join(projectADir, 'private-assets'), { recursive: true })
    mkdirSync(join(projectBDir, 'private-assets'), { recursive: true })
    writeFileSync(join(projectADir, 'private-assets', '.game-textures-dir'), sandboxA, 'utf-8')
    writeFileSync(join(projectBDir, 'private-assets', '.game-textures-dir'), sandboxB, 'utf-8')
    writeFileSync(join(sandboxA, 'index.json'), '[]', 'utf-8')
    writeFileSync(join(sandboxB, 'index.json'), '[]', 'utf-8')

    vi.doMock('../runtime.js', () => ({
      getActiveProjectDir: async () => activeProjectDir,
    }))
  })

  afterEach(async () => {
    const mod = await import('./gameSandboxStore.js')
    mod._resetGameSandboxWatcherForTests()
    mod.clearGameTexturesBinding()
    for (const d of [projectADir, projectBDir, sandboxA, sandboxB]) rmSync(d, { recursive: true, force: true })
  })

  it('re-reads the ref file when the viewing project changes', async () => {
    const mod = await import('./gameSandboxStore.js')
    expect(await mod.getGameTexturesDir()).toBe(sandboxA)

    activeProjectDir = projectBDir
    expect(await mod.getGameTexturesDir()).toBe(sandboxB)
  })
})
