import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpApiClient } from '../HttpApiClient'

afterEach(() => vi.unstubAllGlobals())
function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status }) }

describe('large scene transport', () => {
  it('hydrates a batch-deferred scene from ordered pages rather than returning null', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url)
      if (url.endsWith('/batch')) return response({ results: [{ nodeId: 'n', portId: 'scene', value: null, tooLarge: true, meta: { valid: true } }] })
      if (url.endsWith('/pages')) return response({ format: 'output-pages/1', snapshot: 's', pages: 2 })
      if (url.endsWith('/s/0')) return response([{ path: [], value: { value: { __outputCacheBlobRef: 'mesh' }, blobs: {} } }])
      if (url.endsWith('/s/1')) return response([{ path: ['blobs', 'mesh'], value: { vertices: [1, 2, 3] } }])
      throw new Error(url)
    }))
    const client = new HttpApiClient({ baseUrl: '', pipelineId: 'main', projectId: 'p' })
    const result = await client.getNodeOutputsBatch([{ nodeId: 'n', portId: 'scene' }])
    expect(result[0]?.value).toEqual({ vertices: [1, 2, 3] })
    expect(result[0]?.tooLarge).toBe(false)
    expect(urls).toHaveLength(4)
    client.dispose()
  })

  it('falls back on HTTP 413 and retries an expired snapshot without publishing partial data', async () => {
    let manifests = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/scene')) return response({}, 413)
      if (url.endsWith('/pages')) return response({ format: 'output-pages/1', snapshot: `s${++manifests}`, pages: 1 })
      if (url.endsWith('/s1/0')) return response({}, 410)
      return response([{ path: [], value: { value: [42], blobs: {} } }])
    }))
    const client = new HttpApiClient({ baseUrl: '', pipelineId: 'main', projectId: 'p' })
    expect(await client.getNodeOutput('n', 'scene')).toEqual([42])
    expect(manifests).toBe(2)
    client.dispose()
  })
})
