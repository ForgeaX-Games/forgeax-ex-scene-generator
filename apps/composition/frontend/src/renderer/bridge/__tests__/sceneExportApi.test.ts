// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { sceneExportApi } from '../sceneExportApi'

describe('sceneExportApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('cooks the current baked scene through the scene export route', async () => {
    const response = {
      bundleId: 'scene-2026-06-04T06-00-00Z',
      zipPath: '/tmp/project/exports/scene/scene-2026-06-04T06-00-00Z/scene.zip',
      unpackedDir: '/tmp/project/exports/scene/scene-2026-06-04T06-00-00Z/unpacked',
      downloadUrl: 'http://192.168.50.20:9557/api/v1/scene-export/download/scene-2026-06-04T06-00-00Z',
      warnings: [],
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(response), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(sceneExportApi.cook()).resolves.toEqual(response)

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/scene-export/cook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
  })

  it('rejects a scene export response without a downloadUrl field', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      bundleId: 'scene-2026-06-04T06-00-00Z',
      zipPath: '/tmp/project/exports/scene/scene-2026-06-04T06-00-00Z/scene.zip',
      unpackedDir: '/tmp/project/exports/scene/scene-2026-06-04T06-00-00Z/unpacked',
      warnings: [],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(sceneExportApi.cook()).rejects.toThrow(/downloadUrl/i)
  })
})
