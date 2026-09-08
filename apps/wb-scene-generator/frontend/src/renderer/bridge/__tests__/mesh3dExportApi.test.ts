import { afterEach, describe, expect, it, vi } from 'vitest'
import { mesh3dExportApi } from '../mesh3dExportApi'

describe('mesh3dExportApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses cook result', async () => {
    const response = {
      sceneId: 'main',
      gameSlug: 'demo',
      sceneDir: '/tmp/.forgeax/games/demo/assets/3d/scenes/wb-scene-generator/main',
      metaPath: '/tmp/.forgeax/games/demo/assets/3d/scenes/wb-scene-generator/main/meta.json',
      relativeDir: 'assets/3d/scenes/wb-scene-generator/main',
      projectRelativeDir: '.forgeax/games/demo/assets/3d/scenes/wb-scene-generator/main',
      projectId: 'main',
      sceneName: 'Main',
      warnings: [],
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(response), { status: 200 })))
    await expect(mesh3dExportApi.cook()).resolves.toEqual(response)
  })

  it('surfaces backend error message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: 'no gameSlug; pass gameSlug (active game) or bind the project to a game' }), { status: 400 }),
    ))
    await expect(mesh3dExportApi.cook()).rejects.toThrow(/gameSlug/)
  })
})
