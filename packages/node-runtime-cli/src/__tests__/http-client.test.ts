import { afterEach, describe, expect, it, vi } from 'vitest'
import { postBatch, postExecute, resolveServerUrl } from '../http-client.js'

describe('http-client', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.FORGEAX_SERVER_URL
  })

  it('resolveServerUrl reads flag, env, and --offline override', () => {
    expect(resolveServerUrl({})).toBeNull()
    process.env.FORGEAX_SERVER_URL = 'http://env/'
    expect(resolveServerUrl({})).toBe('http://env')
    expect(resolveServerUrl({ serverUrl: 'http://flag/' })).toBe('http://flag')
    expect(resolveServerUrl({ offline: true })).toBeNull()
  })

  it('postBatch POSTs ops to /api/v1/batch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', newHash: 'h1', batchId: 'b1' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await postBatch('http://localhost:3000', [
      { type: 'deleteNode', nodeId: 'ghost' },
    ])
    expect(result.status).toBe('ok')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/batch',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-forgeax-caller-kind': 'cli' }),
      }),
    )
  })

  it('postExecute POSTs to /api/v1/execute', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'completed', outputs: {} }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await postExecute('http://localhost:3000', 'node-a')
    expect(result.status).toBe('completed')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/execute',
      expect.objectContaining({
        body: JSON.stringify({ nodeId: 'node-a' }),
      }),
    )
  })
})
